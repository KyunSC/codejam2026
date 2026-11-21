/**
 * The pipeline after intake: inspect → extract → normalise, for each draft in `received`
 * (BUILD_PLAN "Pipeline"). Each stage's output is stored: the inspection on the `Document`
 * (page count, text layer), the model's answer in `Invoice.extracted`, the evidence in
 * `Invoice.evidence`, the normalised invoice in `Invoice.normalized` plus its columns, lines and
 * taxes.
 *
 * Every draft ends in a named state; nothing throws to the caller:
 *
 * | End           | When                                                    | Status         |
 * | ------------- | ------------------------------------------------------- | -------------- |
 * | extracted     | an invoice or credit note, every required field checked | `extracted`    |
 * | needs_review  | a required field uncertain, unreadable, not in text...  | `needs_review` |
 * | unreadable    | the file does not open, or the answer is unusable       | `needs_review` + `UNREADABLE` flag |
 * | not_invoice   | the document is a statement or something else           | `needs_review`, email labelled |
 * | not_extracted | no answer yet (no API key and no recorded answer, or the call failed) | stays `received`; the next run retries |
 *
 * `prepare` does the reading and the model call with no writes; `commit` writes in the caller's
 * transaction, and only if the draft is still `received`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import Decimal from "decimal.js";
import type { Prisma } from "@/generated/prisma/client";
import { datasetDir } from "../dataset";
import type { Extracted, NormalizedInvoice, TaxCode } from "../types";
import { createExtractor, type ExtractResult, type Extractor } from "./extract";
import { inspectDocument, type Inspection } from "./inspect";
import { normalizeDetailed, type NormalizeResult } from "./normalize";
import { sealedFileNames } from "./sealed";
import { transactionsOn, type Db, type InTransaction } from "./tx";

type Tx = Db;

export type EndState = "extracted" | "needs_review" | "unreadable" | "not_invoice" | "not_extracted";

export interface RunOutcome {
  invoiceId: string;
  fileName: string | null;
  end: EndState;
  /** One sentence for the run log and the review screen. */
  detail: string;
}

const DATASET_PREFIX = "dataset:incoming_invoices/";

/** The document's bytes: stored in the row, or a dataset file named by its url. Never a sealed file. */
export function documentBytes(doc: { data: Uint8Array | null; url: string | null; fileName: string }): Uint8Array {
  if (doc.data && doc.data.length > 0) return new Uint8Array(doc.data);
  if (doc.url?.startsWith(DATASET_PREFIX)) {
    const name = doc.url.slice(DATASET_PREFIX.length);
    if (name !== path.basename(name)) throw new Error(`Bad dataset url ${doc.url}`);
    if (sealedFileNames().has(name)) throw new Error(`Refusing to read sealed file ${name}`);
    return new Uint8Array(readFileSync(path.join(datasetDir(), "incoming_invoices", name)));
  }
  // No data and no url: an empty upload.
  return new Uint8Array();
}

function loadDraft(db: Tx, invoiceId: string) {
  return db.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      status: true,
      receivedDate: true,
      emailId: true,
      document: { select: { id: true, sha256: true, fileName: true, data: true, url: true } },
      email: { select: { fromAddress: true, fromName: true } },
    },
  });
}

export type Prepared = {
  invoiceId: string;
  fileName: string | null;
  documentId: string | null;
  inspection: Inspection | null;
} & (
  | { kind: "skip"; detail: string }
  | { kind: "unreadable"; detail: string; reason: string }
  | { kind: "not_extracted"; detail: string }
  | { kind: "not_invoice"; extraction: Extract<ExtractResult, { ok: true }> }
  | { kind: "invoice"; extraction: Extract<ExtractResult, { ok: true }>; result: NormalizeResult }
);

