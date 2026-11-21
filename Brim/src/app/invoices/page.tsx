import Link from "next/link";
import { Suspense } from "react";
import { ButtonLink, EmptyState, PrimaryCell, SectionHeading, TableCard } from "@/components/ui";
import { FilterBar, FilterSelect, FilterText } from "@/components/filters";
import { canCreateInvoices, canReadAllInvoices } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/current";
import { formatDate, formatMoney, param } from "@/lib/format";
import { SOURCE_LABEL, STATUS_LABEL, statusLabel } from "@/lib/invoices/labels";
import { type InvoiceListRow, listInvoicesFor } from "@/lib/invoices/service";
import { UploadPanel } from "./upload-panel";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default function InvoicesPage({ searchParams }: { searchParams: SP }) {
  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 pt-10 pb-16 sm:px-5">
      <Suspense fallback={<p className="muted">Loading invoices…</p>}>
        <InvoicesView searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function InvoicesView({ searchParams }: { searchParams: SP }) {
  const { user, org } = await requireUser();
  const sp = await searchParams;
  const filter = { scope: param(sp.scope), q: param(sp.q), status: param(sp.status), source: param(sp.source) };
  const { inProgress, sent, scope } = await listInvoicesFor(user, filter);
  const filtered = !!(filter.q || filter.status || filter.source);

  return (
    <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="label muted m-0 mb-3 text-sm">{org.name}</p>
          <h1 className="heading m-0 text-[40px] leading-[.95] sm:text-[56px]">
            {scope === "all" ? "All invoices" : "Your invoices"}
          </h1>
          <p className="muted m-0 mt-3 max-w-[60ch] text-[15px]">
            {scope === "all"
              ? "Every invoice in the organization."
              : "Invoices you brought in, invoices waiting on you" +
                (user.role === "ap_clerk" ? ", and new ones nobody has picked up yet." : ".")}
          </p>
        </div>
        {canCreateInvoices(user.role) && (
          <div className="flex flex-wrap items-start gap-3">
            <UploadPanel slug={org.slug} asEmployee={user.role === "employee"} />
            <ButtonLink href="/invoices/new">New invoice</ButtonLink>
          </div>
        )}
      </div>

      <FilterBar action="/invoices" resetHref="/invoices">
        <FilterText name="q" label="Search" defaultValue={filter.q} placeholder="Vendor, number, PO, file, sender" />
        <FilterSelect
          name="status"
          label="Status"
          defaultValue={filter.status}
          options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <FilterSelect
          name="source"
          label="Came from"
          defaultValue={filter.source}
          options={Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))}
        />
        {canReadAllInvoices(user.role) && (
          <FilterSelect
            name="scope"
            label="Show"
            defaultValue={scope}
            allLabel={null}
            options={[
              { value: "mine", label: "Mine" },
              { value: "all", label: "Everyone's" },
            ]}
          />
        )}
      </FilterBar>

      <section aria-labelledby="in-progress" className="mt-10">
        <SectionHeading id="in-progress" level={3}>
          In progress <span className="muted num">({inProgress.length})</span>
        </SectionHeading>
        {inProgress.length ? (
          <InvoiceTable rows={inProgress} label="Invoices in progress" />
        ) : (
          <EmptyState title={filtered ? "Nothing matches these filters" : "Nothing in progress"}>
            {filtered
              ? "Change or clear the filters to see more."
              : canCreateInvoices(user.role)
                ? "Upload a PDF or fill in the invoice form, and it shows up here."
                : "Invoices that wait on you show up here."}
          </EmptyState>
        )}
      </section>

      <section aria-labelledby="sent" className="mt-12">
        <SectionHeading id="sent" level={3}>
          Payment sent <span className="muted num">({sent.length})</span>
        </SectionHeading>
        {sent.length ? (
          <InvoiceTable rows={sent} label="Invoices with payment sent" />
        ) : (
          <EmptyState title="No payments sent yet">Invoices move here once their payment has gone out.</EmptyState>
        )}
      </section>
    </>
  );
}

function InvoiceTable({ rows, label }: { rows: InvoiceListRow[]; label: string }) {
  return (
    <TableCard label={label} minWidth={900}>
      <thead>
        <tr>
          <th>Invoice</th>
          <th>Came from</th>
          <th>Status</th>
          <th>Brought in by</th>
          <th>Waiting on</th>
          <th>Received</th>
          <th className="amt">Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>
              <Link href={`/invoices/${r.id}`} className="no-underline hover:underline">
                <PrimaryCell
                  title={r.vendorName ?? r.document?.fileName ?? "Untitled invoice"}
                  detail={
                    [r.invoiceNumber && `No. ${r.invoiceNumber}`, !r.vendorName && "not read yet"].filter(Boolean).join(" · ") ||
                    undefined
                  }
                />
              </Link>
            </td>
            <td className="text-sm">
              {SOURCE_LABEL[r.source]}
              {r.email && <div className="muted text-xs">{r.email.fromAddress}</div>}
            </td>
            <td className="text-sm">{statusLabel(r.status)}</td>
            <td className="text-sm">{r.createdBy?.fullName ?? <span className="muted">—</span>}</td>
            <td className="text-sm">{r.assignedTo?.fullName ?? <span className="muted">Nobody yet</span>}</td>
            <td className="num text-sm whitespace-nowrap">{formatDate(r.createdAt)}</td>
            <td className="amt">{formatMoney(r.total, r.currency)}</td>
          </tr>
        ))}
      </tbody>
    </TableCard>
  );
}
