/**
 * Resolution stage (BUILD_PLAN Pipeline): NormalizedInvoice + Refs → ResolvedInvoice.
 * vendor, bill-to province, PO, contract, department, requester, line accounts and types,
 * currency and FX, credit-note target.
 */
import type Decimal from "decimal.js";
import type { NormalizedInvoice, ResolvedInvoice, ResolvedLine } from "../../types";
import type { Refs } from "../refs";
import {
  findPo,
  resolveCreditTarget,
  resolveCurrency,
  resolveDepartment,
  resolveFx,
  resolveLineType,
  resolveProvince,
  resolveRequester,
  suggestPos,
} from "./fields";
import { resolveVendor } from "./vendor";

/** Suggests a GL account for a line. Smart coding provides the real one; the default is the vendor's account. */
export type LineCoder = (line: { description: string; lineNo: number }, vendorId: string | null, refs: Refs) => string | null;

export const vendorDefaultCoder: LineCoder = (_line, vendorId, refs) =>
  (vendorId && refs.vendors.get(vendorId)?.defaultGlAccount) || null;

export interface ResolveOptions {
  /** The employee who uploaded the file, if any (Resolution → Requester). */
  uploaderId?: string | null;
  codeLine?: LineCoder;
}

export interface ResolveNotes {
  vendor: string;
  department: string;
  fxRateDate: string | null;
  fxFallback: boolean;
}

export function resolveInvoice(
  doc: NormalizedInvoice,
  refs: Refs,
  opts: ResolveOptions = {},
): { invoice: ResolvedInvoice; notes: ResolveNotes } {
  const vendor = resolveVendor(doc, refs);
  const vendorRow = vendor.vendorId ? refs.vendors.get(vendor.vendorId) : undefined;
  const shipToProvince = resolveProvince(doc.billToAddress);
  const po = findPo(doc.poNumber, refs);
  const contract = vendor.vendorId ? (refs.contractByVendor.get(vendor.vendorId) ?? null) : null;
  const department = resolveDepartment(po, vendor.vendorId, shipToProvince, refs);
  const currencyResolved = resolveCurrency(doc.currency, vendorRow?.country);
  const fx = resolveFx(currencyResolved, doc.invoiceDate, refs);
  const code = opts.codeLine ?? vendorDefaultCoder;

  const lines: ResolvedLine[] = doc.lines.map((l) => {
    const glAccount = code(l, vendor.vendorId, refs);
    const lt = resolveLineType(glAccount, l.description, refs.lineTypes);
    return { ...l, glAccount, lineType: lt.lineType, lineTypeSource: lt.source };
  });

  const totalCad: Decimal | null = doc.total && fx.rate ? doc.total.mul(fx.rate).toDecimalPlaces(2) : null;
  const poSuggestions = !doc.poNumber && vendorRow?.requiresPo ? suggestPos(vendor.vendorId, doc.subtotal, refs) : [];

  const invoice: ResolvedInvoice = {
    ...doc,
    lines,
    vendorId: vendor.vendorId,
    vendorMatchedBy: vendor.vendorMatchedBy,
    vendorCandidates: vendor.vendorCandidates,
    shipToProvince,
    poId: po?.poId ?? null,
    poSuggestions,
    contractId: contract?.contractId ?? null,
    departmentId: department.departmentId,
    requesterId: resolveRequester(po, opts.uploaderId ?? null),
    creditOfInvoiceId:
      doc.kind === "credit_note" && vendor.vendorId ? resolveCreditTarget(doc.creditNoteRef, [vendor.vendorId], refs) : null,
    currencyResolved,
    fxRateToCad: fx.rate,
    totalCad,
  };
  return {
    invoice,
    notes: { vendor: vendor.reason, department: department.reason, fxRateDate: fx.rateDate, fxFallback: fx.fallback },
  };
}
