/**
 * Email checks (BUILD_PLAN Bonus → Fraud alerts):
 * - SENDER_DOMAIN_MISMATCH: the sender's domain is not the resolved vendor's `ap_contact_email` domain.
 * - SENDER_LOOKALIKE_DOMAIN: the sender's domain is within a small edit distance of a known vendor's domain,
 *   or contains that vendor's domain name, without being it (unsealed: harlowandstern-llp.example vs harlow.example).
 * Both are fraud / hold: a finance manager or controller confirms or overrides them. Uploads have no sender.
 */
import { config } from "../../config";
import { ev, makeFlag } from "../format";
import type { Check } from "./reading";

export function emailDomain(address: string | null | undefined): string | null {
  const m = address?.match(/@([A-Za-z0-9.-]+\.[A-Za-z]{2,})>?\s*$/);
  return m ? m[1].toLowerCase() : null;
}

/** The domain's name without its last label and without punctuation: "harlowandstern-llp.example" → "harlowandsternllp". */
const nameOf = (domain: string) => domain.split(".").slice(0, -1).join("").replace(/[^a-z0-9]/g, "");

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = cur;
  }
  return prev[b.length];
}

export const checkSenderDomainMismatch: Check = (inv, refs) => {
  const sender = emailDomain(inv.senderAddress);
  const v = inv.vendorId ? refs.vendors.get(inv.vendorId) : undefined;
  const expected = emailDomain(v?.apContactEmail);
  if (!sender || !v || !expected || sender === expected) return [];
  return [
    makeFlag(
      "SENDER_DOMAIN_MISMATCH",
      "fraud",
      "hold",
      `The email came from ${sender}, but ${v.legalName} (${v.vendorId}) sends invoices from ${expected}. Confirm with the vendor on the number on file before paying.`,
      [ev("Sender", inv.senderAddress, "email From"), ev("Vendor AP contact", v.apContactEmail, `vendors.csv ${v.vendorId}`)],
      { vendorIds: [v.vendorId] },
    ),
  ];
};

export const checkSenderLookalikeDomain: Check = (inv, refs) => {
  const sender = emailDomain(inv.senderAddress);
  if (!sender) return [];
  const known = new Map<string, string[]>();
  for (const v of refs.vendors.values()) {
    const d = emailDomain(v.apContactEmail);
    if (d) known.set(d, [...(known.get(d) ?? []), v.vendorId]);
  }
  if (!known.size) return [];
  const s = nameOf(sender);
  const { lookalikeDomainMaxEdits: maxEdits, lookalikeDomainMinNameLen: minLen } = config.checks;
  const imitated: Array<{ domain: string; vendorIds: string[]; how: string }> = [];
  for (const [domain, vendorIds] of known) {
    if (domain === sender) continue;
    const n = nameOf(domain);
    if (!n) continue;
    const d = editDistance(s, n);
    if (d <= maxEdits) imitated.push({ domain, vendorIds, how: `${d} letter${d === 1 ? "" : "s"} off` });
    else if (n.length >= minLen && s.includes(n)) imitated.push({ domain, vendorIds, how: `contains "${n}"` });
  }
  if (!imitated.length) return [];
  const names = imitated.map((x) => `${x.domain} (${x.vendorIds.map((id) => `${id} ${refs.vendors.get(id)?.legalName ?? ""}`.trim()).join(", ")}; ${x.how})`);
  return [
    makeFlag(
      "SENDER_LOOKALIKE_DOMAIN",
      "fraud",
      "hold",
      `The email came from ${sender}, which looks like ${names.join("; ")} without being it. Treat it as a possible impersonation until confirmed with the vendor on the number on file.`,
      [ev("Sender", inv.senderAddress, "email From"), ...imitated.map((x) => ev("Look-alike of", x.domain, `vendors.csv ${x.vendorIds.join(", ")}`))],
      { vendorIds: [...new Set([...(inv.vendorId ? [inv.vendorId] : []), ...imitated.flatMap((x) => x.vendorIds)])] },
    ),
  ];
};

export const EMAIL_CHECKS = {
  SENDER_DOMAIN_MISMATCH: checkSenderDomainMismatch,
  SENDER_LOOKALIKE_DOMAIN: checkSenderLookalikeDomain,
} as const;
