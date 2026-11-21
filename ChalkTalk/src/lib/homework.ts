import { clampToParam, decimalsOf } from "./params";
import type { Homework, SimParam } from "./types";

const MAX_QUESTION = 600;

/**
 * Check a model's homework against the sim's params. Defaults must cover only known ids;
 * each is clamped into range and snapped to the step grid, and missing ones fall back to
 * the class default. A blank question is rejected.
 */
export function validateHomework(
  raw: unknown,
  params: SimParam[],
): { ok: true; homework: Homework } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "homework is not an object" };
  const { question, defaults } = raw as { question?: unknown; defaults?: unknown };
  if (typeof question !== "string" || !question.trim()) return { ok: false, reason: "homework question is missing" };
  const given = defaults && typeof defaults === "object" ? (defaults as Record<string, unknown>) : {};
  const out: Record<string, number> = {};
  for (const p of params) {
    const v = given[p.id];
    out[p.id] = typeof v === "number" && Number.isFinite(v) ? snapToParam(p, v) : p.value;
  }
  return { ok: true, homework: { question: question.trim().slice(0, MAX_QUESTION), defaults: out } };
}

/** Clamp into range and snap to the slider's step grid (counted from min). */
export function snapToParam(p: SimParam, v: number): number {
  const stepped = p.min + Math.round((clampToParam(p, v) - p.min) / p.step) * p.step;
  return clampToParam(p, Number(stepped.toFixed(Math.min(decimalsOf(p.step) + 2, 10))));
}
