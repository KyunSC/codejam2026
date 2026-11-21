import type { ReactNode } from "react";
import { Card } from "./card";

/** The row of facts at the top of the invoice screen: state, next person, requester, due. */
export function StateCard({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <Card className="flex flex-wrap items-center gap-x-8 gap-y-4 px-5 py-5 sm:px-[22px]">
      {items.map((it) => (
        <div key={it.label}>
          <div className="muted text-[13px]">{it.label}</div>
          {it.value}
        </div>
      ))}
    </Card>
  );
}
