import { Suspense } from "react";
import { Breadcrumb, Card, SectionHeading, StateCard, Timeline } from "@/components/ui";
import { requireUser } from "@/lib/auth/current";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { AppError } from "@/lib/http";
import { ROLE_LABEL } from "@/lib/auth/permissions";
import { SOURCE_LABEL, statusLabel } from "@/lib/invoices/labels";
import { getInvoiceFor } from "@/lib/invoices/service";
import { describeAction } from "@/lib/audit-text";
import { roleCan } from "@/lib/auth/matrix";
import { db } from "@/lib/db";
import { FLAG_KIND_RANK, flagKind } from "@/components/ui";
import type { EvidenceItem, Flag as FlagT, FieldEvidence } from "@/lib/types";
import { ChoicesForm, CodingTable, FlagPanel, type FlagView, type LineView } from "./review-panels";
import { ApprovalPanel, type ChainStep } from "./approval-panel";
import { REJECTION_REASONS, routePreview } from "@/lib/workflow/approvals";
import { loadLiveRefs, personId } from "@/lib/workflow/refs";
import { releaseEligibility } from "@/lib/rules/routing/route";

const STEP_ROLE: Record<string, string> = {
  dept_manager: "department manager",
  finance_manager: "finance manager",
  controller_admin: "controller",
  cfo: "CFO",
};

const EVIDENCE_MARK: Record<FieldEvidence | "unchecked", { text: string; className: string }> = {
  confirmed: { text: "✓ on the page", className: "text-[var(--green)]" },
  not_in_text: { text: "not found in the page text", className: "text-[var(--red)]" },
  uncertain: { text: "two reads disagree", className: "text-[var(--red)]" },
  unreadable: { text: "unreadable", className: "text-[var(--red)]" },
  missing: { text: "not printed", className: "muted" },
  unchecked: { text: "not checked", className: "muted" },
};

const REVIEW_STATES = ["extracted", "needs_review", "coded"];

function flagTitle(code: string): string {
  const t = code.toLowerCase().replace(/_/g, " ");
  return t[0].toUpperCase() + t.slice(1);
}

export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 pt-8 pb-16 sm:px-5">
      <Suspense fallback={<p className="muted">Loading invoice…</p>}>
        <InvoiceView params={params} />
      </Suspense>
    </main>
  );
}

