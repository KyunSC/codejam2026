/**
 * Picks the extractor. Answers already in the cache (real ones only) are always used first;
 * then the real model when a key is set, else the recorded stand-in.
 */
import { anthropicCreate, ClaudeExtractor } from "./claude";
import { anthropicKey } from "./key";
import { FileExtractionCache, type ExtractionCache } from "./cache";
import { RecordedExtractor } from "./recorded";
import type { ExtractInput, ExtractResult, Extractor } from "./types";

export type { ExtractInput, ExtractResult, Extractor, ExtractionSource } from "./types";
export { anthropicKey, hasAnthropicKey } from "./key";

/**
 * Wraps an extractor with the per-hash cache. A hit is returned as source `cache`. A real
 * answer is stored; a recorded (hand-made) one never is.
 */
export class CachedExtractor implements Extractor {
  readonly kind: Extractor["kind"];
  constructor(
    private readonly inner: Extractor,
    private readonly cache: ExtractionCache,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.kind = inner.kind;
  }

  async extract(input: ExtractInput): Promise<ExtractResult> {
    const hit = this.cache.get(input.sha256);
    if (hit) {
      return { ok: true, extracted: hit.extracted, secondRead: hit.secondRead, source: "cache", model: hit.model };
    }
    const r = await this.inner.extract(input);
    if (r.ok && this.inner.kind === "claude" && r.source === "claude") {
      try {
        this.cache.put({
          source: "claude",
          sha256: input.sha256,
          model: r.model,
          extractedAt: this.now().toISOString(),
          extracted: r.extracted,
          secondRead: r.secondRead,
        });
      } catch (error) {
        console.warn("Could not cache the completed extraction", error);
      }
    }
    return r;
  }
}

export interface ExtractorOptions {
  env?: Record<string, string | undefined>;
  cache?: ExtractionCache;
  /** Builds the real extractor from the key; defaults to Claude with the configured model. */
  claude?: (apiKey: string) => Extractor;
  recorded?: Extractor;
}

export function createExtractor(opts: ExtractorOptions = {}): Extractor {
  const cache = opts.cache ?? new FileExtractionCache();
  const key = anthropicKey(opts.env);
  if (key) {
    const claude = opts.claude ?? ((k: string) => new ClaudeExtractor(anthropicCreate(k)));
    return new CachedExtractor(claude(key), cache);
  }
  return new CachedExtractor(opts.recorded ?? new RecordedExtractor(), cache);
}
