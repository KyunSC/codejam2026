import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as generate } from "./generate/route";
import { POST as edit } from "./edit/route";
import { POST as repair } from "./repair/route";
import { GET as status } from "./status/route";
import { GET as listPredictions, POST as addPrediction } from "./sims/[id]/predictions/route";
import { PATCH as setObserved } from "./sims/[id]/predictions/[pid]/route";
import { store } from "@/lib/store";

import { POST as askClaude } from "./boards/[id]/ask/route";
import { POST as saveOps } from "./boards/[id]/ops/route";
import { POST as mcp } from "./mcp/route";
import { POST as createBoard, GET as listBoards } from "./boards/route";
import { GET as getBoard } from "./boards/[id]/route";

// Boards go to a temp file, not the app's data/boards.json.
vi.mock("@/lib/boards", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/boards")>();
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const store = real.createBoardStore(path.join(mkdtempSync(path.join(tmpdir(), "routes-boards-")), "boards.json"));
  return { ...real, boardStore: () => store };
});

afterEach(() => vi.unstubAllEnvs());

const post = (body: unknown) =>
  new Request("http://test/api/generate", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

describe("/api/status", () => {
  it("reports stand-in mode without a key and never leaks the key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await (await status()).json()).toEqual({ standIn: true });
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-not-real");
    vi.stubEnv("FAKE_MODEL", "");
    const text = await (await status()).text();
    expect(text).toBe('{"standIn":false}');
  });
});

describe("/api/generate", () => {
  it("rejects bad bodies", async () => {
    expect((await generate(post("not json"))).status).toBe(400);
    expect((await generate(post({ prompt: "   " }))).status).toBe(400);
    expect((await generate(post({ prompt: "x".repeat(5000) }))).status).toBe(413);
  });

  it("streams NDJSON from the stand-in", async () => {
    vi.stubEnv("FAKE_MODEL", "1");
    const res = await generate(post({ prompt: "pendulum" }));
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(JSON.parse(first.split("\n")[0])).toEqual({ type: "status", stage: "thinking" });
    await reader.cancel();
  });
});

describe("/api/repair", () => {
  it("needs code and error, and streams from the stand-in", async () => {
    vi.stubEnv("FAKE_MODEL", "1");
    expect((await repair(post({ code: "<html></html>" }))).status).toBe(400);
    expect((await repair(post({ code: "x".repeat(200_000), error: "boom" }))).status).toBe(413);
    const res = await repair(post({ code: "<html></html>", error: "boom" }));
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(JSON.parse(first.split("\n")[0]).type).toBe("status");
    await reader.cancel();
  });
});

describe("/api/edit", () => {
  it("needs code and request, and streams from the stand-in", async () => {
    vi.stubEnv("FAKE_MODEL", "1");
    expect((await edit(post({ code: "<html></html>" }))).status).toBe(400);
    const res = await edit(post({ code: "<html></html>", request: "make it red" }));
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    await res.body!.cancel();
  });
});

describe("/api/sims/[id]/predictions", () => {
  const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) }) as never;
  const body = (b: unknown) => new Request("http://test/x", { method: "POST", body: typeof b === "string" ? b : JSON.stringify(b) });

  it("404s on bad or unknown ids", async () => {
    expect((await addPrediction(body({ prediction: "p" }), ctx({ id: "../etc" }))).status).toBe(404);
    expect((await listPredictions(body({}), ctx({ id: "nothex" }))).status).toBe(404);
    expect((await setObserved(body({ observed: "o" }), ctx({ id: "0".repeat(32), pid: "bad" }))).status).toBe(404);
  });

  it("validates the body before touching the store", async () => {
    const id = ctx({ id: "0".repeat(32) });
    expect((await addPrediction(body("not json"), id)).status).toBe(400);
    expect((await addPrediction(body({ prediction: "   " }), id)).status).toBe(400);
    expect((await addPrediction(body({ prediction: "x".repeat(1001) }), id)).status).toBe(413);
    expect((await addPrediction(body({ prediction: "p", name: "n".repeat(61) }), id)).status).toBe(413);
    const both = ctx({ id: "0".repeat(32), pid: "0".repeat(32) });
    expect((await setObserved(body({ observed: "" }), both)).status).toBe(400);
    expect((await setObserved(body({ observed: "x".repeat(1001) }), both)).status).toBe(413);
  });
});

