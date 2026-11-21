/**
 * Document inspection, before any model call: what the file is and whether it can be read.
 *
 * - SHA-256 of the bytes (intake dedupes on it).
 * - Type from the bytes, not the file name.
 * - PDFs: page count and text layer (BUILD_PLAN Extraction, "Text layer"). Password-protected
 *   and damaged files (truncated, not really a PDF) are named problems, not crashes.
 * - Images: size, and whether the image is blank (one flat colour), so a blank scan is not
 *   sent to the model.
 *
 * A file with a `problem` ends intake in a named state (item 3.13/3.14); it is never extracted.
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import { readPdf } from "./pdf";

export type DocumentKind = "pdf" | "image" | "unknown";

export type DocumentProblem =
  | "empty" // zero bytes
  | "unsupported_type" // not a PDF or an image the model reads
  | "encrypted" // PDF needs a password to open
  | "corrupt" // PDF or image that does not open (truncated, damaged)
  | "blank_image"; // an image with nothing on it

/** Images the extraction model accepts. */
const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

export interface Inspection {
  sha256: string;
  bytes: number;
  /** Sniffed from the bytes; null when unrecognised. */
  mime: string | null;
  kind: DocumentKind;
  pageCount: number | null;
  /** Text layer, pages separated by a form feed. Null for images and unreadable PDFs. */
  textLayer: string | null;
  /** At least MIN_TEXT_CHARS of non-space text. */
  hasTextLayer: boolean;
  image: { width: number; height: number } | null;
  problem: DocumentProblem | null;
  /** Human sentence for the review screen when there is a problem. */
  detail: string | null;
}

/** Below this, a "text layer" is a stray watermark or page number, not the invoice. */
export const MIN_TEXT_CHARS = 20;

/** Standard deviation (0–255) under which every channel counts as flat. */
const BLANK_STDEV = 2;

export function sniffMime(b: Uint8Array): string | null {
  const starts = (...sig: number[]) => sig.every((v, i) => b[i] === v);
  // A PDF header may follow up to 1024 bytes of junk (PDF 32000-1, 7.5.2 note).
  const head = Buffer.from(b.subarray(0, 1024)).toString("latin1");
  if (head.includes("%PDF-")) return "application/pdf";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && Buffer.from(b.subarray(8, 12)).toString("latin1") === "WEBP")
    return "image/webp";
  if (starts(0x49, 0x49, 0x2a, 0x00) || starts(0x4d, 0x4d, 0x00, 0x2a)) return "image/tiff";
  if (
    Buffer.from(b.subarray(4, 12))
      .toString("latin1")
      .match(/^ftyp(heic|heix|mif1)/)
  )
    return "image/heic";
  return null;
}

function base(bytes: Uint8Array): Inspection {
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    mime: null,
    kind: "unknown",
    pageCount: null,
    textLayer: null,
    hasTextLayer: false,
    image: null,
    problem: null,
    detail: null,
  };
}

export async function inspectDocument(bytes: Uint8Array): Promise<Inspection> {
  const out = base(bytes);
  if (bytes.length === 0) return { ...out, problem: "empty", detail: "The file is empty (zero bytes)." };

  out.mime = sniffMime(bytes);
  if (out.mime === "application/pdf") return inspectPdf(bytes, { ...out, kind: "pdf" });
  if (out.mime && (IMAGE_MIMES as readonly string[]).includes(out.mime)) {
    return inspectImage(bytes, { ...out, kind: "image", pageCount: 1 });
  }
  return {
    ...out,
    kind: out.mime?.startsWith("image/") ? "image" : "unknown",
    problem: "unsupported_type",
    detail: out.mime
      ? `The file is ${out.mime}, which cannot be read. Send a PDF, PNG or JPEG.`
      : "The file is not a PDF or an image.",
  };
}

async function inspectPdf(bytes: Uint8Array, out: Inspection): Promise<Inspection> {
  try {
    const pdf = await readPdf(bytes);
    const text = pdf.pages.join("\f");
    return {
      ...out,
      pageCount: pdf.pageCount,
      textLayer: text,
      hasTextLayer: text.replace(/\s/g, "").length >= MIN_TEXT_CHARS,
    };
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === "PasswordException") {
      return {
        ...out,
        problem: "encrypted",
        detail: "The PDF is password-protected. Ask the vendor for an open copy.",
      };
    }
    return {
      ...out,
      problem: "corrupt",
      detail: `The PDF does not open (${(e as Error).message ?? name}). It may be truncated or damaged.`,
    };
  }
}

async function inspectImage(bytes: Uint8Array, out: Inspection): Promise<Inspection> {
  try {
    const img = sharp(bytes, { failOn: "error" });
    const meta = await img.metadata();
    const stats = await img.stats();
    const image = { width: meta.width ?? 0, height: meta.height ?? 0 };
    const colour = stats.channels.slice(0, meta.hasAlpha ? -1 : undefined);
    if (colour.every((c) => c.stdev < BLANK_STDEV)) {
      return { ...out, image, problem: "blank_image", detail: "The image is blank: one flat colour, no writing." };
    }
    return { ...out, image };
  } catch (e) {
    return { ...out, problem: "corrupt", detail: `The image does not open (${(e as Error).message}).` };
  }
}
