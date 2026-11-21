"use client";

import type { CSSProperties } from "react";
import { formatValue, splitLabel } from "@/lib/params";
import type { SimParam } from "@/lib/types";

/** One card of sliders. The track fills blue up to the thumb. */
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
    <div className="card short-stack short-tight flex flex-col gap-5 p-5" data-testid="param-sliders">
      {params.map((p) => {
        const { name, unit } = splitLabel(p.label);
        const value = values[p.id] ?? p.value;
        const inputId = `param-${p.id}`;
        const fill = p.max > p.min ? ((value - p.min) / (p.max - p.min)) * 100 : 0;
        return (
          <div key={p.id} className="flex flex-col gap-1.5">
            <label htmlFor={inputId} className="flex items-baseline justify-between gap-3 font-bold leading-tight">
              <span>
                {name}
                {unit ? <span className="font-medium text-muted"> ({unit})</span> : null}
              </span>
              <span className="pix tabular-nums" data-testid={`value-${p.id}`}>
                {formatValue(value, p.step)}
              </span>
            </label>
            <input
              id={inputId}
              data-param={p.id}
              type="range"
              className="sim-slider"
              style={{ "--fill": `${fill}%` } as CSSProperties}
              min={p.min}
              max={p.max}
              step={p.step}
              value={value}
              disabled={disabled}
              aria-label={p.label}
              onChange={(e) => onChange(p.id, Number(e.target.value))}
            />
          </div>
        );
      })}
    </div>
  );
}
