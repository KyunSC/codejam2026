/**
 * Labelling emails that carry no attachment (BUILD_PLAN "Intake"). Emails with attachments are
 * labelled by what the attachment turns out to be, never by this.
 */
import type { EmailLabel } from "../../types";

/** The labels an email without an attachment can get. */
export const ATTACHMENTLESS_LABELS = ["statement", "payment_inquiry", "missing_attachment", "other"] as const;
export type AttachmentlessLabel = (typeof ATTACHMENTLESS_LABELS)[number] & EmailLabel;

export interface LabelInput {
  emailId: string;
  fromName: string;
  fromAddress: string;
  subject: string;
  body: string;
}

export interface EmailLabelAnswer {
  label: AttachmentlessLabel;
  /** One sentence shown beside the email in its queue. */
  reason: string;
  /** For a payment inquiry: the invoice number the email asks about, as written. */
  invoiceNumber: string | null;
}

export type LabelSource = "claude" | "recorded";

export type LabelResult =
  | ({ ok: true; source: LabelSource; model: string } & EmailLabelAnswer)
  | { ok: false; reason: "no_answer" | "api_error" | "bad_answer"; detail: string };

export interface EmailLabeller {
  readonly kind: LabelSource;
  label(input: LabelInput): Promise<LabelResult>;
}
