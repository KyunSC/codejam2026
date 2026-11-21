import type { ReactNode } from "react";
import { Card } from "./card";

/** What a section shows when it has nothing yet: what will appear, and how to get it there. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Card className="flex flex-col items-start gap-3 p-6 sm:p-8">
      <p className="label m-0 text-lg">{title}</p>
      {children && <div className="muted max-w-[60ch] text-[15px]">{children}</div>}
      {action}
    </Card>
  );
}
