"use client";

/**
 * The interactive parts of the invoice screen: resolving a flag, choosing what resolution could not
 * decide, and accepting or changing each line's coding. Every action calls the API (the server checks
 * the role, the version and the state) and then refreshes the page.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, FlagCard, TableCard, type FlagKind } from "@/components/ui";
import { FormError, Select, TextArea } from "@/components/forms/form-bits";
import { send } from "@/lib/client/api";
import type { EvidenceItem } from "@/lib/types";

export interface FlagView {
  id: string;
  code: string;
  title: string;
  kind: FlagKind;
  klass: "data" | "policy" | "fraud";
  effect: "hold" | "route" | "info";
  status: string;
  message: string;
  evidence: EvidenceItem[];
  resolution: string | null;
}

const EFFECT_TEXT: Record<FlagView["effect"], string> = {
  hold: "Holds payment until resolved",
  route: "Adds an approval step",
  info: "For information",
};

function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }
  return { error, busy, run };
}

/** One flag as a sentence with its evidence, and the action that resolves it for this role. */
export function FlagPanel({
  slug,
  invoiceId,
  flag,
  canResolve,
}: {
  slug: string;
  invoiceId: string;
  flag: FlagView;
  canResolve: boolean;
}) {
  const { error, busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const isOpen = flag.status === "open";
  const resolve = (action: "override" | "confirm") =>
    run(() => send("POST", `/api/orgs/${slug}/invoices/${invoiceId}/flags/${flag.id}/resolve`, { action, reason }));

  const overrideLabel =
    flag.klass === "data" ? "Accept as printed" : flag.klass === "fraud" ? "Not a problem" : "Override";
  const who =
    flag.klass === "fraud" ? "A finance manager or controller resolves this." : "An AP clerk resolves this.";

  return (
    <FlagCard
      kind={flag.kind}
      title={flag.title}
      message={
        <>
          {flag.message}
          <span className="muted mt-1 block text-sm">
            {isOpen ? EFFECT_TEXT[flag.effect] : `${flag.status[0].toUpperCase()}${flag.status.slice(1)}`}
            {flag.resolution && ` · ${flag.resolution}`}
          </span>
        </>
      }
      evidence={flag.evidence}
      actions={
        isOpen ? (
          canResolve ? (
            open ? (
              <div className="flex w-full flex-col gap-2.5">
                <TextArea
                  aria-label="Reason"
                  placeholder="Why, in a sentence (required)"
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="flex flex-wrap gap-2.5">
                  <Button size="sm" variant="solid" disabled={busy} onClick={() => resolve("override")}>
                    {overrideLabel}
                  </Button>
                  {flag.klass === "fraud" && (
                    <Button size="sm" disabled={busy} onClick={() => resolve("confirm")}>
                      {flag.code.startsWith("DUP_") ? "Confirm duplicate" : "Confirm problem"}
                    </Button>
                  )}
                  <Button size="sm" disabled={busy} onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                </div>
                {flag.klass === "data" && (
                  <p className="muted m-0 text-sm">Or correct the field below; the check re-runs on save.</p>
                )}
                <FormError message={error} />
              </div>
            ) : (
              <Button size="sm" onClick={() => setOpen(true)}>
                Resolve…
              </Button>
            )
          ) : (
            <span className="muted text-sm">{who}</span>
          )
        ) : null
      }
    />
  );
}

export interface LineView {
  lineNo: number;
  description: string;
  amount: string;
  glSuggested: string | null;
  glFinal: string | null;
  departmentSuggested: string | null;
  departmentFinal: string | null;
  reason: string | null;
}

/** Lines with the suggested account and why; the clerk accepts it or picks another. */
export function CodingTable({
  slug,
  invoiceId,
  version,
  lines,
  accounts,
  departments,
  editable,
}: {
  slug: string;
  invoiceId: string;
  version: number;
  lines: LineView[];
  accounts: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  editable: boolean;
}) {
  const { error, busy, run } = useAction();
  const patch = (body: unknown) =>
    run(() => send("PATCH", `/api/orgs/${slug}/invoices/${invoiceId}`, body, { "If-Match": String(version) }));
  const acctName = (id: string | null) => (id ? `${id} ${accounts.find((a) => a.id === id)?.name ?? ""}`.trim() : "—");
  const pending = lines.filter((l) => !l.glFinal && l.glSuggested);

  return (
    <div className="flex flex-col gap-3">
      <TableCard label="Invoice lines and coding" minWidth={720}>
        <thead>
          <tr>
            <th>#</th>
            <th>Description</th>
            <th className="amt">Amount</th>
            <th>Account</th>
            <th>Department</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.lineNo}>
              <td className="num">{l.lineNo}</td>
              <td>
                {l.description}
                {l.reason && <span className="muted mt-1 block text-sm">{l.reason}</span>}
              </td>
              <td className="amt">{l.amount}</td>
              <td>
                {editable ? (
                  <Select
                    aria-label={`Account for line ${l.lineNo}`}
                    value={l.glFinal ?? ""}
                    disabled={busy}
                    onChange={(e) => patch({ lines: [{ lineNo: l.lineNo, glFinal: e.target.value || null }] })}
                  >
                    <option value="">Suggested: {acctName(l.glSuggested)}</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.id} {a.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span>
                    {acctName(l.glFinal ?? l.glSuggested)}
                    {!l.glFinal && l.glSuggested && <span className="muted"> (suggested)</span>}
                  </span>
                )}
              </td>
              <td>
                {editable ? (
                  <Select
                    aria-label={`Department for line ${l.lineNo}`}
                    value={l.departmentFinal ?? ""}
                    disabled={busy}
                    onChange={(e) => patch({ lines: [{ lineNo: l.lineNo, departmentFinal: e.target.value || null }] })}
                  >
                    <option value="">Suggested: {l.departmentSuggested ?? "none"}</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.id} {d.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  (l.departmentFinal ?? l.departmentSuggested ?? "—")
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableCard>
      {editable && pending.length > 0 && (
        <div>
          <Button
            variant="solid"
            size="sm"
            disabled={busy}
            onClick={() => patch({ lines: pending.map((l) => ({ lineNo: l.lineNo, accept: true })) })}
          >
            Accept {pending.length === lines.length ? "all suggestions" : `${pending.length} remaining suggestions`}
          </Button>
        </div>
      )}
      <FormError message={error} />
    </div>
  );
}

/** What resolution could not decide (or got wrong): vendor, department, province, PO. */
export function ChoicesForm({
  slug,
  invoiceId,
  version,
  current,
  vendors,
  departments,
  pos,
}: {
  slug: string;
  invoiceId: string;
  version: number;
  current: { vendorId: string | null; departmentId: string | null; shipToProvince: string | null; poId: string | null };
  vendors: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  pos: string[];
}) {
  const { error, busy, run } = useAction();
  const [c, setC] = useState(current);
  const changed = (Object.keys(c) as Array<keyof typeof c>).filter((k) => c[k] !== current[k]);
  const save = () =>
    run(() =>
      send(
        "PATCH",
        `/api/orgs/${slug}/invoices/${invoiceId}`,
        { choices: Object.fromEntries(changed.map((k) => [k, c[k] ?? ""])) },
        { "If-Match": String(version) },
      ),
    );
  const pick = (k: keyof typeof c) => (e: React.ChangeEvent<HTMLSelectElement>) => setC({ ...c, [k]: e.target.value || null });

  return (
    <Card className="flex flex-col gap-3 p-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">
          <span>Vendor</span>
          <Select value={c.vendorId ?? ""} onChange={pick("vendorId")}>
            <option value="">Not resolved</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id} {v.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span>Department</span>
          <Select value={c.departmentId ?? ""} onChange={pick("departmentId")}>
            <option value="">None</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.id} {d.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span>Delivered to (bill-to province)</span>
          <Select value={c.shipToProvince ?? ""} onChange={pick("shipToProvince")}>
            <option value="">Unknown</option>
            {["ON", "BC", "AB", "QC"].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span>Purchase order</span>
          <Select value={c.poId ?? ""} onChange={pick("poId")}>
            <option value="">None</option>
            {pos.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <div>
        <Button variant="solid" size="sm" disabled={busy || changed.length === 0} onClick={save}>
          Save and re-check
        </Button>
      </div>
      <FormError message={error} />
    </Card>
  );
}
