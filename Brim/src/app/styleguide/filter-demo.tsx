"use client";

import { useState } from "react";
import { FilterChips, type FilterOption } from "@/components/ui";

export function FilterDemo({ options }: { options: FilterOption[] }) {
  const [value, setValue] = useState(options[0]?.value ?? "");
  return <FilterChips label="Filter by flag" options={options} value={value} onChange={setValue} />;
}
