import type { ComponentProps, ReactNode } from "react";
import { FLAG_KIND_LABEL, type FlagKind } from "./flag-kind";

/** A flag chip. Text defaults to the kind's label; pass children for a longer one. */
export function Chip({
  kind = "check",
  className,
  children,
  ...rest
}: ComponentProps<"span"> & { kind?: FlagKind; children?: ReactNode }) {
  return (
    <span className={["chip", `chip--${kind}`, className].filter(Boolean).join(" ")} {...rest}>
      {children ?? FLAG_KIND_LABEL[kind]}
    </span>
  );
}

export interface FilterOption {
  value: string;
  label: string;
  count: number;
  kind?: FlagKind;
}

/** Filter chips with counts. Controlled: the page owns the selected value. */
export function FilterChips({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: FilterOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={["chip", o.kind ? `chip--${o.kind}` : undefined].filter(Boolean).join(" ")}
        >
          {o.label} <span className="num">{o.count}</span>
        </button>
      ))}
    </div>
  );
}
