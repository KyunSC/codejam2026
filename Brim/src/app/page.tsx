import { connection } from "next/server";
import { Suspense } from "react";
import { today } from "@/lib/today";

/** Read at request time, so the date is never frozen into the prerendered page. */
async function AppDate() {
  await connection();
  return <>{today()}</>;
}

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 px-4 py-16">
      <p className="text-sm uppercase tracking-wide text-zinc-500">Harborline Logistics</p>
      <h1 className="text-3xl font-semibold">Brim AP</h1>
      <p className="text-zinc-600">
        Supplier invoices from inbox to payment. The app is being built; see BUILD_PLAN.md.
      </p>
      <p className="text-sm text-zinc-500">
        App date:{" "}
        <Suspense fallback="…">
          <AppDate />
        </Suspense>
      </p>
    </main>
  );
}
