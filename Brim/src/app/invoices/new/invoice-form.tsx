"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, SectionHeading } from "@/components/ui";
import { Field, FormError, Input, Select, TextArea } from "@/components/forms/form-bits";
import { send } from "@/lib/client/api";
import { OFFICES, PROVINCE_NAMES } from "@/lib/rules/offices";

type Line = { description: string; quantity: string; unitPrice: string; amount: string };
const emptyLine = (): Line => ({ description: "", quantity: "", unitPrice: "", amount: "" });

export function InvoiceForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function setLine(i: number, key: keyof Line, value: string) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [key]: value } : l)));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { ...Object.fromEntries(new FormData(e.currentTarget)), lines };
    try {
      const invoice = await send<{ id: string }>("POST", `/api/orgs/${slug}/invoices`, body);
      router.push(`/invoices/${invoice.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Saving failed.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-8">
      <Card className="grid grid-cols-1 gap-5 p-6 sm:grid-cols-2 sm:p-8">
        <Field label="Vendor">
          <Input name="vendorName" required />
        </Field>
        <Field label="Invoice number">
          <Input name="invoiceNumber" required />
        </Field>
        <Field label="Invoice date">
          <Input name="invoiceDate" type="date" />
        </Field>
        <Field label="Due date">
          <Input name="dueDate" type="date" />
        </Field>
        <Field label="Currency">
          <Select name="currency" defaultValue="CAD">
            <option value="CAD">CAD</option>
            <option value="USD">USD</option>
          </Select>
        </Field>
        <Field label="PO number" hint="Optional.">
          <Input name="poNumber" />
        </Field>
        <Field label="Delivered to" hint="The office on the bill-to address. It decides which tax the checks expect.">
          <Select name="deliveredTo" defaultValue="">
            <option value="">Not shown on the invoice</option>
            {OFFICES.map((o) => (
              <option key={o.province} value={o.province}>
                {o.city} ({PROVINCE_NAMES[o.province]})
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      <section>
        <SectionHeading level={3}>Lines</SectionHeading>
        <Card className="flex flex-col gap-4 p-6 sm:p-8">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[1fr_110px_130px_130px_auto]">
              <div className="col-span-2 sm:col-span-1">
                <Field label={`Line ${i + 1}: description`}>
                  <Input value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} />
                </Field>
              </div>
              <Field label="Quantity">
                <Input inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, "quantity", e.target.value)} />
              </Field>
              <Field label="Unit price">
                <Input inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(i, "unitPrice", e.target.value)} />
              </Field>
              <Field label="Amount">
                <Input inputMode="decimal" value={l.amount} onChange={(e) => setLine(i, "amount", e.target.value)} />
              </Field>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [emptyLine()]))}
                aria-label={`Remove line ${i + 1}`}
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="btn btn--ghost btn--sm self-start" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
            Add line
          </button>
        </Card>
      </section>

      <Card className="grid grid-cols-1 gap-5 p-6 sm:grid-cols-2 sm:p-8">
        <Field label="Subtotal">
          <Input name="subtotal" inputMode="decimal" />
        </Field>
        <Field label="GST / HST">
          <Input name="gstHstAmount" inputMode="decimal" />
        </Field>
        <Field label="PST / QST">
          <Input name="pstQstAmount" inputMode="decimal" />
        </Field>
        <Field label="Total">
          <Input name="total" inputMode="decimal" required />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Note" hint="Optional.">
            <TextArea name="note" />
          </Field>
        </div>
      </Card>

      <FormError message={error} />
      <div className="flex gap-3">
        <button type="submit" className="btn btn--solid" disabled={busy}>
          {busy ? "Saving…" : "Save invoice"}
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => router.push("/invoices")}>
          Cancel
        </button>
      </div>
    </form>
  );
}
