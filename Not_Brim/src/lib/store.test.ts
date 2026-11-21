import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore, newId, type NewSim } from "./store";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "sims-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const sim = (title: string): NewSim => ({
  prompt: "why?",
  code: "<html></html>",
  title,
  params: [{ id: "m", label: "Mass (kg)", min: 1, max: 5, step: 1, value: 2 }],
  question: "Which first?",
});

describe("store", () => {
  it("makes short unique ids", () => {
    const ids = new Set(Array.from({ length: 500 }, newId));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{12}$/);
  });

  it("returns empty for a missing file and saves, gets, lists and updates", async () => {
    const s = createStore(path.join(dir, "nested", "sims.json"));
    expect(await s.listSims()).toEqual([]);
    expect(await s.getSim("nope")).toBeNull();

    const a = await s.saveSim(sim("A"));
    expect(a.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(await s.getSim(a.id)).toEqual(a);

    const b = await s.saveSim(sim("B"));
    expect((await s.listSims()).map((x) => x.title).sort()).toEqual(["A", "B"]);
    expect(await s.listSims()).not.toHaveProperty("0.code");

    const hw = { question: "Now?", defaults: { m: 3 } };
    const updated = await s.updateSim(b.id, { homework: hw });
    expect(updated?.homework).toEqual(hw);
    expect(updated?.id).toBe(b.id);
    expect(await s.updateSim("missing", { title: "x" })).toBeNull();

    // Persisted as JSON on disk, with no tmp files left behind.
    const onDisk = JSON.parse(await readFile(path.join(dir, "nested", "sims.json"), "utf8"));
    expect(onDisk).toHaveLength(2);
    expect((await readdir(path.join(dir, "nested"))).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("serialises concurrent writes without losing records", async () => {
    const s = createStore(path.join(dir, "sims.json"));
    await Promise.all(Array.from({ length: 20 }, (_, i) => s.saveSim(sim(`S${i}`))));
    expect(await s.listSims()).toHaveLength(20);
  });
});
