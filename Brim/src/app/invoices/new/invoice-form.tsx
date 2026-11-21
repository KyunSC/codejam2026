"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, SectionHeading } from "@/components/ui";
import { Field, FormError, Input, Select, TextArea } from "@/components/forms/form-bits";
import { send } from "@/lib/client/api";
import { type TaxChoice, computeTotals, lineAmount } from "@/lib/invoices/totals";

/** `amountTyped`: the amount was typed by hand, so quantity × unit price no longer overwrites it. */
type Line = { description: string; quantity: string; unitPrice: string; amount: string; amountTyped: boolean };
const emptyLine = (): Line => ({ description: "", quantity: "", unitPrice: "", amount: "", amountTyped: false });

type TotalsForm = { subtotal: string; gstHstAmount: string; pstQstAmount: string; total: string };

export function InvoiceForm({ slug, taxChoices }: { slug: string; taxChoices: TaxChoice[] }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [totals, setTotals] = useState<TotalsForm>({ subtotal: "", gstHstAmount: "", pstQstAmount: "", total: "" });
  const [taxId, setTaxId] = useState(taxChoices[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function setLine(i: number, key: "description" | "quantity" | "unitPrice" | "amount", value: string) {
    setLines((ls) =>
      ls.map((l, j) => {
        if (j !== i) return l;
        const next = { ...l, [key]: value };
        if (key === "amount") return { ...next, amountTyped: value.trim() !== "" };
        if ((key === "quantity" || key === "unitPrice") && !l.amountTyped) {
          next.amount = lineAmount(next.quantity, next.unitPrice) ?? "";
        }
        return next;
      }),
    );
  }

  function calculate() {
    const t = computeTotals(
      lines.map((l) => l.amount),
      taxChoices.find((c) => c.id === taxId) ?? null,
    );
    setTotals({ subtotal: t.subtotal, gstHstAmount: t.gstHst, pstQstAmount: t.pstQst, total: t.total });
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      ...Object.fromEntries(new FormData(e.currentTarget)),
      lines: lines.map(({ description, quantity, unitPrice, amount }) => ({ description, quantity, unitPrice, amount })),
    };
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
                <Input
                  inputMode="decimal"
                  value={l.amount}
                  placeholder="Qty × price"
                  onChange={(e) => setLine(i, "amount", e.target.value)}
                />
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
        <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="Tax" hint="Used by Calculate totals. Every box below stays editable, so you can match the invoice as printed.">
              <Select value={taxId} onChange={(e) => setTaxId(e.target.value)}>
                {taxChoices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <button type="button" className="btn btn--ghost sm:mb-[22px]" onClick={calculate}>
            Calculate totals
          </button>
        </div>
        <Field label="Subtotal">
          <Input name="subtotal" inputMode="decimal" value={totals.subtotal} onChange={(e) => setTotals((t) => ({ ...t, subtotal: e.target.value }))} />
        </Field>
        <Field label="GST / HST">
          <Input
            name="gstHstAmount"
            inputMode="decimal"
            value={totals.gstHstAmount}
            onChange={(e) => setTotals((t) => ({ ...t, gstHstAmount: e.target.value }))}
          />
        </Field>
        <Field label="PST / QST">
          <Input
            name="pstQstAmount"
            inputMode="decimal"
            value={totals.pstQstAmount}
            onChange={(e) => setTotals((t) => ({ ...t, pstQstAmount: e.target.value }))}
          />
        </Field>
        <Field label="Total">
          <Input name="total" inputMode="decimal" required value={totals.total} onChange={(e) => setTotals((t) => ({ ...t, total: e.target.value }))} />
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