async function InvoiceView({ params }: { params: Promise<{ id: string }> }) {
  const { user, org } = await requireUser();
  const { id } = await params;
  let data;
  try {
    data = await getInvoiceFor(org.id, user, id);
  } catch (err) {
    if (err instanceof AppError && err.status === 404) {
      return (
        <>
          <Breadcrumb items={[{ label: "Invoices", href: "/invoices" }, { label: "Not found" }]} />
          <p className="form-error mt-6">{err.message}</p>
        </>
      );
    }
    throw err;
  }
  const { invoice: inv, history } = data;
  const title = inv.vendorName ?? inv.document?.fileName ?? "Untitled invoice";
  const docUrl = inv.document ? `/api/orgs/${org.slug}/documents/${inv.document.id}` : null;
  const evidence = (inv.evidence ?? {}) as Record<string, FieldEvidence>;
  const hasExtraction = inv.evidence !== null;
  const mark = (key: string | null) => {
    if (!key || !hasExtraction) return null;
    const m = EVIDENCE_MARK[evidence[key] ?? "unchecked"];
    return <span className={`ml-2 text-sm ${m.className}`}>{m.text}</span>;
  };

  const fields: [string, React.ReactNode, string | null][] = [
    ["Vendor", inv.vendorName && `${inv.vendorName}${inv.vendorId ? ` (${inv.vendorId})` : ""}`, "vendorName"],
    ["Invoice number", inv.invoiceNumber, "invoiceNumber"],
    ["Invoice date", inv.invoiceDate && formatDate(inv.invoiceDate), "invoiceDate"],
    ["Due date", inv.dueDate && formatDate(inv.dueDate), "dueDate"],
    ["Currency", inv.currency, null],
    ["PO number", inv.poNumber ?? inv.poId, "poNumber"],
    ["Delivered to", inv.shipToProvince, "billToAddress"],
    ["Department", inv.departmentId, null],
    ["Subtotal", inv.subtotal && formatMoney(inv.subtotal, inv.currency), "subtotal"],
    ["GST / HST", inv.gstHstAmount && formatMoney(inv.gstHstAmount, inv.currency), null],
    ["PST / QST", inv.pstQstAmount && formatMoney(inv.pstQstAmount, inv.currency), null],
    ["Total", inv.total && formatMoney(inv.total, inv.currency), "total"],
    ["Total in CAD", inv.totalCad && inv.currency !== "CAD" ? formatMoney(inv.totalCad, "CAD") : null, null],
  ];

  const canEdit = roleCan(user.role, "invoice.edit") && REVIEW_STATES.includes(inv.status);
  const flags: FlagView[] = inv.flags
    .map((f) => ({
      id: f.id,
      code: f.code,
      title: flagTitle(f.code),
      kind: flagKind({ code: f.code as FlagT["code"], klass: f.klass as FlagT["klass"] }),
      klass: f.klass as FlagView["klass"],
      effect: f.effect as FlagView["effect"],
      status: f.status,
      message: f.message,
      evidence: (f.evidence ?? []) as unknown as EvidenceItem[],
      resolution: f.resolutionNote ? `${f.resolvedById ?? ""} ${f.resolutionNote}`.trim() : null,
    }))
    .sort(
      (a, b) =>
        Number(b.status === "open") - Number(a.status === "open") ||
        Number(b.effect === "hold") - Number(a.effect === "hold") ||
        FLAG_KIND_RANK[a.kind] - FLAG_KIND_RANK[b.kind],
    );
  const canResolve = (f: FlagView) =>
    roleCan(user.role, f.klass === "fraud" ? "flag.resolve.fraud" : "flag.resolve.data_policy");
  const lines: LineView[] = inv.lines.map((l) => ({
    lineNo: l.lineNo,
    description: l.description,
    amount: formatMoney(l.amount, inv.currency),
    glSuggested: l.glSuggested,
    glFinal: l.glFinal,
    departmentSuggested: l.departmentSuggested,
    departmentFinal: l.departmentFinal,
    reason: (l.reason as { account?: string } | null)?.account ?? null,
  }));
  // ---- Approval chain ----
  const people = await db().user.findMany({ where: { organizationId: org.id }, select: { id: true, externalId: true, fullName: true, status: true, delegateId: true } });
  // Steps store row ids; the rules (release eligibility) speak dataset ids. Look up either.
  const byPid = new Map(people.flatMap((p) => [[p.id, p], [personId(p), p]] as const));
  const nameOf = (pid: string | null) => (pid ? (byPid.get(pid)?.fullName ?? pid) : "nobody");
  const me = user.id;
  const firstPending = inv.approvalSteps.find((s) => s.decision === "pending");
  let chain: ChainStep[] = [];
  let blocked: string[] = [];
  let releaserIds: string[] | null = null;
  let isPreview = false;
  const mayPreview = !["employee", "approver"].includes(user.role);
  if (inv.approvalSteps.length > 0) {
    chain = inv.approvalSteps.map((s) => {
      const why = (s.why ?? {}) as { ruleIds?: string[]; replacements?: string[] };
      return {
        who: nameOf(s.assignedToId),
        role: STEP_ROLE[s.role] ?? s.role,
        policy: [why.ruleIds?.join(", "), ...(why.replacements ?? []), s.comment ? `“${s.comment}”` : null].filter(Boolean).join(" · "),
        delegateNote: s.onBehalfOfId ? `acting for ${nameOf(s.onBehalfOfId)} (on leave)` : null,
        state: s.decision !== "pending" ? "done" : s.id === firstPending?.id ? "current" : "waiting",
        decision: s.decision === "pending" ? null : s.decision,
      };
    });
    if (inv.totalCad && ["pending_approval", "approved", "scheduled", "released"].includes(inv.status)) {
      const refs = await loadLiveRefs(db(), org.id);
      const asPeople = inv.approvalSteps.map((s) => ({ assignedToId: refs.people.toPerson(s.assignedToId), onBehalfOfId: refs.people.toPerson(s.onBehalfOfId) }));
      releaserIds = releaseEligibility(Number(inv.totalCad), asPeople, refs.policyRules, refs).releaserIds;
    }
  } else if (inv.status === "coded" && mayPreview) {
    const p = await db().$transaction((tx) => routePreview(tx, org.id, inv.id), { timeout: 60_000 });
    isPreview = true;
    chain = p.route.steps.map((s) => ({
      who: nameOf(s.assignedToId),
      role: STEP_ROLE[s.role] ?? s.role,
      policy: [s.ruleIds.join(", "), ...s.replacements].filter(Boolean).join(" · "),
      delegateNote: s.onBehalfOfId ? `acting for ${nameOf(s.onBehalfOfId)} (on leave)` : null,
      state: "waiting",
      decision: null,
    }));
    blocked = [...p.route.blocked, ...(p.release.blockedReason ? [p.release.blockedReason] : [])];
    releaserIds = p.release.releaserIds;
  }
  const assignee = firstPending ? byPid.get(firstPending.assignedToId) : undefined;
  const canDecide =
    inv.status === "pending_approval" &&
    roleCan(user.role, "invoice.decide") &&
    !!firstPending &&
    (firstPending.assignedToId === me || (assignee?.status === "on_leave" && assignee.delegateId === user.id));
  const showApprovals = chain.length > 0 || inv.status === "coded";

  const [accounts, departments, vendors, pos] = await Promise.all([
    db().glAccount.findMany({ where: { organizationId: org.id, accountType: "expense" }, orderBy: { id: "asc" }, select: { id: true, name: true } }),
    db().department.findMany({ where: { organizationId: org.id }, orderBy: { id: "asc" }, select: { id: true, name: true } }),
    canEdit ? db().vendor.findMany({ where: { organizationId: org.id }, orderBy: { id: "asc" }, select: { id: true, legalName: true } }) : [],
    canEdit && inv.vendorId
      ? db().purchaseOrder.findMany({ where: { organizationId: org.id, vendorId: inv.vendorId, status: { not: "closed" } }, orderBy: { id: "asc" }, select: { id: true } })
      : [],
  ]);

  return (
    <>
      <Breadcrumb items={[{ label: "Invoices", href: "/invoices" }, { label: title }]} />
      <h1 className="heading mt-4 mb-6 text-[36px] leading-[.95] sm:text-[52px]">{title}</h1>

      <StateCard
        items={[
          { label: "Status", value: <span className="label">{statusLabel(inv.status)}</span> },
          { label: "Waiting on", value: inv.assignedTo?.fullName ?? <span className="muted">Nobody yet</span> },
          {
            label: "Brought in by",
            value: inv.createdBy ? `${inv.createdBy.fullName} (${ROLE_LABEL[inv.createdBy.role]})` : <span className="muted">—</span>,
          },
          { label: "Came from", value: SOURCE_LABEL[inv.source] },
          { label: "Received", value: <span className="num">{formatDateTime(inv.createdAt)}</span> },
        ]}
      />

      {flags.length > 0 && (
        <section aria-labelledby="flags" className="mt-10">
          <SectionHeading id="flags" level={3}>
            What the checks found
          </SectionHeading>
          <div className="grid gap-5 lg:grid-cols-2">
            {flags.map((f) => (
              <FlagPanel key={f.id} slug={org.slug} invoiceId={inv.id} flag={f} canResolve={canResolve(f)} />
            ))}
          </div>
        </section>
      )}

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-labelledby="doc">
          <SectionHeading id="doc" level={3}>
            Document
          </SectionHeading>
          {inv.document && docUrl ? (
            <Card className="overflow-hidden">
              {inv.document.mimeType.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={docUrl} alt={`Scan of ${inv.document.fileName}`} className="block w-full" />
              ) : (
                <iframe src={docUrl} title={inv.document.fileName} className="block h-[720px] w-full border-0 bg-white" />
              )}
              <div className="muted flex flex-wrap justify-between gap-2 border-t-2 border-border px-4 py-3 text-sm">
                <span>
                  {inv.document.fileName} · {Math.round(inv.document.sizeBytes / 1024)} KB
                </span>
                <a href={docUrl} target="_blank" rel="noreferrer" className="font-semibold text-text underline underline-offset-4">
                  Open file
                </a>
              </div>
            </Card>
          ) : (
            <Card className="p-6">
              <p className="muted m-0 text-[15px]">No file: this invoice was typed into the invoice form.</p>
            </Card>
          )}
        </section>

        <div className="flex flex-col gap-10">
          <section aria-labelledby="fields">
            <SectionHeading id="fields" level={3}>
              Details
            </SectionHeading>
            <Card className="p-6">
              <dl className="m-0 grid grid-cols-[minmax(130px,auto)_1fr] gap-x-6 gap-y-3 text-[15px]">
                {fields
                  .filter(([label, value]) => value || label !== "Total in CAD")
                  .map(([label, value, key]) => (
                    <div key={label} className="contents">
                      <dt className="muted">{label}</dt>
                      <dd className="m-0 num">
                        {value || <span className="muted">Not filled in</span>}
                        {mark(key)}
                      </dd>
                    </div>
                  ))}
              </dl>
              {!inv.vendorName && inv.document && (
                <p className="muted m-0 mt-5 text-sm">The fields fill in once the file has been read.</p>
              )}
            </Card>
          </section>

          {canEdit && (
            <section aria-labelledby="choices">
              <SectionHeading id="choices" level={3}>
                Vendor, department and PO
              </SectionHeading>
              <ChoicesForm
                slug={org.slug}
                invoiceId={inv.id}
                version={inv.version}
                current={{ vendorId: inv.vendorId, departmentId: inv.departmentId, shipToProvince: inv.shipToProvince, poId: inv.poId }}
                vendors={vendors.map((v) => ({ id: v.id, name: v.legalName }))}
                departments={departments}
                pos={pos.map((p) => p.id)}
              />
            </section>
          )}

          {lines.length > 0 && (
            <section aria-labelledby="lines">
              <SectionHeading id="lines" level={3}>
                Lines and coding
              </SectionHeading>
              <CodingTable
                slug={org.slug}
                invoiceId={inv.id}
                version={inv.version}
                lines={lines}
                accounts={accounts}
                departments={departments}
                editable={canEdit}
              />
            </section>
          )}

          {showApprovals && (
            <section aria-labelledby="approvals">
              <SectionHeading id="approvals" level={3}>
                Approval chain
              </SectionHeading>
              <ApprovalPanel
                slug={org.slug}
                invoiceId={inv.id}
                version={inv.version}
                steps={chain}
                isPreview={isPreview}
                blocked={blocked}
                releasers={releaserIds === null ? null : releaserIds.length ? releaserIds.map(nameOf).join(", ") : "nobody"}
                canSubmit={inv.status === "coded" && roleCan(user.role, "invoice.submit")}
                canDecide={canDecide}
                canReopen={inv.status === "rejected" && roleCan(user.role, "invoice.edit")}
                reasons={REJECTION_REASONS}
              />
            </section>
          )}

          {inv.payments.length > 0 && (
            <section aria-labelledby="payment">
              <SectionHeading id="payment" level={3}>
                Payment
              </SectionHeading>
              <Card className="flex flex-col gap-2 p-6 text-[15px]">
                {inv.payments.map((p) => (
                  <div key={p.id}>
                    <b>{p.id}</b> · {p.method} · {formatMoney(p.amount, p.currency)} · {p.status}
                    <span className="muted"> · scheduled {formatDate(p.scheduledDate)}</span>
                    {p.reference && <span className="muted num"> · {p.reference}</span>}
                    {p.releasedById && <span className="muted"> · released by {nameOf(p.releasedById)}</span>}
                    {p.failureReason && <span className="form-error block">{p.failureReason}</span>}
                  </div>
                ))}
              </Card>
            </section>
          )}

          {(inv.email || inv.note) && (
            <section aria-labelledby="context">
              <SectionHeading id="context" level={3}>
                {inv.email ? "Email it came with" : "Note"}
              </SectionHeading>
              <Card className="flex flex-col gap-2 p-6 text-[15px]">
                {inv.email && (
                  <>
                    <div>
                      <span className="muted">From </span>
                      {inv.email.fromName} &lt;{inv.email.fromAddress}&gt;
                    </div>
                    <div>
                      <span className="muted">Subject </span>
                      {inv.email.subject}
                    </div>
                    <div className="muted num text-sm">{formatDateTime(inv.email.receivedAt)}</div>
                    <p className="m-0 mt-2 whitespace-pre-wrap">{inv.email.body}</p>
                  </>
                )}
                {inv.note && (
                  <p className="m-0 whitespace-pre-wrap">
                    <span className="muted">Note: </span>
                    {inv.note}
                  </p>
                )}
              </Card>
            </section>
          )}

          <section aria-labelledby="history">
            <SectionHeading id="history" level={3}>
              History
            </SectionHeading>
            <Card className="p-6">
              <Timeline
                events={history.map((h) => ({
                  at: formatDateTime(h.at),
                  text: describeAction(h, h.actorName),
                }))}
              />
            </Card>
          </section>
        </div>
      </div>
    </>
  );
}
