/**
 * The labeller used when there is no API key: hand-made answers kept in `fixtures/labels/`,
 * served by email id. An email with no recorded answer gets `no_answer`.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { datasetDir } from "../../dataset";
import { validateLabel } from "./claude";
import type { EmailLabelAnswer, EmailLabeller, LabelInput, LabelResult } from "./types";

export interface RecordedLabel extends EmailLabelAnswer {
  handMade: true;
  emailId: string;
}

export function defaultLabelFixturesDir(): string {
  return path.join(path.dirname(datasetDir()), "fixtures", "labels");
}

export function loadRecordedLabels(dir = defaultLabelFixturesDir()): Map<string, RecordedLabel> {
  const out = new Map<string, RecordedLabel>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const list = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as unknown;
    if (!Array.isArray(list)) throw new Error(`${f}: expected a list of recorded labels.`);
    for (const r of list as RecordedLabel[]) {
      if (r.handMade !== true) throw new Error(`${f}: ${r.emailId} is not marked handMade.`);
      const bad = validateLabel(r);
      if (bad) throw new Error(`${f}: ${r.emailId} has a bad ${bad}.`);
      if (out.has(r.emailId)) throw new Error(`${f}: ${r.emailId} is recorded twice.`);
      out.set(r.emailId, r);
    }
  }
  return out;
}

export class RecordedEmailLabeller implements EmailLabeller {
  readonly kind = "recorded" as const;
  private readonly labels: Map<string, RecordedLabel>;

  constructor(labels: Map<string, RecordedLabel> | string = defaultLabelFixturesDir()) {
    this.labels = typeof labels === "string" ? loadRecordedLabels(labels) : labels;
  }

  async label(input: LabelInput): Promise<LabelResult> {
    const r = this.labels.get(input.emailId);
    if (!r) {
      return {
        ok: false,
        reason: "no_answer",
        detail: "No API key and no recorded label for this email; it waits for a person.",
      };
    }
    return {
      ok: true,
      source: "recorded",
      model: "hand-made",
      label: r.label,
      reason: r.reason,
      invoiceNumber: r.invoiceNumber,
    };
  }
}
