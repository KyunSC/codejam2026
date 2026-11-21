"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { FormError, Input, Select, TextArea } from "@/components/forms/form-bits";
import { send } from "@/lib/client/api";

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

/** Approve a vendor pending review, hold an active one, or release a hold (finance manager, controller). */
export function VendorStatusActions({ slug, vendorId, status }: { slug: string; vendorId: string; status: string }) {
  const { error, busy, run } = useAction();
  const [reason, setReason] = useState("");
  const post = (kind: string) => run(() => send("POST", `/api/orgs/${slug}/vendors/${vendorId}/${kind}`, { reason }));
  return (
    <Card className="flex max-w-[640px] flex-col gap-3 p-5">
      <TextArea aria-label="Reason" rows={2} placeholder={status === "pending_review" ? "Note (optional)" : "Reason (required)"} value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex flex-wrap gap-2.5">
        {status === "pending_review" && <Button variant="solid" size="sm" disabled={busy} onClick={() => post("approve")}>Approve vendor</Button>}
        {status !== "on_hold" && <Button size="sm" disabled={busy || !reason.trim()} onClick={() => post("hold")}>Put on hold</Button>}
        {status === "on_hold" && <Button variant="solid" size="sm" disabled={busy || !reason.trim()} onClick={() => post("release-hold")}>Release hold</Button>}
      </div>
      <p className="muted m-0 text-sm">A second person decides: you cannot approve a vendor you created or release a hold you placed.</p>
      <FormError message={error} />
    </Card>
  );
}

/** Verify (after calling back on the number on file) or reject a pending bank change. */
export function BankChangeDecision({ slug, changeId }: { slug: string; changeId: string }) {
  const { error, busy, run } = useAction();
  const [calledBack, setCalledBack] = useState(false);
  const [note, setNote] = useState("");
  const post = (kind: "verify" | "reject") => run(() => send("POST", `/api/orgs/${slug}/bank-changes/${changeId}/${kind}`, { calledBack, note }));
  return (
    <div className="flex flex-col gap-2.5">
      <label className="flex items-center gap-2.5 text-[15px]">
        <input type="checkbox" checked={calledBack} onChange={(e) => setCalledBack(e.target.checked)} />
        I called the vendor back on the number already on file, not one in the request
      </label>
      <TextArea aria-label="Note" rows={2} placeholder="Who confirmed it, or why it is rejected" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex flex-wrap gap-2.5">
        <Button variant="solid" size="sm" disabled={busy || !calledBack || !note.trim()} onClick={() => post("verify")}>Verify</Button>
        <Button size="sm" disabled={busy || !note.trim()} onClick={() => post("reject")}>Reject</Button>
      </div>
      <FormError message={error} />
    </div>
  );
}

/** Record a bank change request (AP clerk). The live account changes only once someone else verifies it. */
export function BankChangeForm({ slug, vendorId }: { slug: string; vendorId: string }) {
  const { error, busy, run } = useAction();
  const [f, setF] = useState({ institution: "", transit: "", account: "", channel: "email_request" });
  return (
    <Card className="flex flex-col gap-3 p-5">
      <p className="label m-0">Request a bank change</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input aria-label="Institution" placeholder="Institution (3)" value={f.institution} onChange={(e) => setF({ ...f, institution: e.target.value })} />
        <Input aria-label="Transit" placeholder="Transit (5)" value={f.transit} onChange={(e) => setF({ ...f, transit: e.target.value })} />
        <Input aria-label="Account" placeholder="Account" value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })} />
      </div>
      <Select aria-label="How it came in" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
        <option value="email_request">By email</option>
        <option value="vendor_portal">Vendor portal</option>
        <option value="phone_callback_verified">Phone</option>
      </Select>
      <div>
        <Button size="sm" variant="solid" disabled={busy || !f.account} onClick={() => run(() => send("POST", `/api/orgs/${slug}/vendors/${vendorId}/bank-changes`, f))}>Record request</Button>
      </div>
      <FormError message={error} />
    </Card>
  );
}

/** Onboard a vendor (AP clerk): it starts pending review and cannot be paid until someone else approves it. */
export function OnboardForm({ slug }: { slug: string }) {
  const router = useRouter();
  const { error, busy, run } = useAction();
  const [f, setF] = useState({ legalName: "", category: "", defaultGlAccount: "", apContactEmail: "", gstHstNumber: "", address: "", preferredPaymentMethod: "EFT", institution: "", transit: "", account: "" });
  const field = (k: keyof typeof f, label: string) => (
    <label className="field">
      <span>{label}</span>
      <Input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );
  return (
    <Card className="flex flex-col gap-3 p-6">
      <div className="grid gap-3 sm:grid-cols-2">
        {field("legalName", "Legal name")}
        {field("category", "Category")}
        {field("defaultGlAccount", "Default GL account")}
        {field("apContactEmail", "AP contact email")}
        {field("gstHstNumber", "GST/HST number")}
        {field("address", "Address")}
        <label className="field">
          <span>Pays by</span>
          <Select value={f.preferredPaymentMethod} onChange={(e) => setF({ ...f, preferredPaymentMethod: e.target.value })}>
            <option>EFT</option>
            <option>CHEQUE</option>
            <option>CARD</option>
          </Select>
        </label>
        {field("account", "Bank account (optional)")}
      </div>
      <div>
        <Button variant="solid" disabled={busy} onClick={() => run(async () => {
          const v = await send<{ id: string }>("POST", `/api/orgs/${slug}/vendors`, f);
          router.push(`/vendors/${v.id}`);
        })}>Create as pending review</Button>
      </div>
      <FormError message={error} />
    </Card>
  );
}
