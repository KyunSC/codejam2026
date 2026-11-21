import { Suspense } from "react";
import { Breadcrumb } from "@/components/ui";
import { canCreateInvoices } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/current";
import { InvoiceForm } from "./invoice-form";

export default function NewInvoicePage() {
  return (
    <main className="mx-auto w-full max-w-[960px] px-4 pt-8 pb-16 sm:px-5">
      <Breadcrumb items={[{ label: "Invoices", href: "/invoices" }, { label: "New invoice" }]} />
      <h1 className="heading mt-4 mb-2 text-[40px] leading-[.95] sm:text-[56px]">New invoice</h1>
      <p className="muted m-0 mb-8 max-w-[60ch] text-[15px]">
        For an invoice you have on paper or in an email body. Type it as printed; nothing is checked yet.
      </p>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Guarded />
      </Suspense>
    </main>
  );
}

async function Guarded() {
  const { user, org } = await requireUser();
  if (!canCreateInvoices(user.role)) {
    return <p className="form-error">Your role can&rsquo;t create invoices.</p>;
  }
  return <InvoiceForm slug={org.slug} />;
}
