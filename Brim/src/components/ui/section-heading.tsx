import type { ReactNode } from "react";

/** Big uppercase section title with optional right-hand content (filters, a note). */
export function SectionHeading({
  id,
  children,
  aside,
  level = 2,
}: {
  id?: string;
  children: ReactNode;
  aside?: ReactNode;
  level?: 2 | 3;
}) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <H id={id} className={`heading m-0 leading-none ${level === 2 ? "text-[32px] sm:text-[40px]" : "text-2xl"}`}>
        {children}
      </H>
      {aside}
    </div>
  );
}
