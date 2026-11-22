import { one } from "@/lib/db";
import type { CheckContext, Flag } from "./types";

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").replace(/^0+/, "");

export async function fraudChecks(ctx: CheckContext): Promise<Flag[]> {
  const { data: d, vendor, raw, db } = ctx;
  const flags: Flag[] = [];
  if (!vendor) return flags;

  if (d.remit_account && vendor.bank_account && digits(d.remit_account) !== digits(vendor.bank_account)) {
    flags.push({
      check_code: "remit_bank_mismatch",
      category: "fraud",
      severity: "blocking",
      message: `Invoice asks for payment to account ${d.remit_institution ?? "?"}-${d.remit_transit ?? "?"}-${d.remit_account}; the vendor master has ${vendor.bank_institution}-${vendor.bank_transit}-${vendor.bank_account}.`,
      evidence: { expected: vendor.bank_account, found: d.remit_account },
    });
  }

  const change = await one<{ change_id: string; requested_at: string; request_channel: string; verified_by_callback: boolean; status: string }>(
    "SELECT * FROM vendor_bank_changes WHERE vendor_id=$1 ORDER BY requested_at DESC LIMIT 1",
    [vendor.vendor_id],
    db,
  );
  if (change && (!change.verified_by_callback || change.status === "pending")) {
    flags.push({
      check_code: "bank_change_unverified",
      category: "fraud",
      severity: "blocking",
      message: `The vendor's bank details changed on ${String(change.requested_at).slice(0, 10)} by ${change.request_channel.replace(/_/g, " ")}, with no callback verification (${change.change_id}). Payment is held until it is verified.`,
    });
  }

  if (raw.kind === "email" && raw.from_address && vendor.ap_contact_email && raw.from_address.toLowerCase() !== vendor.ap_contact_email.toLowerCase()) {
    flags.push({
      check_code: "sender_mismatch",
      category: "fraud",
      severity: "warning",
      message: `Sent from ${raw.from_address}; the vendor's billing address is ${vendor.ap_contact_email}.`,
      evidence: { expected: vendor.ap_contact_email, found: raw.from_address },
    });
  }
  return flags;
}
