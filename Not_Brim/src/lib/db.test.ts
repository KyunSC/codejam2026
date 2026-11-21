// The Postgres stores. They need a real database, so they run only when TEST_DATABASE_URL is set,
// e.g. TEST_DATABASE_URL=postgres://localhost:5432/livesim_test npm test
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteItem } from "./board";
import { createPgBoardStore, EMPTY_BOARD_TTL_MS } from "./boards";
import { assertFileStorageWritable, createDb, StorageNotConfiguredError, storageErrorResponse, type Db } from "./db";
import { createDemoStore, type Demo } from "./demos";
import { createPgStore, type NewSim } from "./store";

const url = process.env.TEST_DATABASE_URL;
const pendulum = readFileSync("fixtures/sims/pendulum.html", "utf8");
const params = [{ id: "massA", label: "Bob A mass (kg)", min: 0.5, max: 10, step: 0.5, value: 1 }];
const note: NoteItem = { id: "a1", author: "student", kind: "note", text: "Why?", x: 0, y: 0, w: 320, h: 200 };

describe("storage on a read-only deployment", () => {
  it("refuses file writes on Vercel with a message naming DATABASE_URL, as a 503", async () => {
    vi.stubEnv("VERCEL", "1");
    try {
      expect(() => assertFileStorageWritable()).toThrow(StorageNotConfiguredError);
      const res = storageErrorResponse(new StorageNotConfiguredError());
      expect(res.status).toBe(503);
      expect(((await res.json()) as { error: string }).error).toContain("DATABASE_URL");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe.skipIf(!url)("Postgres stores", () => {
  let database: Db;
  let dir: string;

  beforeAll(async () => {
    database = createDb(url!);
    await database.ready;
    dir = await mkdtemp(path.join(tmpdir(), "demos-"));
  });
  afterAll(async () => {
    await database?.pool.end();
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await database.pool.query("TRUNCATE livesim_boards, livesim_sims, livesim_demos");
  });

  it("creates, gets and saves boards, and drops empty boards left for a day", async () => {
    const s = createPgBoardStore(database);
    const b = await s.createBoard();
    expect(b.items).toEqual([]);
    expect((await s.saveItems(b.id, [note]))?.items).toEqual([note]);
    expect((await s.getBoard(b.id))?.items).toEqual([note]);
    expect(await s.saveItems("000000000000", [])).toBeNull();
    expect(await s.getBoard("000000000000")).toBeNull();

    const old = await s.createBoard();
    const stale = new Date(Date.now() - EMPTY_BOARD_TTL_MS - 60_000);
    await database.pool.query("UPDATE livesim_boards SET updated_at = $1 WHERE id = $2", [stale, old.id]);
    await database.pool.query("UPDATE livesim_boards SET updated_at = $1 WHERE id = $2", [stale, b.id]);
    await s.createBoard();
    expect(await s.getBoard(old.id)).toBeNull();
    expect(await s.getBoard(b.id)).not.toBeNull();
  });

  it("saves, gets, lists and updates sims; an update can't change the id or date", async () => {
    const s = createPgStore(database);
    const sim: NewSim = { prompt: "why?", code: pendulum, title: "A", params, question: "Which first?" };
    const a = await s.saveSim(sim);
    const b = await s.saveSim({ ...sim, title: "B" });
    expect(await s.getSim(a.id)).toEqual(a);
    expect((await s.listSims()).map((x) => x.title).sort()).toEqual(["A", "B"]);
    const homework = { question: "Now?", defaults: { massA: 2 } };
    const patch = { homework, id: "ffffffffffff", createdAt: "1999" } as unknown as Partial<NewSim>;
    expect(await s.updateSim(b.id, patch)).toEqual({ ...b, homework });
    expect(await s.updateSim("000000000000", { title: "x" })).toBeNull();
  });

  it("finds a sim by its share token and keeps every prediction when students post at once", async () => {
    const s = createPgStore(database);
    const sim = await s.saveSim({ prompt: "why?", code: pendulum, title: "A", params, question: "Which first?" });
    expect((await s.getSharedSim(sim.shareToken!))?.id).toBe(sim.id);
    expect(await s.getSharedSim("0".repeat(32))).toBeNull();

    const posted = await Promise.all(
      Array.from({ length: 12 }, (_, i) => s.addPrediction(sim.shareToken!, { name: `S${i}`, prediction: `guess ${i}` })),
    );
    expect((await s.getSim(sim.id))?.predictions).toHaveLength(12);

    const first = posted[0] as { id: string };
    expect(await s.addPrediction(sim.shareToken!, { submissionId: first.id, name: "S0", prediction: "again" })).toMatchObject({ id: first.id });
    expect((await s.getSim(sim.id))?.predictions).toHaveLength(12);
    expect(await s.setObserved(sim.shareToken!, first.id, "Both together")).toMatchObject({ observed: "Both together" });
    expect(await s.setObserved(sim.shareToken!, "nope", "x")).toBeNull();
    expect(await s.addPrediction("0".repeat(32), { name: "x", prediction: "y" })).toBeNull();
  });

  it("serves shipped demos, lets a saved one replace a shipped one, and saves into the database", async () => {
    const shipped = createDemoStore(path.join(process.cwd(), "data", "demos"), database);
    const before = await shipped.listDemos();
    expect(before.map((d) => d.slug)).toContain("pendulum");

    const original = (await shipped.getDemo("pendulum"))!;
    const mine: Demo = { ...original, title: "My pendulum", handMade: undefined, savedAt: new Date().toISOString() };
    await shipped.saveDemo(mine);
    expect((await shipped.getDemo("pendulum"))?.title).toBe("My pendulum");
    expect((await shipped.listDemos()).filter((d) => d.slug === "pendulum")).toEqual([
      { slug: "pendulum", title: "My pendulum", prompt: mine.prompt, handMade: undefined },
    ]);

    // With a database, saving never writes into the demos folder.
    await createDemoStore(dir, database).saveDemo({ ...mine, slug: "elsewhere" });
    expect(await readdir(dir)).toEqual([]);
  });
});
