"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { send } from "@/lib/client/api";

type Result =
  | { ok: true; count: number; lastHash: string }
  | { ok: false; count: number; firstBad: { seq: string; action: string; entityType: string; entityId: string }; reason: string };

/** Recomputes the hash chain on the server and reports the first row that does not match. */
export function VerifyChain({ slug }: { slug: string }) {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1.5">
      <Button size="sm" disabled={busy} onClick={async () => {
        setBusy(true);
        setError(null);
        try {
          setR(await send<Result>("GET", `/api/orgs/${slug}/audit/verify`));
        } catch (e) {
          setError(e instanceof Error ? e.message : "That didn't work.");
        } finally {
          setBusy(false);
        }
      }}>
        Verify the chain
      </Button>
      {r?.ok && <span className="text-sm">All {r.count.toLocaleString()} entries verify. Last hash {r.lastHash.slice(0, 12)}…</span>}
      {r && !r.ok && (
        <span className="form-error text-sm">
          Entry {r.firstBad.seq} ({r.firstBad.action} on {r.firstBad.entityType} {r.firstBad.entityId}) does not match. {r.reason}
        </span>
      )}
      {error && <span className="form-error text-sm">{error}</span>}
    </div>
  );
}
