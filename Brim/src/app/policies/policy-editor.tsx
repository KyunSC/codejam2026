"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError, Input, Select } from "@/components/forms/form-bits";
import { Button, Card } from "@/components/ui";
import { send } from "@/lib/client/api";

type Cond = { field: string; op: string; value: unknown };
type Eff = { kind: string; steps?: string[]; roles?: string[]; maxCad?: number | null; flag?: string; name?: string };
interface Rule {
  id: string;
  type: string;
  active: boolean;
  locked: boolean;
  when: Cond[];
  effect: Eff;
  sourceText: string;
  note: string;
  updatedBy: string | null;
}
interface Options {
  fields: Record<string, { ops: readonly string[]; value: string; label: string }>;
  steps: string[];
  releaseRoles: string[];
  vendorStatuses: string[];
  flags: string[];
  departments: Array<{ id: string; name: string }>;
  categories: string[];
}
interface Step {
  stepNo: number;
  role: string;
  assignedToId: string | null;
  onBehalfOfId: string | null;
  ruleIds: string[];
  replacements: string[];
  unresolvable: string | null;
}
interface Side {
  route: { steps: Step[]; holds: Array<{ ruleId: string; flag: string }>; blocked: string[] };
  release: { releaserIds: string[]; ruleIds: string[]; blockedReason: string | null };
  input: { totalCad: number | null; departmentId: string | null };
}

const STEP_TEXT: Record<string, string> = { dept_manager: "Department manager", finance_manager: "Finance manager", controller_admin: "Controller", cfo: "CFO" };
const OP_TEXT: Record<string, string> = { gt: "over", lte: "at most", in: "is one of", eq: "is" };
const INVARIANT_TEXT: Record<string, string> = {
  noSelfApproval: "Nobody approves their own invoice",
  delegateWhenOnLeave: "An approver on leave is replaced by their delegate",
  approverCannotRelease: "Whoever approved an invoice cannot release its payment",
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function listChoices(kind: string, o: Options): Array<{ id: string; label: string }> {
  if (kind === "vendorStatus[]") return o.vendorStatuses.map((s) => ({ id: s, label: s }));
  if (kind === "category[]") return o.categories.map((c) => ({ id: c, label: c }));
  if (kind === "department[]") return o.departments.map((d) => ({ id: d.id, label: `${d.id} ${d.name}` }));
  return o.flags.map((f) => ({ id: f, label: f }));
}

function defaultCondition(field: string, o: Options): Cond {
  const spec = o.fields[field];
  const value = spec.value === "number" ? 10000 : spec.value === "boolean" ? true : [listChoices(spec.value, o)[0]?.id].filter(Boolean);
  return { field, op: spec.ops[0], value };
}

function ConditionRow({ c, o, disabled, onChange, onRemove }: { c: Cond; o: Options; disabled: boolean; onChange: (c: Cond) => void; onRemove: () => void }) {
  const spec = o.fields[c.field];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Field" value={c.field} disabled={disabled} onChange={(e) => onChange(defaultCondition(e.target.value, o))} className="input max-w-[220px]">
        {Object.entries(o.fields).map(([k, f]) => (
          <option key={k} value={k}>{f.label}</option>
        ))}
      </Select>
      <Select aria-label="Operator" value={c.op} disabled={disabled || spec.ops.length < 2} onChange={(e) => onChange({ ...c, op: e.target.value })} className="input max-w-[130px]">
        {spec.ops.map((op) => (
          <option key={op} value={op}>{OP_TEXT[op] ?? op}</option>
        ))}
      </Select>
      {spec.value === "number" && (
        <Input aria-label="Amount (CAD)" type="number" min={0} step="0.01" className="input max-w-[150px]" disabled={disabled} value={String(c.value)} onChange={(e) => onChange({ ...c, value: e.target.value === "" ? "" : Number(e.target.value) })} />
      )}
      {spec.value === "boolean" && (
        <Select aria-label="Yes or no" value={String(c.value)} disabled={disabled} onChange={(e) => onChange({ ...c, value: e.target.value === "true" })} className="input max-w-[100px]">
          <option value="true">yes</option>
          <option value="false">no</option>
        </Select>
      )}
      {spec.value.endsWith("[]") && (
        <Select
          aria-label="Values"
          multiple
          size={Math.min(5, listChoices(spec.value, o).length)}
          disabled={disabled}
          className="input max-w-[280px]"
          value={(c.value as string[]) ?? []}
          onChange={(e) => onChange({ ...c, value: Array.from(e.target.selectedOptions).map((x) => x.value) })}
        >
          {listChoices(spec.value, o).map((x) => (
            <option key={x.id} value={x.id}>{x.label}</option>
          ))}
        </Select>
      )}
      {!disabled && <Button size="sm" variant="ghost" onClick={onRemove}>Remove</Button>}
    </div>
  );
}