describe("/api/sims/[id]/predictions round trip", () => {
  // store() is created once per test file, on first use: point it at a temp file before anything touches it.
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "routes-"));
    process.env.SIMS_FILE = path.join(dir, "sims.json");
  });
  afterAll(async () => {
    delete process.env.SIMS_FILE;
    await rm(dir, { recursive: true, force: true });
  });
  const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) }) as never;
  const req = (method: string, b?: unknown) =>
    new Request("http://test/x", { method, body: b === undefined ? undefined : JSON.stringify(b) });

  it("posts, lists without ids, patches, and 404s on an unknown sim", async () => {
    const sim = await store().saveSim({
      prompt: "why?",
      code: "<html></html>",
      title: "T",
      question: "Q",
      params: [{ id: "m", label: "Mass", min: 1, max: 5, step: 1, value: 2 }],
    });
    const id = ctx({ id: sim.shareToken! });

    const publicId = ctx({ id: sim.id });
    expect((await listPredictions(req("GET"), publicId)).status).toBe(404);
    expect((await addPrediction(req("POST", { prediction: "p" }), publicId)).status).toBe(404);
    expect(JSON.stringify(await store().listSims())).not.toContain(sim.shareToken!);

    const first = await addPrediction(req("POST", { prediction: "  Same speed  " }), id);
    expect(first.status).toBe(201);
    const { prediction } = (await first.json()) as { prediction: { id: string; name: string; prediction: string } };
    expect(prediction).toMatchObject({ name: "Anonymous", prediction: "Same speed" });
    expect((await addPrediction(req("POST", { name: "Ben", prediction: "Faster", observed: "Nope" }), id)).status).toBe(201);

    const patched = await setObserved(req("PATCH", { observed: " They matched " }), ctx({ id: sim.shareToken!, pid: prediction.id }));
    expect(((await patched.json()) as { prediction: { observed: string } }).prediction.observed).toBe("They matched");

    const list = await listPredictions(req("GET"), id);
    expect(list.headers.get("cache-control")).toBe("no-store");
    const { predictions } = (await list.json()) as { predictions: Array<Record<string, unknown>> };
    expect(predictions.map((p) => [p.name, p.observed])).toEqual([
      ["Anonymous", "They matched"],
      ["Ben", "Nope"],
    ]);
    for (const p of predictions) expect(p).not.toHaveProperty("id");

    expect((await addPrediction(req("POST", { prediction: "p" }), ctx({ id: "0".repeat(32) }))).status).toBe(404);
    expect((await listPredictions(req("GET"), ctx({ id: "0".repeat(32) }))).status).toBe(404);
  });
});

const newBoard = async (body: unknown = {}) => {
  const res = await createBoard(new Request("http://test/api/boards", { method: "POST", body: JSON.stringify(body) }));
  return { res, id: ((await res.clone().json()) as { id: string }).id };
};
const boardCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const studentNote = { id: "n1", author: "student", kind: "note", text: "Does a heavier pendulum swing faster?", x: 0, y: 0, w: 320, h: 200 };

describe("/api/boards", () => {
  it("creates boards (empty or from a demo), saves the student's changes with a changelog, and reads them back", async () => {
    const { res, id } = await newBoard();
    expect(res.status).toBe(201);
    const ops = (body: unknown) => saveOps(new Request(`http://test/api/boards/${id}/ops`, { method: "POST", body: JSON.stringify(body) }), boardCtx(id));
    expect((await ops({ ops: [{ type: "put", item: { ...studentNote, kind: "video" } }] })).status).toBe(400);
    const saved = (await (await ops({ ops: [{ type: "put", item: studentNote }], title: "Pendulums" })).json()) as {
      items: unknown[];
      title: string;
      version: number;
      log: Array<{ text: string }>;
    };
    expect(saved).toMatchObject({ items: [studentNote], title: "Pendulums", version: 1 });
    expect(saved.log.map((e) => e.text)).toEqual([
      'The student added note [n1]: "Does a heavier pendulum swing faster?".',
      'The student renamed the board to "Pendulums".',
    ]);
    // Polling: nothing new since version 1.
    expect((await getBoard(new Request(`http://test/api/boards/${id}?since=1`), boardCtx(id))).status).toBe(204);
    expect((await getBoard(new Request(`http://test/api/boards/${id}?since=0`), boardCtx(id))).status).toBe(200);
    expect((await getBoard(new Request("http://test/api/boards/000000000000"), boardCtx("000000000000"))).status).toBe(404);
    expect((await getBoard(new Request("http://test/api/boards/../x"), boardCtx("../x"))).status).toBe(404);

    const list = (await (await listBoards(new Request(`http://test/api/boards?ids=${id},nope`))).json()) as {
      boards: Array<{ id: string; title: string }>;
      demos: Array<{ slug: string }>;
    };
    expect(list.boards).toEqual([expect.objectContaining({ id, title: "Pendulums", itemCount: 1 })]);
    expect(list.demos.map((d) => d.slug).sort()).toEqual(["falling", "pendulum"]);

    const demo = await newBoard({ demo: "pendulum" });
    const copy = (await (await getBoard(new Request("http://test"), boardCtx(demo.id))).json()) as { title: string; items: Array<{ kind: string }> };
    expect(copy.title).toBe("Two Pendulums, Two Masses");
    expect(copy.items.map((i) => i.kind)).toEqual(["note", "sim"]);
    expect((await newBoard({ demo: "nope" })).res.status).toBe(404);
  });
});

