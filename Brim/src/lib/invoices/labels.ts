/** Plain-words names for invoice states and sources. Safe to import from client components. */

export const STATUS_LABEL: Record<string, string> = {
  received: "Received",
  extracted: "Read",
  needs_review: "Needs review",
  coded: "Coded",
  pending_approval: "Waiting for approval",
  approved: "Approved",
  scheduled: "Payment scheduled",
  released: "Payment sent",
  paid: "Paid",
  rejected: "Rejected",
  on_hold: "On hold",
  duplicate: "Duplicate",
  void: "Void",
};

/** States whose payment has gone out. They are listed apart, below the invoices still in progress. */
export const SENT_STATUSES = ["released", "paid"];

export const SOURCE_LABEL: Record<string, string> = {
  inbox: "AP inbox",
  upload: "Upload",
  submission: "Employee submission",
  manual: "Invoice form",
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}
