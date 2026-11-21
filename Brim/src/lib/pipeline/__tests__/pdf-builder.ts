/**
 * Builds small PDFs in memory for tests: one page of text per entry, optionally protected by
 * a user password (Standard security handler, revision 2, 40-bit RC4). No PDF library can
 * write these here, and a hand-made file keeps the broken-input tests free of binary fixtures.
 */
import { createHash } from "node:crypto";

const PAD = Buffer.from("28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A", "hex");

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[n] = data[n] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

const md5 = (...parts: Buffer[]) => createHash("md5").update(Buffer.concat(parts)).digest();
const padded = (pw: string) => Buffer.concat([Buffer.from(pw, "latin1"), PAD]).subarray(0, 32);

function escapePdfString(s: string): string {
  return s.replace(/[\\()]/g, (c) => `\\${c}`);
}

export function buildPdf(pageTexts: string[], opts: { userPassword?: string } = {}): Buffer {
  const pageCount = pageTexts.length;
  // Objects: 1 catalog, 2 pages, 3 font, then per page a page and a content stream.
  const pageObj = (i: number) => 4 + i * 2;
  const contentObj = (i: number) => 5 + i * 2;
  const encryptObj = 4 + pageCount * 2;

  const id = createHash("md5").update(pageTexts.join("|")).digest();
  let fileKey: Buffer | null = null;
  let encryptDict = "";
  if (opts.userPassword !== undefined) {
    const P = -44; // print and copy refused: an ordinary "protected" invoice
    const pBytes = Buffer.alloc(4);
    pBytes.writeInt32LE(P);
    const O = rc4(md5(padded("owner-secret")).subarray(0, 5), padded(opts.userPassword));
    fileKey = md5(padded(opts.userPassword), O, pBytes, id).subarray(0, 5);
    const U = rc4(fileKey, PAD);
    encryptDict = `<< /Filter /Standard /V 1 /R 2 /O <${O.toString("hex")}> /U <${U.toString("hex")}> /P ${P} >>`;
  }

  const objects: Array<[number, Buffer]> = [
    [1, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>")],
    [
      2,
      Buffer.from(
        `<< /Type /Pages /Kids [${pageTexts.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] /Count ${pageCount} >>`,
      ),
    ],
    [3, Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")],
  ];
  pageTexts.forEach((text, i) => {
    objects.push([
      pageObj(i),
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj(i)} 0 R >>`,
      ),
    ]);
    const lines = text.split("\n").map((l, n) => `BT /F1 11 Tf 72 ${740 - n * 14} Td (${escapePdfString(l)}) Tj ET`);
    let stream: Buffer = Buffer.from(lines.join("\n"), "latin1");
    if (fileKey) {
      const num = Buffer.from([contentObj(i) & 255, (contentObj(i) >> 8) & 255, (contentObj(i) >> 16) & 255, 0, 0]);
      stream = rc4(md5(fileKey, num).subarray(0, 10), stream);
    }
    objects.push([
      contentObj(i),
      Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from("\nendstream")]),
    ]);
  });
  if (encryptDict) objects.push([encryptObj, Buffer.from(encryptDict)]);

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  let offset = chunks[0].length;
  const offsets = new Map<number, number>();
  for (const [num, body] of objects) {
    offsets.set(num, offset);
    const chunk = Buffer.concat([Buffer.from(`${num} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    chunks.push(chunk);
    offset += chunk.length;
  }
  const size = Math.max(...offsets.keys()) + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let n = 1; n < size; n++)
    xref += `${String(offsets.get(n) ?? 0).padStart(10, "0")} 00000 ${offsets.has(n) ? "n" : "f"} \n`;
  const trailer =
    `trailer\n<< /Size ${size} /Root 1 0 R /ID [<${id.toString("hex")}> <${id.toString("hex")}>]` +
    (encryptDict ? ` /Encrypt ${encryptObj} 0 R` : "") +
    ` >>\nstartxref\n${offset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref + trailer));
  return Buffer.concat(chunks);
}
