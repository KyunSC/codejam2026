import { connection } from "next/server";
import { Suspense } from "react";
import { Button, ButtonLink, EmptyState, SectionHeading } from "@/components/ui";
import { today } from "@/lib/today";

/** Read at request time, so the date is never frozen into the prerendered page. */
async function AppDate() {
  await connection();
  return <>{today()}</>;
}

/**
 * Review queue landing. The checks engine isn't wired in yet, so the hero asks its question
 * and says plainly that there's no answer to show, instead of a made-up count. When the queue
 * exists, the answer side becomes <HeroCount> and the section below a <TableCard>.
 */
export default function Home() {
  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 sm:px-5">
      <section className="grid items-end gap-8 pt-10 pb-10 sm:pt-14 md:grid-cols-[repeat(auto-fit,minmax(420px,1fr))]">
        <div>
          <p className="label muted m-0 mb-4 text-sm">
            App date{" "}
            <Suspense fallback="…">
              <AppDate />
            </Suspense>
          </p>
          <h1 className="heading m-0 text-[40px] leading-[.95] sm:text-[clamp(44px,6.4vw,88px)]">
            Is the AP queue clear right now?
          </h1>
        </div>
        <div className="flex flex-col items-start gap-5">
          <p className="heading m-0 text-[40px] leading-none sm:text-[56px]" style={{ color: "var(--flag)" }}>
            Not checked yet
          </p>
          <p className="m-0 max-w-[460px] text-[17px] sm:text-[19px]">
            No invoices have gone through the checks. Once they have, this shows how many stopped, and
            each flag says what&rsquo;s wrong with both numbers and where they came from.
          </p>
          <div className="flex flex-wrap gap-3.5">
            <ButtonLink href="/styleguide" variant="solid" arrow>
              See the visual system
            </ButtonLink>
            <Button disabled title="The intake page isn't built yet">
              Ingest inbox
            </Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="queue" className="border-t-2 border-border pt-12 pb-16">
        <SectionHeading id="queue">Unpaid</SectionHeading>
        <EmptyState title="The queue is empty">
          Invoices land here after intake, extraction and the checks. Flagged ones come first, each with
          the reason it stopped and the next person who acts on it.
        </EmptyState>
      </section>
    </main>
  );
}
