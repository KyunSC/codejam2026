"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { send } from "@/lib/client/api";

function useCall() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function call(fn: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "That didn't work." });
    } finally {
      setBusy(false);
    }
  }
  return { busy, msg, call };
}

function Note({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <span className={`mt-1 block max-w-[32ch] text-sm ${msg.ok ? "muted" : "form-error"}`}>{msg.text}</span>;
}

export function PrepareButton({ slug, invoiceId }: { slug: string; invoiceId: string }) {
  const { busy, msg, call } = useCall();
  return (
    <div>
      <Button size="sm" variant="solid" disabled={busy} onClick={() => call(async () => {
        const p = await send<{ id: string }>("POST", `/api/orgs/${slug}/payments`, { invoiceId });
        return `Scheduled as ${p.id}.`;
      })}>
        Prepare
      </Button>
      <Note msg={msg} />
    </div>
  );
}

export function ReleaseButton({ slug, paymentId }: { slug: string; paymentId: string }) {
  const { busy, msg, call } = useCall();
  return (
    <div>
      <Button size="sm" variant="solid" disabled={busy} onClick={() => call(async () => {
        await send("POST", `/api/orgs/${slug}/payments/${paymentId}/release`);
        return "Released.";
      })}>
        Release
      </Button>
      <Note msg={msg} />
    </div>
  );
}

export function BankRunButton({ slug }: { slug: string }) {
  const { busy, msg, call } = useCall();
  return (
    <div>
      <Button variant="solid" disabled={busy} onClick={() => call(async () => {
        const r = await send<{ settled: string[]; sent: string[]; cleared: string[]; failed: unknown[] }>("POST", `/api/orgs/${slug}/payments/simulate-bank`);
        return `Bank run: ${r.settled.length} settled, ${r.sent.length} cheques mailed, ${r.cleared.length} cleared, ${r.failed.length} failed.`;
      })}>
        Simulate bank run
      </Button>
      <Note msg={msg} />
    </div>
  );
}
