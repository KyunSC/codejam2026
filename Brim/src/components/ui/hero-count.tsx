import Link from "next/link";

/**
 * The hero's answer: a huge count of flagged invoices, "of N unpaid invoices", and a red-dot
 * link to the fraud ones. Every number comes from the caller.
 */
export function HeroCount({
  flagged,
  unpaid,
  fraud,
  fraudHref,
}: {
  flagged: number;
  unpaid: number;
  fraud: number;
  fraudHref: string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
      <span
        className="heading num text-[96px] leading-[.8] sm:text-[clamp(96px,12vw,168px)]"
        style={{ color: "var(--red)", textShadow: "6px 6px 0 var(--shadow)" }}
      >
        {flagged}
      </span>
      <div className="flex flex-col gap-2.5 pb-1">
        <span className="text-[28px] leading-none font-bold">flagged</span>
        <span className="muted leading-none">
          of {unpaid} unpaid invoice{unpaid === 1 ? "" : "s"}
        </span>
        {fraud > 0 && (
          <Link
            href={fraudHref}
            className="inline-flex items-center gap-2 leading-none font-semibold no-underline"
            style={{ color: "var(--flag)" }}
          >
            <span aria-hidden="true" className="size-2 rounded-full" style={{ background: "var(--red)" }} />
            {fraud} look{fraud === 1 ? "s" : ""} like fraud
          </Link>
        )}
      </div>
    </div>
  );
}
