// Small pure helpers for slider params. Client-safe.
import type { SimParam } from "./types";

export function splitLabel(label: string): { name: string; unit: string } {
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(label);
  return m ? { name: m[1], unit: m[2] } : { name: label, unit: "" };
}

export function decimalsOf(step: number): number {
  const s = String(step);
  if (s.includes("e-")) return Number(s.split("e-")[1]);
  return (s.split(".")[1] ?? "").length;
}

export function formatValue(value: number, step: number): string {
  return value.toFixed(Math.min(decimalsOf(step), 4));
}

export function clampToParam(p: SimParam, v: number): number {
  if (!Number.isFinite(v)) return p.value;
  return Math.min(p.max, Math.max(p.min, v));
}

/**
 * Values to start a freshly mounted sim with.
 * - `initial` (e.g. homework defaults) wins where valid.
 * - `carry`: values the teacher had moved away from the previous defaults, kept when the id still exists.
 */
export function startingValues(
  params: SimParam[],
  opts: { initial?: Record<string, number>; carry?: { values: Record<string, number>; defaults: Record<string, number> } } = {},
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of params) {
    let v = p.value;
    const init = opts.initial?.[p.id];
    if (typeof init === "number" && Number.isFinite(init)) v = clampToParam(p, init);
    const c = opts.carry;
    if (c && p.id in c.values && c.values[p.id] !== c.defaults[p.id]) v = clampToParam(p, c.values[p.id]);
    out[p.id] = v;
  }
  return out;
}
