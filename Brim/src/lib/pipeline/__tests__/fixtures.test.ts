/**
 * The hand-made answers in fixtures/extracted/, run through inspection, the recorded
 * stand-in, normalisation and evidence against the real unsealed files.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { datasetDir } from "../../dataset";
import { MemoryExtractionCache } from "../extract/cache";
import { createExtractor } from "../extract/index";
import { loadRecordedAnswers, RecordedExtractor } from "../extract/recorded";
import { inspectDocument, type Inspection } from "../inspect";
import { normalizeDetailed, type NormalizeResult } from "../normalize";
import { sealedFileNames } from "../sealed";

const answers = loadRecordedAnswers();
const cache = new MemoryExtractionCache();

const results = new Map<string, { inspection: Inspection; result: NormalizeResult }>();

beforeAll(async () => {
  const sealed = sealedFileNames();
  const extractor = createExtractor({
    env: {},
    cache,
    recorded: new RecordedExtractor(answers),
  });
  for (const a of answers.values()) {
    if (sealed.has(a.file)) throw new Error(`fixture for a sealed file: ${a.file}`);
    const bytes = readFileSync(path.join(datasetDir(), "incoming_invoices", a.file));
    const inspection = await inspectDocument(bytes);
    const r = await extractor.extract({
      sha256: inspection.sha256,
      bytes,
      mime: inspection.mime!,
      fileName: a.file,
      hasTextLayer: inspection.hasTextLayer,
    });
    if (!r.ok) throw new Error(`${a.file}: ${r.detail}`);
    expect(r.source).toBe("recorded");
    const result = normalizeDetailed(r.extracted, {
      fileSha256: inspection.sha256,
      textLayer: inspection.textLayer,
      hasTextLayer: inspection.hasTextLayer,
      receivedDate: "2026-11-01",
      secondRead: r.secondRead,
    });
    results.set(a.file, { inspection, result });
  }
}, 60_000);

const get = (file: string) => {
  const r = results.get(file);
  if (!r) throw new Error(`no fixture for ${file}`);
  return r;
};

describe("hand-made fixtures", () => {
  it("are all marked hand-made, match their file's hash, and avoid sealed files", () => {
    // One per unsealed inbox file.
    expect(answers.size).toBe(41);
    for (const a of answers.values()) {
      expect(a.handMade).toBe(true);
      expect(results.get(a.file)!.inspection.sha256).toBe(a.sha256);
    }
    expect(new Set([...answers.values()].map((a) => a.file)).size).toBe(41);
  });

  it("agree with the text layer wherever there is one", () => {
    for (const [file, { inspection, result }] of results) {
      if (!inspection.hasTextLayer) continue;
      const off = Object.entries(result.invoice.evidence).filter(([, e]) => e === "not_in_text");
      expect({ file, off }).toEqual({ file, off: [] });
      expect({ file, issues: result.invoice.parseIssues }).toEqual({ file, issues: [] });
    }
  });

  it("are never written to the extraction cache", () => {
    expect(cache.entries.size).toBe(0);
  });

  it("English: HST, discount terms, nothing to review", () => {
    const { result } = get("papertrailoffice_2217.pdf");
    const n = result.invoice;
    expect(result.needsReview).toBe(false);
    expect(n).toMatchObject({
      language: "en",
      invoiceNumber: "2217",
      digitsKey: "2217",
      invoiceDate: "2026-10-26",
      currency: "CAD",
    });
    expect(n.terms).toMatchObject({ netDays: 30, discountDays: 10 });
    expect(n.terms!.discountPct!.toString()).toBe("2");
    expect(n.taxes.map((t) => t.taxCode)).toEqual(["HST13"]);
    expect(n.total!.toString()).toBe("612.64");
  });

  it("French: decimal commas, TPS and TVQ, arithmetic closes", () => {
    const { result } = get("laurentianlogist_FA002399.pdf");
    const n = result.invoice;
    expect(result.arithmetic.closes).toBe(true);
    expect(result.needsReview).toBe(false);
    expect(n.language).toBe("fr");
    expect(n.lines).toHaveLength(6);
    expect(n.lines[0].amount!.toString()).toBe("1014.18");
    expect(n.taxes.map((t) => [t.taxCode, t.amount.toString()])).toEqual([
      ["GST5", "218.13"],
      ["QST9975", "435.18"],
    ]);
    expect(n.total!.toString()).toBe("5015.98");
    expect(n.qstNumber).toBe("1745206219TQ0001");
  });

  it("credit note: negative, with its reference", () => {
    const { result } = get("greatlakescarrie-inv-025.pdf");
    const n = result.invoice;
    expect(n.kind).toBe("credit_note");
    expect(n.creditNoteRef).toBe("GR26-2262");
    expect(n.total!.toString()).toBe("-672");
    expect(n.taxes[0].amount.toString()).toBe("-32");
    expect(result.arithmetic.closes).toBe(true);
  });

  it("arithmetic error on the total: not a reading problem, values all in the text", () => {
    const { result } = get("evergreenenergyu_000850.pdf");
    expect(result.arithmetic).toMatchObject({ lines: [true], subtotal: true, total: false, closes: false });
    expect(result.invoice.evidence.total).toBe("confirmed");
    expect(result.needsReview).toBe(false);
  });

  it("arithmetic error on a line", () => {
    const { result } = get("northstarmediabu_NO261773.pdf");
    expect(result.arithmetic).toMatchObject({ lines: [false], subtotal: true, total: true, closes: false });
    expect(result.invoice.evidence["lines.0.amount"]).toBe("confirmed");
  });

  it("USD with no tax and no bank details", () => {
    const { result } = get("sparkgridcrminc_FA002342.pdf");
    const n = result.invoice;
    expect(n.currency).toBe("USD");
    expect(n.taxes).toEqual([]);
    expect(n.gstHstNumber).toBeNull();
    expect(n.remit).toMatchObject({ institution: null, account: null });
    expect(result.arithmetic.closes).toBe(true);
    expect(result.needsReview).toBe(false);
  });

  it("scan: no text layer; numbers confirmed by arithmetic, text fields unchecked", () => {
    const { inspection, result } = get("scan_8049.png");
    expect(inspection).toMatchObject({ kind: "image", hasTextLayer: false });
    expect(result.arithmetic.closes).toBe(true);
    const e = result.invoice.evidence;
    expect([e.total, e.subtotal, e["taxes.1.amount"], e["lines.4.amount"]]).toEqual(Array(4).fill("confirmed"));
    expect(e.invoiceNumber).toBeUndefined();
    expect(e["vendor.name"]).toBeUndefined();
    expect(result.needsReview).toBe(false);
    expect(result.invoice.taxes.map((t) => t.taxCode)).toEqual(["GST5", "QST9975"]);
  });
});
