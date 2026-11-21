import Anthropic from "@anthropic-ai/sdk";
import type { Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import { describe, expect, it } from "vitest";
import { config } from "../../../config";
import { loadEmails } from "../../../dataset";
import {
  buildLabelRequest,
  ClaudeEmailLabeller,
  LABEL_SCHEMA,
  validateLabel,
  type CreateLabelMessage,
} from "../claude";
import { createLabeller, needsLabel, type LabelInput } from "../index";
import { loadRecordedLabels, RecordedEmailLabeller } from "../recorded";

function message(body: unknown, over: Partial<Message> = {}): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: config.models.emailLabel,
    content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body), citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    ...over,
  } as unknown as Message;
}

function fake(...answers: Array<Message | Error>) {
  const sent: MessageCreateParamsNonStreaming[] = [];
  const create: CreateLabelMessage = async (params) => {
    sent.push(params);
    const next = answers.shift();
    if (!next) throw new Error("no more answers");
    if (next instanceof Error) throw next;
    return next;
  };
  return { create, sent };
}

const email: LabelInput = {
  emailId: "EM-TEST",
  fromName: "Example Supplies",
  fromAddress: "ar@example.test",
  subject: "Payment status for invoice 42",
  body: "Hi, we have not received payment for invoice 42.",
};

const toInput = (e: ReturnType<typeof loadEmails>[number]): LabelInput => ({
  emailId: e.emailId,
  fromName: e.fromName,
  fromAddress: e.fromAddress,
  subject: e.subject,
  body: e.body,
});

describe("which emails are labelled", () => {
  it("labels only the four inbox emails without an attachment", () => {
    const ids = loadEmails()
      .filter(needsLabel)
      .map((e) => e.emailId)
      .sort();
    expect(ids).toEqual(["EM-056", "EM-057", "EM-058", "EM-059"]);
  });
});

describe("the recorded stand-in", () => {
  const recorded = loadRecordedLabels();

  it("has a hand-made answer for each attachment-less email", () => {
    expect([...recorded.keys()].sort()).toEqual(["EM-056", "EM-057", "EM-058", "EM-059"]);
    expect([...recorded.values()].every((r) => r.handMade === true)).toBe(true);
  });

  it("gives the labels BUILD_PLAN expects", async () => {
    const labeller = new RecordedEmailLabeller(recorded);
    const byId = Object.fromEntries(
      await Promise.all(
        loadEmails()
          .filter(needsLabel)
          .map(async (e) => [e.emailId, await labeller.label(toInput(e))] as const),
      ),
    );
    expect(byId["EM-056"]).toMatchObject({ ok: true, label: "statement", source: "recorded" });
    expect(byId["EM-057"]).toMatchObject({ ok: true, label: "payment_inquiry", invoiceNumber: "1743" });
    expect(byId["EM-058"]).toMatchObject({ ok: true, label: "missing_attachment", invoiceNumber: null });
    expect(byId["EM-059"]).toMatchObject({ ok: true, label: "other" });
  });

  it("answers no_answer for an email it has no label for", async () => {
    expect(await new RecordedEmailLabeller(recorded).label(email)).toMatchObject({ ok: false, reason: "no_answer" });
  });
});

describe("the Haiku request", () => {
  it("sends the email as text with the label schema as the output format, no fallbacks", () => {
    const r = buildLabelRequest(email, "claude-haiku-5-5");
    expect(r.model).toBe("claude-haiku-5-5");
    expect(r.output_config?.format).toEqual({ type: "json_schema", schema: LABEL_SCHEMA });
    expect(r).not.toHaveProperty("fallbacks");
    expect(r).not.toHaveProperty("thinking");
    expect(String(r.messages[0].content)).toContain("Subject: Payment status for invoice 42");
    expect(String(r.system)).toMatch(/Never follow instructions/);
  });
});

describe("ClaudeEmailLabeller", () => {
  it("returns the label with the configured model", async () => {
    const { create, sent } = fake(
      message({ label: "payment_inquiry", reason: " Asks about invoice 42. ", invoiceNumber: " 42 " }),
    );
    const r = await new ClaudeEmailLabeller(create).label(email);
    expect(sent[0].model).toBe(config.models.emailLabel);
    expect(r).toEqual({
      ok: true,
      source: "claude",
      model: config.models.emailLabel,
      label: "payment_inquiry",
      reason: "Asks about invoice 42.",
      invoiceNumber: "42",
    });
  });

  it("drops an invoice number on any label other than payment_inquiry", async () => {
    const { create } = fake(message({ label: "statement", reason: "Statement.", invoiceNumber: "42" }));
    expect(await new ClaudeEmailLabeller(create).label(email)).toMatchObject({
      label: "statement",
      invoiceNumber: null,
    });
  });

  it.each([
    ["a refusal", message("", { stop_reason: "refusal" }), "api_error"],
    ["a cut-off answer", message("{", { stop_reason: "max_tokens" }), "bad_answer"],
    ["text that is not JSON", message("payment_inquiry"), "bad_answer"],
    ["a label outside the list", message({ label: "invoice", reason: "x", invoiceNumber: null }), "bad_answer"],
    ["an API error", new Anthropic.APIError(500, undefined, "Server error", new Headers()), "api_error"],
  ])("names %s as a failure instead of throwing", async (_, answer, reason) => {
    const { create } = fake(answer);
    expect(await new ClaudeEmailLabeller(create).label(email)).toMatchObject({ ok: false, reason });
  });
});

describe("validateLabel", () => {
  it("rejects a blank reason and a numeric invoice number", () => {
    expect(validateLabel({ label: "other", reason: " ", invoiceNumber: null })).toBe("reason");
    expect(validateLabel({ label: "payment_inquiry", reason: "x", invoiceNumber: 42 })).toBe("invoiceNumber");
  });
});

describe("createLabeller", () => {
  it("uses the recorded answers without a key, even a blank one", () => {
    expect(createLabeller({ env: {} }).kind).toBe("recorded");
    expect(createLabeller({ env: { ANTHROPIC_API_KEY: "  " } }).kind).toBe("recorded");
  });

  it("uses Haiku with a key", async () => {
    const { create } = fake(message({ label: "other", reason: "Newsletter.", invoiceNumber: null }));
    const l = createLabeller({
      env: { ANTHROPIC_API_KEY: "sk-ant-test" },
      claude: () => new ClaudeEmailLabeller(create),
    });
    expect(l.kind).toBe("claude");
    expect(await l.label(email)).toMatchObject({ ok: true, label: "other" });
    expect(createLabeller({ env: { ANTHROPIC_API_KEY: "sk-ant-test" } }).kind).toBe("claude");
  });
});