describe("/api/boards/[id]/ask", () => {
  it("rejects bad messages and pictures", async () => {
    const { id } = await newBoard();
    const ask = (body: unknown) => askClaude(new Request("http://test", { method: "POST", body: JSON.stringify(body) }), boardCtx(id));
    expect((await ask({ message: "x".repeat(3000) })).status).toBe(413);
    expect((await ask({ image: "not base64!" })).status).toBe(400);
    expect((await askClaude(new Request("http://test", { method: "POST", body: "{}" }), boardCtx("000000000000"))).status).toBe(404);
  });

  it("runs the stand-in's tools on the stored board and streams the board after each change", async () => {
    vi.stubEnv("FAKE_MODEL", "1");
    const { id } = await newBoard();
    await saveOps(new Request("http://test", { method: "POST", body: JSON.stringify({ ops: [{ type: "put", item: studentNote }] }) }), boardCtx(id));
    const res = await askClaude(
      new Request("http://test", { method: "POST", body: JSON.stringify({ view: { x: 0, y: 0, w: 1200, h: 700 }, message: "", image: "iVBORw0KGgo=" }) }),
      boardCtx(id),
    );
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as { type: string; name?: string; ok?: boolean; board?: { items: unknown[] } });
    expect(lines.filter((l) => l.type === "tool").map((l) => [l.name, l.ok])).toEqual([["add_note", true], ["add_sim", true]]);
    expect(lines.filter((l) => l.type === "board").map((l) => l.board!.items.length)).toEqual([2, 3]);
    expect(lines.at(-1)!.type).toBe("done");
    const stored = (await (await getBoard(new Request("http://test"), boardCtx(id))).json()) as { log: Array<{ author: string }> };
    expect(stored.log.map((e) => e.author)).toEqual(["student", "claude", "claude"]);
  });
});

describe("/api/mcp", () => {
  const call = async (body: unknown) => {
    const res = await mcp(new Request("http://test/api/mcp", { method: "POST", body: JSON.stringify(body) }));
    return { status: res.status, json: res.status === 202 ? null : ((await res.json()) as Record<string, any>) }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const tool = (name: string, args: unknown, id = 9) => call({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

  it("speaks MCP: initialize, notifications, tools/list, unknown methods", async () => {
    const init = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect(init.json!.result).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "livesim-whiteboard" } });
    expect((await call({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const list = await call({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const tools = list.json!.result.tools as Array<{ name: string; inputSchema: { required: string[] } }>;
    expect(tools.map((t) => t.name)).toContain("set_sliders");
    expect(tools.find((t) => t.name === "add_note")!.inputSchema.required).toEqual(["board_id", "text"]);
    expect((await call({ jsonrpc: "2.0", id: 3, method: "nope" })).json!.error.code).toBe(-32601);
  });

  it("creates a board, changes it, and reads it and its changelog back", async () => {
    const created = (await tool("create_board", { title: "From MCP" })).json!.result.content[0].text as string;
    const id = /board ([0-9a-f]{12})/.exec(created)![1];
    expect(created).toContain(`http://test/b/${id}`);
    expect((await tool("add_note", { board_id: id, text: "Hello" })).json!.result.isError).toBe(false);
    expect((await tool("add_note", { board_id: id })).json!.result.isError).toBe(true);
    expect((await tool("get_board", { board_id: "nope" })).json!.result.isError).toBe(true);
    expect((await tool("get_board", { board_id: id })).json!.result.content[0].text).toContain('note by claude');
    expect((await tool("get_changelog", { board_id: id })).json!.result.content[0].text).toContain('Claude added note');
  });
});
