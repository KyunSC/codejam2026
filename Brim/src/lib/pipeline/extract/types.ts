import type { Extracted } from "../../types";

/** One file to read. */
export interface ExtractInput {
  sha256: string;
  bytes: Uint8Array;
  /** Sniffed: application/pdf or an image type the model accepts. */
  mime: string;
  fileName?: string;
  /** PDFs with a text layer never get a second read. */
  hasTextLayer: boolean;
}

/** Where an answer came from. `recorded` answers are hand-made and never cached. */
export type ExtractionSource = "claude" | "cache" | "recorded";

export type ExtractResult =
  | {
      ok: true;
      extracted: Extracted;
      /** Only for a scan whose first read's arithmetic did not close. */
      secondRead: Extracted | null;
      source: ExtractionSource;
      /** Model id for real answers; "hand-made" for recorded ones. */
      model: string;
    }
  | {
      ok: false;
      /** `no_answer`: the stand-in has nothing recorded for this file (needs a key). */
      reason: "no_answer" | "api_error" | "bad_answer";
      detail: string;
    };

export interface Extractor {
  /** `claude` answers may be cached; `recorded` answers never are. */
  readonly kind: "claude" | "recorded";
  extract(input: ExtractInput): Promise<ExtractResult>;
}
