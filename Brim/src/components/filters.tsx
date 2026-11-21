import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A filter bar: a plain GET form, so filters live in the URL, survive a reload and can be shared.
 */
export function FilterBar({ action, resetHref, children }: { action: string; resetHref: string; children: ReactNode }) {
  return (
    <form action={action} method="get" className="flex flex-wrap items-end gap-4" role="search">
      {children}
      <div className="flex gap-2">
        <button type="submit" className="btn btn--solid btn--sm">
          Apply
        </button>
        <Link href={resetHref} className="btn btn--ghost btn--sm">
          Clear
        </Link>
      </div>
    </form>
  );
}

export function FilterText({
  name,
  label,
  defaultValue,
  placeholder,
  type = "search",
}: {
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  type?: "search" | "date";
}) {
  return (
    <label className="field min-w-[220px] flex-1">
      <span>{label}</span>
      <input className="input" type={type} name={name} defaultValue={defaultValue} placeholder={placeholder} />
    </label>
  );
}

/** A select. `allLabel` is the "no filter" option; null leaves it out. */
export function FilterSelect({
  name,
  label,
  defaultValue,
  options,
  allLabel = "All",
}: {
  name: string;
  label: string;
  defaultValue?: string;
  options: { value: string; label: string }[];
  allLabel?: string | null;
}) {
  return (
    <label className="field min-w-[170px]">
      <span>{label}</span>
      <select className="input" name={name} defaultValue={defaultValue ?? ""}>
        {allLabel !== null && <option value="">{allLabel}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
