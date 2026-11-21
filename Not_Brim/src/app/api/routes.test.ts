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

import { POST as boardTurn } from "./board-turn/route";
import { POST as createBoard } from "./boards/route";
import { GET as getBoard, PUT as saveBoard } from "./boards/[id]/route";

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

describe("/api/board-turn", () => {
  const turn = (body: unknown) => boardTurn(new Request("http://test/api/board-turn", { method: "POST", body: JSON.stringify(body) }));
  const note = { id: "n1", author: "student", kind: "note", text: "Does a heavier pendulum swing faster?", x: 0, y: 0, w: 320, h: 200 };

  it("rejects bad boards, messages and pictures", async () => {
    expect((await turn({ items: "x" })).status).toBe(400);
    expect((await turn({ items: [{ ...note, author: "teacher" }] })).status).toBe(400);
    expect((await turn({ items: [], message: "x".repeat(3000) })).status).toBe(413);
    expect((await turn({ items: [], image: "not base64!" })).status).toBe(400);
  });

  it("streams Claude's actions from the stand-in", async () => {
    vi.stubEnv("FAKE_MODEL", "1");
    const res = await turn({ items: [note], view: { x: 0, y: 0, w: 1200, h: 700 }, message: "", image: "iVBORw0KGgo=" });
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as { type: string; action?: { type: string } });
    expect(lines.filter((l) => l.type === "action").map((l) => l.action!.type)).toEqual(["add_note", "add_sim"]);
    expect(lines.at(-1)!.type).toBe("done");
  });
});

describe("/api/boards", () => {
  it("creates a board, saves checked items and reads them back", async () => {
    const created = await createBoard();
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const ctx = { params: Promise.resolve({ id }) };
    const note = { id: "n1", author: "student", kind: "note", text: "hi", x: 0, y: 0, w: 320, h: 200 };
    const put = (body: unknown) => saveBoard(new Request(`http://test/api/boards/${id}`, { method: "PUT", body: JSON.stringify(body) }), ctx);
    expect((await put({ items: [{ ...note, kind: "video" }] })).status).toBe(400);
    expect((await put({ items: [note] })).status).toBe(200);
    const got = (await (await getBoard(new Request(`http://test/api/boards/${id}`), ctx)).json()) as { items: unknown[] };
    expect(got.items).toEqual([note]);
    const missing = { params: Promise.resolve({ id: "000000000000" }) };
    expect((await getBoard(new Request("http://test/api/boards/000000000000"), missing)).status).toBe(404);
    expect((await getBoard(new Request("http://test/api/boards/../x"), { params: Promise.resolve({ id: "../x" }) })).status).toBe(404);
  });
});
