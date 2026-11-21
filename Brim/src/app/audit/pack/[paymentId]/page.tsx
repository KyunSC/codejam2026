import Link from "next/link";
import { Suspense } from "react";
import { Breadcrumb, Card, SectionHeading, StateCard, TableCard } from "@/components/ui";
import { actionText } from "@/lib/audit-text";
import { requireUser } from "@/lib/auth/current";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { AppError } from "@/lib/http";
import { auditPack } from "@/lib/workflow/audit-pack";

export default function AuditPackPage({ params }: { params: Promise<{ paymentId: string }> }) {
  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 pt-8 pb-16 sm:px-5">
      <Suspense fallback={<p className="muted">Loading the audit pack…</p>}>
        <PackView params={params} />
      </Suspense>
    </main>
  );
}

const who = (p: { id: string; name: string } | null) => (p ? `${p.name} (${p.id})` : "—");

async function PackView({ params }: { params: Promise<{ paymentId: string }> }) {
  const { user, org } = await requireUser();
  const { paymentId } = await params;
  let pack;
  try {
    pack = await auditPack(user, paymentId);
  } catch (e) {
    if (e instanceof AppError) return <p className="form-error">{e.message}</p>;
    throw e;
  }
  const { payment: p, invoice: inv } = pack;
  const bank = pack.bank as { institution?: string; transit?: string; account?: string; last4?: string } | null;

  return (
    <>
      <Breadcrumb items={[{ label: "Audit log", href: "/audit" }, { label: `Audit pack ${p.id}` }]} />
      <h1 className="heading mt-4 mb-2 text-[36px] leading-[.95] sm:text-[52px]">Audit pack {p.id}</h1>
      <p className="muted m-0 mb-6 text-[15px]">
        {p.vendorName} · invoice <Link href={`/invoices/${inv.id}`}>{inv.id}</Link> · {p.source === "history" ? "imported from history" : "made in the app"}
      </p>
      {user.role === "auditor" && <p className="form-error mb-6">Read-only: the auditor changes nothing.</p>}

      <StateCard
        items={[
          { label: "Payment", value: `${formatMoney(p.amount, p.currency)} · ${p.method}` },
          { label: "Status", value: p.status },
          { label: "Reference", value: <span className="num">{p.reference ?? "—"}</span> },
          { label: "Prepared by", value: who(p.preparedBy) },
          { label: "Released by", value: who(p.releasedBy) },
        ]}
      />

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <section>
          <SectionHeading id="inv" level={3}>Invoice</SectionHeading>
          <Card className="p-6 text-[15px]">
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
              <dt className="muted">Number</dt><dd className="m-0">{inv.invoiceNumber ?? "—"}</dd>
              <dt className="muted">Dated / due</dt><dd className="m-0">{formatDate(inv.invoiceDate)} / {formatDate(inv.dueDate)}</dd>
              <dt className="muted">Total</dt><dd className="m-0 num">{formatMoney(inv.total, inv.currency)}{inv.currency !== "CAD" && inv.totalCad ? ` (${formatMoney(inv.totalCad, "CAD")})` : ""}</dd>
              <dt className="muted">Department</dt><dd className="m-0">{inv.departmentId ?? "—"}</dd>
              <dt className="muted">Requester</dt><dd className="m-0">{who(inv.requester)}</dd>
              <dt className="muted">Document</dt>
              <dd className="m-0">
                {inv.document ? <a href={`/api/orgs/${org.slug}/documents/${inv.document.id}`} target="_blank" rel="noreferrer">{inv.document.fileName}</a> : <span className="muted">No file (history or typed in)</span>}
              </dd>
              <dt className="muted">Paid to</dt>
              <dd className="m-0">
                {bank ? `${bank.institution ?? ""}-${bank.transit ?? ""} ${bank.account ?? bank.last4}` : "—"}
                {pack.bankSource && <span className="muted block text-sm">{pack.bankSource}</span>}
              </dd>
              <dt className="muted">Paid on</dt><dd className="m-0">{p.paidDate ? formatDate(p.paidDate) : `scheduled ${formatDate(p.scheduledDate)}`}</dd>
            </dl>
          </Card>
        </section>

        <section>
          <SectionHeading id="appr" level={3}>Approvals</SectionHeading>
          <Card className="flex flex-col gap-3 p-6 text-[15px]">
            {pack.approvals.length === 0 && <p className="muted m-0">No approval steps recorded.</p>}
            {pack.approvals.map((a) => (
              <div key={a.stepNo}>
                <b>Step {a.stepNo}</b> · {a.role.replace("_", " ")} · {a.decision} by {who(a.decidedBy ?? a.assignedTo)}
                {a.onBehalfOf && <span> on behalf of {who(a.onBehalfOf)}</span>}
                {a.decidedAt && <span className="muted"> · {formatDateTime(a.decidedAt)}</span>}
                {a.comment && <span className="muted block text-sm">“{a.comment}”</span>}
              </div>
            ))}
          </Card>
        </section>
      </div>

      <section className="mt-10">
        <SectionHeading id="coding" level={3}>Coding and posting</SectionHeading>
        <div className="grid gap-6 lg:grid-cols-2">
          <TableCard label="Coding" minWidth={480}>
            <thead><tr><th>#</th><th>Description</th><th>Account</th><th className="amt">Amount</th></tr></thead>
            <tbody>
              {pack.coding.map((l) => (
                <tr key={l.lineNo}>
                  <td className="num">{l.lineNo}</td>
                  <td>{l.description}</td>
                  <td>{l.glFinal ?? l.glSuggested ?? "—"}{l.overridden && <span className="muted block text-xs">suggested {l.glSuggested}, changed by the clerk</span>}</td>
                  <td className="amt">{formatMoney(l.amount, inv.currency)}</td>
                </tr>
              ))}
            </tbody>
          </TableCard>
          <TableCard label="Posting" minWidth={480}>
            <thead><tr><th>Account</th><th className="amt">Debit</th><th className="amt">Credit</th><th>Note</th></tr></thead>
            <tbody>
              {pack.posting.map((l, i) => (
                <tr key={i}>
                  <td>{l.account} <span className="muted text-sm">{l.name}</span></td>
                  <td className="amt">{l.debit ? formatMoney(l.debit, inv.currency) : ""}</td>
                  <td className="amt">{l.credit ? formatMoney(l.credit, inv.currency) : ""}</td>
                  <td className="muted text-sm">{l.note}</td>
                </tr>
              ))}
            </tbody>
          </TableCard>
        </div>
      </section>

      <section className="mt-10">
        <SectionHeading id="flags" level={3}>Flags and how each was resolved</SectionHeading>
        <Card className="flex flex-col gap-2 p-6 text-[15px]">
          {pack.flags.length === 0 && <p className="muted m-0">No flags were raised on this invoice.</p>}
          {pack.flags.map((f) => (
            <p key={f.id} className="m-0">
              <b>{f.code}</b> ({f.klass}/{f.effect}) — {f.message}{" "}
              <span className="muted">· {f.status}{f.resolvedBy ? ` by ${who(f.resolvedBy)}` : ""}{f.resolutionNote ? `: ${f.resolutionNote}` : ""}</span>
            </p>
          ))}
        </Card>
      </section>

      <section className="mt-10">
        <SectionHeading id="events" level={3}>Every recorded action</SectionHeading>
        <TableCard label="Audit events" minWidth={760}>
          <thead><tr><th>#</th><th>When</th><th>Who</th><th>What</th><th>Source</th></tr></thead>
          <tbody>
            {pack.events.map((e) => (
              <tr key={e.seq}>
                <td className="num text-sm">{e.seq}</td>
                <td className="num text-sm">{formatDateTime(e.at)}</td>
                <td className="text-sm">{e.actor ? who(e.actor) : e.actorType}{e.onBehalfOf && <span className="muted block text-xs">for {who(e.onBehalfOf)}</span>}</td>
                <td className="text-sm">{actionText(e.action)}{e.reason && <span className="muted block text-xs">“{e.reason}”</span>}</td>
                <td className="muted text-sm">{e.source}</td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      </section>
    </>
  );
}
