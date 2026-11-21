import { Suspense } from "react";
import { Breadcrumb, Card, SectionHeading, StateCard, TableCard, Timeline } from "@/components/ui";
import { requireUser } from "@/lib/auth/current";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { AppError } from "@/lib/http";
import { ROLE_LABEL } from "@/lib/auth/permissions";
import { SOURCE_LABEL, statusLabel } from "@/lib/invoices/labels";
import { getInvoiceFor } from "@/lib/invoices/service";
import { describeAction } from "@/lib/audit-text";

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

  const fields: [string, React.ReactNode][] = [
    ["Vendor", inv.vendorName],
    ["Invoice number", inv.invoiceNumber],
    ["Invoice date", inv.invoiceDate && formatDate(inv.invoiceDate)],
    ["Due date", inv.dueDate && formatDate(inv.dueDate)],
    ["Currency", inv.currency],
    ["PO number", inv.poNumber],
    ["Subtotal", inv.subtotal && formatMoney(inv.subtotal, inv.currency)],
    ["GST / HST", inv.gstHstAmount && formatMoney(inv.gstHstAmount, inv.currency)],
    ["PST / QST", inv.pstQstAmount && formatMoney(inv.pstQstAmount, inv.currency)],
    ["Total", inv.total && formatMoney(inv.total, inv.currency)],
  ];

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
                {fields.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="muted">{label}</dt>
                    <dd className="m-0 num">{value || <span className="muted">Not filled in</span>}</dd>
                  </div>
                ))}
              </dl>
              {!inv.vendorName && inv.document && (
                <p className="muted m-0 mt-5 text-sm">The fields fill in once the file has been read.</p>
              )}
            </Card>
          </section>

          {inv.lines.length > 0 && (
            <section aria-labelledby="lines">
              <SectionHeading id="lines" level={3}>
                Lines
              </SectionHeading>
              <TableCard label="Invoice lines" minWidth={520}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Description</th>
                    <th className="amt">Qty</th>
                    <th className="amt">Unit price</th>
                    <th className="amt">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="num">{l.lineNo}</td>
                      <td>{l.description}</td>
                      <td className="amt">{l.quantity?.toString() ?? "—"}</td>
                      <td className="amt">{formatMoney(l.unitPrice)}</td>
                      <td className="amt">{formatMoney(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableCard>
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
