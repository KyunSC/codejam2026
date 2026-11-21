"use client";

import { formatValue, splitLabel } from "@/lib/params";
import type { SimParam } from "@/lib/types";

export function ParamSliders({
  params,
  values,
  onChange,
  disabled,
}: {
  params: SimParam[];
  values: Record<string, number>;
  onChange: (id: string, value: number) => void;
  disabled?: boolean;
}) {
  if (!params.length) return null;
  return (
    <div className="flex flex-col gap-6" data-testid="param-sliders">
      {params.map((p) => {
        const { name, unit } = splitLabel(p.label);
        const value = values[p.id] ?? p.value;
        const inputId = `param-${p.id}`;
        return (
          <div key={p.id} className="flex flex-col gap-2">
            <label htmlFor={inputId} className="flex items-baseline justify-between gap-3 text-xl font-medium">
              <span>{name}</span>
              <span className="tabular-nums font-semibold text-[#1d4ed8]" data-testid={`value-${p.id}`}>
                {formatValue(value, p.step)}
                {unit ? <span className="ml-1 text-lg font-normal text-slate-600">{unit}</span> : null}
              </span>
            </label>
            <input
              id={inputId}
              data-param={p.id}
              type="range"
              className="sim-slider"
              min={p.min}
              max={p.max}
              step={p.step}
              value={value}
              disabled={disabled}
              aria-label={p.label}
              onChange={(e) => onChange(p.id, Number(e.target.value))}
            />
            <div className="flex justify-between text-base text-slate-600 tabular-nums" aria-hidden>
              <span>{formatValue(p.min, p.step)}</span>
              <span>{formatValue(p.max, p.step)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
