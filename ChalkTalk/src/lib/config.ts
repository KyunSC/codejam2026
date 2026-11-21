import "server-only";

export const MODEL = "claude-sonnet-5-5";
export const EFFORT = "medium" as const;
export const MAX_TOKENS = 32000;

/** True when ANTHROPIC_API_KEY is set and not blank. Never exposes the value. */
export function hasKey(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

export function useStandIn(): boolean {
  return !hasKey() || process.env.FAKE_MODEL === "1";
}
