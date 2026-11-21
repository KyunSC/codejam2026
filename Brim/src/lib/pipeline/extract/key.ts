/**
 * The Anthropic key, or null. Unset, empty and whitespace-only all count as missing, so a
 * blank `ANTHROPIC_API_KEY=` line in .env does not switch the real extractor on.
 */
export function anthropicKey(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.ANTHROPIC_API_KEY?.trim();
  return key ? key : null;
}

export const hasAnthropicKey = (env?: Record<string, string | undefined>) => anthropicKey(env) !== null;
