import type { ReactNode } from "react";

export interface Stat {
  label: string;
  value: ReactNode;
  /** Draws the value in the flag colour. */
  alert?: boolean;
}

/** The 4-up row of headline numbers between two heavy rules. */
export function StatRow({ stats, label }: { stats: Stat[]; label: string }) {
  return (
    <section
      aria-label={label}
      className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] border-y-2 border-border"
    >
      {stats.map((s, i) => (
        <div
          key={s.label}
          className={`py-[18px] pr-5 ${i > 0 ? "sm:pl-5" : ""} border-rule not-last:border-b sm:not-last:border-b-0 sm:not-last:border-r`}
        >
          <div className="muted text-[13px]">{s.label}</div>
          <div className="label num text-[28px] tracking-normal sm:text-[34px]" style={s.alert ? { color: "var(--flag)" } : undefined}>
            {s.value}
          </div>
        </div>
      ))}
    </section>
  );
}