/** Reads, inspects, extracts and normalises one draft. No writes; never throws for a bad file. */
export async function prepare(db: Tx, invoiceId: string, extractor: Extractor): Promise<Prepared> {
  const draft = await loadDraft(db, invoiceId);
  const base = {
    invoiceId,
    fileName: draft?.document?.fileName ?? null,
    documentId: draft?.document?.id ?? null,
    inspection: null,
  };
  if (!draft) return { ...base, kind: "skip", detail: "No such invoice." };
  if (draft.status !== "received") return { ...base, kind: "skip", detail: `Already ${draft.status}.` };
  if (!draft.document) {
    return { ...base, kind: "unreadable", reason: "no_document", detail: "The draft has no file attached." };
  }

  let bytes: Uint8Array;
  try {
    bytes = documentBytes(draft.document);
  } catch (e) {
    return { ...base, kind: "unreadable", reason: "file_unavailable", detail: (e as Error).message };
  }
  const inspection = await inspectDocument(bytes);
  const withInspection = { ...base, inspection };
  if (inspection.problem) {
    return { ...withInspection, kind: "unreadable", reason: inspection.problem, detail: inspection.detail ?? "" };
  }

  let extraction: ExtractResult;
  try {
    extraction = await extractor.extract({
      sha256: inspection.sha256,
      bytes,
      mime: inspection.mime!,
      fileName: draft.document.fileName,
      hasTextLayer: inspection.hasTextLayer,
    });
  } catch (e) {
    extraction = { ok: false, reason: "api_error", detail: (e as Error).message };
  }
  if (!extraction.ok) {
    if (extraction.reason === "bad_answer") {
      return { ...withInspection, kind: "unreadable", reason: "bad_answer", detail: extraction.detail };
    }
    return { ...withInspection, kind: "not_extracted", detail: extraction.detail };
  }

  const docType = extraction.extracted.docType;
  if (docType !== "invoice" && docType !== "credit_note") {
    return { ...withInspection, kind: "not_invoice", extraction };
  }
  const result = normalizeDetailed(extraction.extracted, {
    fileSha256: inspection.sha256,
    textLayer: inspection.textLayer,
    hasTextLayer: inspection.hasTextLayer,
    receivedDate: draft.receivedDate.toISOString().slice(0, 10),
    emailId: draft.emailId,
    senderAddress: draft.email?.fromAddress ?? null,
    senderName: draft.email?.fromName ?? null,
    secondRead: extraction.secondRead,
  });
  return { ...withInspection, kind: "invoice", extraction, result };
}

/** Decimals become strings, so the stored JSON reads back the same everywhere. */
const asJson = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const dec = (d: { toString(): string } | null) => (d === null ? null : d.toString());
const day = (iso: string | null) => (iso === null ? null : new Date(`${iso}T00:00:00Z`));

const GST_HST: ReadonlySet<TaxCode> = new Set(["HST13", "GST5"]);
const PST_QST: ReadonlySet<TaxCode> = new Set(["PST7_BC", "QST9975"]);

function taxSum(n: NormalizedInvoice, codes: ReadonlySet<TaxCode>): string | null {
  const parts = n.taxes.filter((t) => t.taxCode !== null && codes.has(t.taxCode));
  if (parts.length === 0) return null;
  return parts.reduce((s, t) => s.plus(t.amount), new Decimal(0)).toString();
}

/** Labels an email with attachments by what its first readable attachment turned out to be. */
async function labelEmailByDocument(tx: Tx, emailId: string | null, docType: Extracted["docType"]): Promise<void> {
  if (!emailId) return;
  await tx.inboxEmail.updateMany({
    where: { id: emailId, label: null },
    data: { label: docType, labelReason: `The attachment is ${docType.replace("_", " ")}.`, labelSource: "rule" },
  });
}

/**
 * Writes one prepared draft. Only moves a draft that is still `received`, so two runs cannot
 * both write it. Returns the end state.
 */
