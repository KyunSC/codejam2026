import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Extracted } from "../../../types";
import { FileExtractionCache, MemoryExtractionCache, type CacheEntry } from "../cache";
import { anthropicKey, CachedExtractor, createExtractor, type ExtractInput, type Extractor } from "../index";
import { loadRecordedAnswers, RecordedExtractor, type RecordedAnswer } from "../recorded";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

const answer = (invoiceNumber: string): Extracted => ({
  docType: "invoice",
  language: "en",
  vendor: { name: "Acme", address: null, gstHstNumber: null, qstNumber: null },
  billTo: { name: null, address: null },
  invoiceNumber,
  invoiceDate: "2026-10-28",
  dueDate: null,
  terms: null,
  poNumber: null,
  creditNoteRef: null,
  currency: "CAD",
  lines: [],
  subtotal: "100.00",
  taxes: [],
  total: "100.00",
  remit: { institution: null, transit: null, account: null, text: null },
  notes: [],
  unreadable: [],
});

const input = (sha256: string, hasTextLayer = true): ExtractInput => ({
  sha256,
  bytes: new Uint8Array([1]),
  mime: "application/pdf",
  hasTextLayer,
});

const recording = (over: Partial<RecordedAnswer> = {}): RecordedAnswer => ({
  handMade: true,
  file: "made-up.pdf",
  sha256: SHA_A,
  extracted: answer("R-1"),
  ...over,
});

class FakeClaude implements Extractor {
  readonly kind = "claude" as const;
  calls = 0;
  async extract() {
    this.calls++;
    return { ok: true as const, extracted: answer("C-1"), secondRead: null, source: "claude" as const, model: "m" };
  }
}

describe("anthropicKey", () => {
  it.each([
    [undefined, null],
    ["", null],
    ["   \n", null],
    ["  sk-ant-x  ", "sk-ant-x"],
  ])("%j → %j", (value, expected) => {
    expect(anthropicKey({ ANTHROPIC_API_KEY: value })).toBe(expected);
  });
});

describe("RecordedExtractor", () => {
  it("answers by hash, marked as recorded, and says when it has nothing", async () => {
    const x = new RecordedExtractor(new Map([[SHA_A, recording()]]));
    expect(await x.extract(input(SHA_A))).toMatchObject({ ok: true, source: "recorded", model: "hand-made" });
    expect(await x.extract(input(SHA_B))).toMatchObject({ ok: false, reason: "no_answer" });
  });

  it("gives the second read only for a scan", async () => {
    const x = new RecordedExtractor(new Map([[SHA_A, recording({ secondRead: answer("R-2") })]]));
    expect(await x.extract(input(SHA_A, true))).toMatchObject({ secondRead: null });
    expect(await x.extract(input(SHA_A, false))).toMatchObject({ secondRead: { invoiceNumber: "R-2" } });
  });

  it("refuses fixture files not marked hand-made", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rec-"));
    writeFileSync(path.join(dir, "x.json"), JSON.stringify({ ...recording(), handMade: false }));
    expect(() => loadRecordedAnswers(dir)).toThrow(/handMade/);
  });

  it("loads nothing from a missing folder", () => {
    expect(loadRecordedAnswers(path.join(tmpdir(), "no-such-dir-xyz")).size).toBe(0);
  });
});

describe("the cache", () => {
  const entry: CacheEntry = {
    source: "claude",
    sha256: SHA_A,
    model: "m",
    extractedAt: "2026-11-02T00:00:00.000Z",
    extracted: answer("C-1"),
    secondRead: null,
  };

  it("round-trips a real answer on disk and refuses anything else", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cache-"));
    const c = new FileExtractionCache(dir);
    expect(c.get(SHA_A)).toBeNull();
    c.put(entry);
    expect(c.get(SHA_A)).toEqual(entry);
    expect(() => c.put({ ...entry, source: "recorded" } as unknown as CacheEntry)).toThrow(/real model/);
    expect(() => c.get("../etc/passwd")).toThrow(/SHA-256/);
    writeFileSync(path.join(dir, `${SHA_B}.json`), JSON.stringify({ ...entry, sha256: SHA_B, source: "recorded" }));
    expect(c.get(SHA_B)).toBeNull();
  });

  it("stores a real answer once and serves it from the cache after", async () => {
    const cache = new MemoryExtractionCache();
    const claude = new FakeClaude();
    const x = new CachedExtractor(claude, cache);
    expect(await x.extract(input(SHA_A))).toMatchObject({ source: "claude" });
    expect(await x.extract(input(SHA_A))).toMatchObject({ source: "cache", extracted: { invoiceNumber: "C-1" } });
    expect(claude.calls).toBe(1);
  });

  it("never stores a recorded answer", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cache-"));
    const x = createExtractor({
      env: {},
      cache: new FileExtractionCache(dir),
      recorded: new RecordedExtractor(new Map([[SHA_A, recording()]])),
    });
    expect(x.kind).toBe("recorded");
    expect(await x.extract(input(SHA_A))).toMatchObject({ ok: true, source: "recorded" });
    expect(readdirSync(dir)).toEqual([]);
  });

  it("serves a cached real answer even with no key", async () => {
    const cache = new MemoryExtractionCache();
    cache.put(entry);
    const x = createExtractor({ env: { ANTHROPIC_API_KEY: " " }, cache, recorded: new RecordedExtractor(new Map()) });
    expect(await x.extract(input(SHA_A))).toMatchObject({ ok: true, source: "cache" });
  });
});

describe("createExtractor", () => {
  it("uses the real extractor when a key is set", async () => {
    const claude = new FakeClaude();
    const x = createExtractor({
      env: { ANTHROPIC_API_KEY: "sk-ant-x" },
      cache: new MemoryExtractionCache(),
      claude: () => claude,
    });
    expect(x.kind).toBe("claude");
    await x.extract(input(SHA_B));
    expect(claude.calls).toBe(1);
  });
});
