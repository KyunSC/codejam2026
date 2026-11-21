import { readUserSession } from "@/lib/auth/session";

/** Shown on every page to the auditor: everything is read-only, and the server enforces it. */
export async function AuditorBanner() {
  const session = await readUserSession();
  if (session?.user.role !== "auditor") return null;
  return (
    <div role="note" className="border-b-2 border-border bg-[var(--gold)] px-4 py-2 text-center text-sm font-semibold text-[var(--ink)]">
      Auditor: read-only. You can see and export everything; the server refuses every change.
    </div>
  );
}