export async function commit(tx: Tx, p: Prepared): Promise<RunOutcome> {
  const out = (end: EndState, detail: string): RunOutcome => ({
    invoiceId: p.invoiceId,
    fileName: p.fileName,
    end,
    detail,
  });
  if (p.kind === "skip") return out("not_extracted", p.detail);

  if (p.inspection && p.documentId && p.inspection.problem === null) {
    await tx.document.update({
      where: { id: p.documentId },
      data: { pageCount: p.inspection.pageCount, textLayer: p.inspection.textLayer, mime: p.inspection.mime! },
    });
  }
  if (p.kind === "not_extracted") return out("not_extracted", p.detail);

  const move = async (data: Prisma.InvoiceUncheckedUpdateManyInput) => {
    const { count } = await tx.invoice.updateMany({ where: { id: p.invoiceId, status: "received" }, data });
    if (count !== 1) throw new Error(`Invoice ${p.invoiceId} is no longer received; another run moved it.`);
  };

  if (p.kind === "unreadable") {
    await move({ status: "needs_review" });
    await tx.flag.create({
      data: {
        invoiceId: p.invoiceId,
        code: "UNREADABLE",
        klass: "data",
        effect: "hold",
        message: `The file cannot be read: ${p.detail}`,
        evidence: asJson([
          { label: "Problem", value: p.reason, source: "intake" },
          ...(p.fileName ? [{ label: "File", value: p.fileName, source: "intake" }] : []),
        ]),
      },
    });
    return out("unreadable", p.detail);
  }

  const x = p.extraction.extracted;
  const meta = { source: p.extraction.source, model: p.extraction.model };
  const draft = await loadDraft(tx, p.invoiceId);
  await labelEmailByDocument(tx, draft?.emailId ?? null, x.docType);

  if (p.kind === "not_invoice") {
    await move({ status: "needs_review", docType: x.docType, extracted: asJson(x) });
    return out("not_invoice", `The document is ${x.docType === "statement" ? "a statement" : "not an invoice"}.`);
  }

  const { invoice: n, needsReview, reviewFields } = p.result;
  await move({
    status: needsReview ? "needs_review" : "extracted",
    kind: n.kind,
    docType: x.docType,
    extracted: asJson(x),
    evidence: asJson(n.evidence),
    normalized: asJson({ ...n, extraction: meta }),
    vendorInvoiceNumber: n.invoiceNumber,
    numberKey: n.numberKey,
    digitsKey: n.digitsKey,
    invoiceDate: day(n.invoiceDate),
    dueDate: day(n.dueDate),
    currency: n.currency,
    subtotal: dec(n.subtotal),
    gstHstAmount: taxSum(n, GST_HST),
    pstQstAmount: taxSum(n, PST_QST),
    total: dec(n.total),
  });
  await tx.invoiceLine.deleteMany({ where: { invoiceId: p.invoiceId } });
  await tx.invoiceTax.deleteMany({ where: { invoiceId: p.invoiceId } });
  if (n.lines.length > 0) {
    await tx.invoiceLine.createMany({
      data: n.lines.map((l) => ({
        invoiceId: p.invoiceId,
        lineNo: l.lineNo,
        description: l.description,
        quantity: dec(l.quantity),
        unitPrice: dec(l.unitPrice),
        amount: dec(l.amount),
      })),
    });
  }
  if (n.taxes.length > 0) {
    await tx.invoiceTax.createMany({
      data: n.taxes.map((t) => ({
        invoiceId: p.invoiceId,
        labelPrinted: t.labelPrinted,
        taxCode: t.taxCode,
        ratePrinted: dec(t.ratePrinted),
        amount: t.amount.toString(),
      })),
    });
  }
  if (needsReview) {
    const fields = reviewFields.map((f) => `${f.field} (${f.evidence.replace("_", " ")})`).join(", ");
    return out("needs_review", `Needs a person to check: ${fields}.`);
  }
  return out("extracted", "Every required field is confirmed.");
}

export interface RunOptions {
  extractor?: Extractor;
  /** Only these drafts; default every draft in `received`, oldest first. */
  invoiceIds?: string[];
  inTransaction?: InTransaction;
}

/** Runs every `received` draft through the stages, one transaction per draft. */
export async function runPipeline(prisma: Db, opts: RunOptions = {}): Promise<RunOutcome[]> {
  const inTransaction = opts.inTransaction ?? transactionsOn(prisma);
  const extractor = opts.extractor ?? createExtractor();
  const ids =
    opts.invoiceIds ??
    (
      await prisma.invoice.findMany({
        where: { status: "received" },
        orderBy: [{ receivedDate: "asc" }, { id: "asc" }],
        select: { id: true },
      })
    ).map((r) => r.id);
  const out: RunOutcome[] = [];
  for (const id of ids) {
    try {
      const p = await prepare(prisma, id, extractor);
      out.push(await inTransaction((tx) => commit(tx, p)));
    } catch (e) {
      // A database problem on one draft must not stop the batch; the draft stays received.
      out.push({ invoiceId: id, fileName: null, end: "not_extracted", detail: (e as Error).message });
    }
  }
  return out;
}
