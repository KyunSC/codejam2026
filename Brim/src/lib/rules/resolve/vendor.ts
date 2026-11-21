/**
 * Vendor resolution (BUILD_PLAN Resolution → Vendor), in order, stopping at the first hit:
 *   1. GST/HST number on the document equals a master record's (all master tax numbers are unique).
 *   2. Bank account on the document equals a master record's and the names are similar.
 *   3. Normalised name equals a master name.
 *   4. No hit → no vendor; the closest names are offered as candidates, never chosen.
 *
 * A step that matches more than one vendor is not a hit: lookalike records share bank accounts
 * (two pairs) and normalised names (three pairs), so picking one would be a guess. Resolution falls
 * through to the next step, and if nothing is unique the matches are offered as candidates.
 *
 * The sender's email address is never used here; the fraud checks compare it afterwards.
 */
import { config } from "../../config";
import type { VendorRow } from "../../dataset";
import type { NormalizedInvoice, ResolvedInvoice } from "../../types";
import { idKey, nameSimilarity, normalizeName } from "../keys";
import type { Refs } from "../refs";

export interface VendorResolution {
  vendorId: string | null;
  vendorMatchedBy: ResolvedInvoice["vendorMatchedBy"];
  vendorCandidates: string[];
  /** One line for the review screen saying how the vendor was found, or why not. */
  reason: string;
}

type Doc = Pick<NormalizedInvoice, "vendorName" | "gstHstNumber" | "remit">;

function byTaxNumber(doc: Doc, vendors: readonly VendorRow[]): VendorRow[] {
  const key = idKey(doc.gstHstNumber);
  if (!key) return [];
  return vendors.filter((v) => idKey(v.gstHstNumber) === key);
}

function byBankAndName(doc: Doc, vendors: readonly VendorRow[]): VendorRow[] {
  const account = idKey(doc.remit.account);
  if (!account) return [];
  const transit = idKey(doc.remit.transit);
  const institution = idKey(doc.remit.institution);
  return vendors.filter(
    (v) =>
      idKey(v.bankAccount) === account &&
      (!transit || idKey(v.bankTransit) === transit) &&
      (!institution || idKey(v.bankInstitution) === institution) &&
      nameSimilarity(doc.vendorName, v.legalName) >= config.resolution.bankNameMinSimilarity,
  );
}

function byName(doc: Doc, vendors: readonly VendorRow[]): VendorRow[] {
  const name = normalizeName(doc.vendorName);
  if (!name) return [];
  return vendors.filter((v) => normalizeName(v.legalName) === name);
}

/** Closest master names by word overlap, best first. */
export function closestVendors(name: string | null, vendors: readonly VendorRow[]): string[] {
  return vendors
    .map((v) => ({ id: v.vendorId, s: nameSimilarity(name, v.legalName) }))
    .filter((x) => x.s >= config.resolution.candidateMinSimilarity)
    .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))
    .slice(0, config.resolution.candidateCount)
    .map((x) => x.id);
}

export function resolveVendor(doc: Doc, refs: Pick<Refs, "vendorList">): VendorResolution {
  const vendors = refs.vendorList;
  const ambiguous = new Set<string>();
  const steps: Array<[NonNullable<VendorResolution["vendorMatchedBy"]>, VendorRow[], string]> = [
    ["tax_number", byTaxNumber(doc, vendors), `GST/HST number ${doc.gstHstNumber}`],
    ["bank_account", byBankAndName(doc, vendors), `bank account ending ${doc.remit.account?.slice(-4)} and a similar name`],
    ["name", byName(doc, vendors), `name "${doc.vendorName}"`],
  ];
  for (const [how, hits, what] of steps) {
    if (hits.length === 1) {
      return {
        vendorId: hits[0].vendorId,
        vendorMatchedBy: how,
        vendorCandidates: [],
        reason: `Matched ${hits[0].vendorId} ${hits[0].legalName} by ${what}.`,
      };
    }
    for (const h of hits) ambiguous.add(h.vendorId);
  }
  const candidates = [...ambiguous, ...closestVendors(doc.vendorName, vendors).filter((id) => !ambiguous.has(id))]
    .slice(0, Math.max(config.resolution.candidateCount, ambiguous.size));
  return {
    vendorId: null,
    vendorMatchedBy: null,
    vendorCandidates: candidates,
    reason: ambiguous.size
      ? `"${doc.vendorName ?? "(no name)"}" matches more than one vendor record (${[...ambiguous].join(", ")}); a person must choose.`
      : `No vendor record matches "${doc.vendorName ?? "(no name)"}" by tax number, bank account or name.`,
  };
}