function Checks({ all, chosen, label, disabled, onChange }: { all: string[]; chosen: string[]; label: (s: string) => string; disabled: boolean; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-3">
      {all.map((s) => (
        <label key={s} className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" disabled={disabled} checked={chosen.includes(s)} onChange={(e) => onChange(e.target.checked ? [...chosen, s] : chosen.filter((x) => x !== s))} />
          {label(s)}
        </label>
      ))}
    </div>
  );
}

function EffectEditor({ e, o, disabled, onChange }: { e: Eff; o: Options; disabled: boolean; onChange: (e: Eff) => void }) {
  if (e.kind === "invariant") return <p className="m-0 text-sm">{INVARIANT_TEXT[e.name ?? ""] ?? e.name}</p>;
  if (e.kind === "requireSteps") {
    return (
      <div className="flex flex-col gap-1">
        <span className="muted text-xs">Requires these approval steps</span>
        <Checks all={o.steps} chosen={e.steps ?? []} label={(s) => STEP_TEXT[s] ?? s} disabled={disabled} onChange={(steps) => onChange({ ...e, steps })} />
      </div>
    );
  }
  if (e.kind === "releaseBy") {
    return (
      <div className="flex flex-col gap-1">
        <span className="muted text-xs">May release</span>
        <Checks all={o.releaseRoles} chosen={e.roles ?? []} label={(s) => STEP_TEXT[s] ?? s} disabled={disabled} onChange={(roles) => onChange({ ...e, roles })} />
        <label className="flex items-center gap-2 text-sm">
          up to (CAD, empty for no limit)
          <Input aria-label="Release limit" type="number" min={0} className="input max-w-[150px]" disabled={disabled} value={e.maxCad === null || e.maxCad === undefined ? "" : String(e.maxCad)} onChange={(ev) => onChange({ ...e, maxCad: ev.target.value === "" ? null : Number(ev.target.value) })} />
        </label>
      </div>
    );
  }
  return (
    <label className="flex items-center gap-2 text-sm">
      Holds with
      <Select aria-label="Hold flag" value={e.flag} disabled={disabled} onChange={(ev) => onChange({ ...e, flag: ev.target.value })} className="input max-w-[260px]">
        {o.flags.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </Select>
    </label>
  );
}

function ChainView({ title, side }: { title: string; side: Side }) {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <h3 className="m-0 text-base">{title}</h3>
      <ol className="m-0 flex flex-col gap-1.5 pl-5 text-sm">
        {side.route.steps.map((s) => (
          <li key={s.stepNo}>
            <strong>{STEP_TEXT[s.role] ?? s.role}</strong>: {s.unresolvable ? <span className="text-[var(--red)]">nobody ({s.unresolvable})</span> : s.assignedToId}
            {s.onBehalfOfId ? ` for ${s.onBehalfOfId}` : ""}
            <span className="muted"> · {s.ruleIds.join(", ")}{s.replacements.length ? ` · ${s.replacements.join("; ")}` : ""}</span>
          </li>
        ))}
      </ol>
      {side.route.holds.map((h) => (
        <p key={h.ruleId} className="m-0 text-sm">Held by {h.ruleId}: {h.flag}</p>
      ))}
      {side.route.blocked.map((b) => (
        <p key={b} className="m-0 text-sm text-[var(--red)]">{b}</p>
      ))}
      <p className="m-0 text-sm">
        {side.release.blockedReason ? <span className="text-[var(--red)]">Release blocked: {side.release.blockedReason}</span> : <>May release: {side.release.releaserIds.join(", ") || "nobody"} ({side.release.ruleIds.join(", ")})</>}
      </p>
    </Card>
  );
}

