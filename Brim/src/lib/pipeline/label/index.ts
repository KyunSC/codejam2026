import { anthropicKey } from "../extract/key";
import { anthropicLabelCreate, ClaudeEmailLabeller } from "./claude";
import { RecordedEmailLabeller } from "./recorded";
import type { EmailLabeller } from "./types";

export * from "./types";

/** Only emails without attachments are labelled by the model (BUILD_PLAN "Intake"). */
export function needsLabel(email: { attachments: readonly string[] }): boolean {
  return email.attachments.length === 0;
}

export interface LabellerOptions {
  env?: Record<string, string | undefined>;
  claude?: (apiKey: string) => EmailLabeller;
  recorded?: EmailLabeller;
}

/** Haiku when a key is set, else the hand-made answers. */
export function createLabeller(opts: LabellerOptions = {}): EmailLabeller {
  const key = anthropicKey(opts.env ?? process.env);
  if (key) return (opts.claude ?? ((k: string) => new ClaudeEmailLabeller(anthropicLabelCreate(k))))(key);
  return opts.recorded ?? new RecordedEmailLabeller();
}
