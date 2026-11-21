import type { ComponentProps } from "react";
import { Card } from "./card";

/**
 * A table in a card. The table scrolls sideways inside the card, so the page never does.
 * Give `minWidth` the width below which columns would crush.
 */
export function TableCard({
  minWidth = 940,
  label,
  className,
  children,
  ...rest
}: ComponentProps<"table"> & { minWidth?: number; label: string }) {
  return (
    <Card className="overflow-hidden">
      <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
        <table className={["tbl", className].filter(Boolean).join(" ")} style={{ minWidth }} {...rest}>
          {children}
        </table>
      </div>
    </Card>
  );
}

/** Vendor name over a muted line of identifiers. */
export function PrimaryCell({ title, detail }: { title: React.ReactNode; detail?: React.ReactNode }) {
  return (
    <div>
      <div className="font-bold">{title}</div>
      {detail && <div className="muted text-[13px]">{detail}</div>}
    </div>
  );
}

/** A person over their role. */
export function PersonCell({ name, role }: { name: React.ReactNode; role?: React.ReactNode }) {
  return (
    <div className="text-sm">
      {name}
      {role && <div className="muted text-xs">{role}</div>}
    </div>
  );
}
