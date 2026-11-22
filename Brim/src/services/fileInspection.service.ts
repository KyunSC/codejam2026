import { readStoredFile, StoredFile } from "./rawIntake.service";

export type Inspection = { readable: true; kind: "pdf" | "png" | "jpeg"; bytes: Buffer } | { readable: false; reason: string };

// Opens the file and checks it is a PDF or image the extractor can read.
export function inspectFile(f: StoredFile): Inspection {
  let bytes: Buffer;
  try {
    bytes = readStoredFile(f);
  } catch {
    return { readable: false, reason: "File could not be opened" };
  }
  if (bytes.length === 0) return { readable: false, reason: "File is empty" };
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return { readable: true, kind: "pdf", bytes };
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { readable: true, kind: "png", bytes };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { readable: true, kind: "jpeg", bytes };
  return { readable: false, reason: `Not a PDF or image (${f.file_name})` };
}
