// Stands in for Anthropic's API when no key is set: answers the app's reading calls with readings done by hand (scripts/readings.json).
// A document is recognised by its content; an email with nothing attached by its subject. Point the app at it with
// ANTHROPIC_BASE_URL=http://localhost:4545 and any ANTHROPIC_API_KEY. Usage: npx tsx scripts/reader.ts
import { createHash } from "crypto";
import { readdirSync, readFileSync } from "fs";
import { createServer } from "http";
import path from "path";

process.loadEnvFile(path.join(import.meta.dirname, "../.env.local"));
const PORT = Number(process.env.READER_PORT ?? 4545);
const INCOMING = path.join(process.env.FEEDS_DIR!, "incoming_invoices");
const readings: { documents: Record<string, unknown>; emails: Record<string, unknown> } = JSON.parse(readFileSync(path.join(import.meta.dirname, "readings.json"), "utf8"));

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
// the file each document's bytes belong to
const byContent = new Map(readdirSync(INCOMING).map((f) => [sha(readFileSync(path.join(INCOMING, f))), f]));

type Block = { type: string; text?: string; source?: { type: string; data: string } };
function answer(body: { model: string; messages: { content: string | Block[] }[] }): { status: number; json: unknown } {
  const content = body.messages[0]?.content;
  const blocks: Block[] = typeof content === "string" ? [{ type: "text", text: content }] : content ?? [];
  const file = blocks.find((b) => (b.type === "document" || b.type === "image") && b.source?.type === "base64");
  let output: unknown;
  if (file) {
    const name = byContent.get(sha(Buffer.from(file.source!.data, "base64")));
    output = name && readings.documents[name];
    if (!output) return error(`No reading for this document${name ? ` (${name})` : ""}.`);
  } else {
    const subject = blocks.map((b) => b.text ?? "").join("\n").match(/^Subject: (.*)$/m)?.[1]?.trim() ?? "";
    output = readings.emails[subject];
    if (!output) return error(`No reading for the email "${subject}".`);
  }
  return {
    status: 200,
    json: {
      id: `msg_reader_${Date.now()}`, type: "message", role: "assistant", model: body.model,
      content: [{ type: "text", text: JSON.stringify(output) }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 },
    },
  };
}
const error = (message: string) => ({ status: 400, json: { type: "error", error: { type: "invalid_request_error", message } } });

createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const { status, json } = req.method === "POST" && req.url?.startsWith("/v1/messages")
      ? answer(JSON.parse(raw))
      : { status: 404, json: { type: "error", error: { type: "not_found_error", message: `${req.method} ${req.url}` } } };
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(json));
  });
}).listen(PORT, () => console.log(`reader on http://localhost:${PORT}: ${byContent.size} documents, ${Object.keys(readings.emails).length} emails`));