export function PolicyEditor({ slug, rules, options, canEdit }: { slug: string; rules: Rule[]; options: Options; canEdit: boolean }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, Rule>>(() => Object.fromEntries(rules.map((r) => [r.id, r])));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invoiceId, setInvoiceId] = useState("");
  const [preview, setPreview] = useState<{ changedRules: string[]; before: Side; after: Side } | null>(null);

  const original = Object.fromEntries(rules.map((r) => [r.id, r]));
  const dirty = rules.filter((r) => !same(pick(drafts[r.id]), pick(r))).map((r) => r.id);
  const update = (id: string, patch: Partial<Rule>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }
  const save = (id: string) =>
    run(async () => {
      await send("PUT", `/api/orgs/${slug}/policies/${id}`, pick(drafts[id]));
      router.refresh();
    });
  const tryIt = () =>
    run(async () => {
      const body = { invoiceId: invoiceId.trim(), drafts: Object.fromEntries(dirty.map((id) => [id, pick(drafts[id])])) };
      setPreview(await send("POST", `/api/orgs/${slug}/policies/preview`, body));
    });

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="m-0 text-lg">Try on an invoice</h2>
        <p className="muted m-0 text-sm">
          {dirty.length ? `Your draft changes ${dirty.join(", ")}.` : "No changes yet: edit a rule below, then compare."} The chain is worked out by the same function as submit.
        </p>
        <div className="flex flex-wrap gap-2">
          <Input aria-label="Invoice id" placeholder="AP-00004" className="input max-w-[200px]" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} />
          <Button size="sm" variant="solid" disabled={busy || !invoiceId.trim()} onClick={tryIt}>Compare chains</Button>
        </div>
        {preview && (
          <div className="grid gap-3 md:grid-cols-2">
            <ChainView title={`In force (total CAD ${preview.before.input.totalCad ?? "unknown"})`} side={preview.before} />
            <ChainView title={preview.changedRules.length ? `With draft ${preview.changedRules.join(", ")}` : "With draft (no change)"} side={preview.after} />
          </div>
        )}
      </Card>
      <FormError message={error} />
      {rules.map((r) => {
        const d = drafts[r.id];
        const locked = r.locked || !canEdit;
        return (
          <Card key={r.id} className="flex flex-col gap-3 p-5" aria-label={`Rule ${r.id}`}>
            <div className="flex flex-wrap items-baseline gap-3">
              <strong className="text-lg">{r.id}</strong>
              <span className="muted text-sm">{r.type.replace("_", " ")}</span>
              {r.locked && <span className="rounded bg-[var(--surface-2,#eee)] px-2 py-0.5 text-xs">Locked</span>}
              <label className="ml-auto flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={d.active} disabled={locked} onChange={(e) => update(r.id, { active: e.target.checked })} />
                Active
              </label>
            </div>
            <p className="muted m-0 text-sm">{r.sourceText}{r.note ? ` · ${r.note}` : ""}</p>
            {r.effect.kind !== "invariant" && (
              <div className="flex flex-col gap-2">
                <span className="muted text-xs">{d.when.length ? "When all of these hold" : "Always"}</span>
                {d.when.map((c, i) => (
                  <ConditionRow
                    key={i}
                    c={c}
                    o={options}
                    disabled={locked}
                    onChange={(nc) => update(r.id, { when: d.when.map((x, j) => (j === i ? nc : x)) })}
                    onRemove={() => update(r.id, { when: d.when.filter((_, j) => j !== i) })}
                  />
                ))}
                {!locked && (
                  <div>
                    <Button size="sm" variant="ghost" onClick={() => update(r.id, { when: [...d.when, defaultCondition("totalCad", options)] })}>Add condition</Button>
                  </div>
                )}
              </div>
            )}
            <EffectEditor e={d.effect} o={options} disabled={locked} onChange={(effect) => update(r.id, { effect })} />
            {!locked && dirty.includes(r.id) && (
              <div className="flex gap-2">
                <Button size="sm" variant="solid" disabled={busy} onClick={() => save(r.id)}>Save {r.id}</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => update(r.id, original[r.id])}>Undo</Button>
              </div>
            )}
            {r.updatedBy && <p className="muted m-0 text-xs">Last changed by {r.updatedBy}</p>}
          </Card>
        );
      })}
    </div>
  );
}

function pick(r: Rule) {
  return { active: r.active, when: r.when, effect: r.effect, note: r.note };
}
