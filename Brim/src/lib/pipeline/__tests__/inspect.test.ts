import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { datasetDir } from "../../dataset";
import { inspectDocument, sniffMime } from "../inspect";
import { sealedFileNames } from "../sealed";
import { buildPdf } from "./pdf-builder";

const INVOICE_TEXT =
  "Acme Test Supplies Inc.\nInvoice 1001\nDate 2026-10-28\nSubtotal 100.00\nHST 13% 13.00\nTotal CAD 113.00";

describe("inspectDocument on made-up files", () => {
  it("reads a one-page PDF's text layer", async () => {
    const pdf = buildPdf([INVOICE_TEXT]);
    const r = await inspectDocument(pdf);
    expect(r).toMatchObject({ mime: "application/pdf", kind: "pdf", pageCount: 1, hasTextLayer: true, problem: null });
    expect(r.textLayer).toContain("Total CAD 113.00");
    expect(r.sha256).toBe(createHash("sha256").update(pdf).digest("hex"));
  });

  it("counts two pages and separates their text", async () => {
    const r = await inspectDocument(buildPdf([INVOICE_TEXT, "Page 2 of 2\nRemit to: account 1234567"]));
    expect(r.pageCount).toBe(2);
    expect(r.textLayer!.split("\f")).toHaveLength(2);
    expect(r.problem).toBeNull();
  });

  it("finds no text layer on a PDF with only a page number", async () => {
    const r = await inspectDocument(buildPdf(["1"]));
    expect(r).toMatchObject({ hasTextLayer: false, problem: null, pageCount: 1 });
  });

  it("names a zero-byte file", async () => {
    expect(await inspectDocument(new Uint8Array())).toMatchObject({ problem: "empty", bytes: 0 });
  });

  it("names a truncated PDF as corrupt", async () => {
    const pdf = buildPdf([INVOICE_TEXT]);
    expect(await inspectDocument(pdf.subarray(0, pdf.length >> 1))).toMatchObject({ kind: "pdf", problem: "corrupt" });
  });

  it("names a password-protected PDF", async () => {
    const r = await inspectDocument(buildPdf([INVOICE_TEXT], { userPassword: "s3cret" }));
    expect(r).toMatchObject({ kind: "pdf", problem: "encrypted" });
    expect(r.detail).toMatch(/password/);
  });

  it("names a blank image", async () => {
    const png = await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#ffffff" } })
      .png()
      .toBuffer();
    expect(await inspectDocument(png)).toMatchObject({ mime: "image/png", kind: "image", problem: "blank_image" });
  });

  it("accepts an image with something on it", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#fff"/><text x="20" y="100" font-size="40">INVOICE 1001</text></svg>`;
    const jpg = await sharp(Buffer.from(svg)).jpeg().toBuffer();
    expect(await inspectDocument(jpg)).toMatchObject({
      mime: "image/jpeg",
      problem: null,
      image: { width: 400, height: 200 },
    });
  });

  it("names a truncated image as corrupt", async () => {
    const png = await sharp({ create: { width: 50, height: 50, channels: 3, background: "#808080" } })
      .png()
      .toBuffer();
    expect(await inspectDocument(png.subarray(0, 40))).toMatchObject({ kind: "image", problem: "corrupt" });
  });

  it("refuses types the model cannot read, judging by bytes not name", async () => {
    expect(await inspectDocument(Buffer.from("Invoice total 113.00, plain text"))).toMatchObject({
      mime: null,
      problem: "unsupported_type",
    });
    expect(sniffMime(Buffer.from([0x49, 0x49, 0x2a, 0x00, 1, 2]))).toBe("image/tiff");
  });
});

describe("inspectDocument on the 41 unsealed files", () => {
  const sealed = sealedFileNames();
  const dir = path.join(datasetDir(), "incoming_invoices");
  const files = readdirSync(dir).filter((f) => !sealed.has(f));

  it("opens every one: 40 one-page PDFs with a text layer and 1 PNG scan", async () => {
    expect(files).toHaveLength(41);
    const results = await Promise.all(
      files.map(async (f) => ({ f, r: await inspectDocument(readFileSync(path.join(dir, f))) })),
    );
    expect(results.filter(({ r }) => r.problem !== null).map(({ f, r }) => `${f}: ${r.problem}`)).toEqual([]);
    const pdfs = results.filter(({ r }) => r.kind === "pdf");
    expect(pdfs).toHaveLength(40);
    expect(pdfs.every(({ r }) => r.pageCount === 1 && r.hasTextLayer)).toBe(true);
    const lengths = pdfs.map(({ r }) => r.textLayer!.length);
    expect(Math.min(...lengths)).toBeGreaterThan(300);
    expect(results.filter(({ r }) => r.kind === "image").map(({ f }) => f)).toEqual(["scan_8049.png"]);
  }, 60_000);
});
