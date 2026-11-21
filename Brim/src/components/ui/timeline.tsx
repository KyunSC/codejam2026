import type { ReactNode } from "react";

export interface TimelineEvent {
  /** Shown as given: a date or a date and time from the audit row. */
  at: string;
  text: ReactNode;
}

/** The invoice's history, oldest first. */
export function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
      {events.map((e, i) => (
        <li key={i} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3.5">
          <span className="muted num flex-none sm:w-[130px]">{e.at}</span>
          <span>{e.text}</span>
        </li>
      ))}
    </ol>
  );
}
