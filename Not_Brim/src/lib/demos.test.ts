import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkDemo, createDemoStore, slugify } from "./demos";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "demos-"));
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

describe("demos", () => {
  it("slugifies titles", () => {
    expect(slugify("Two Balls, Dropped Together!")).toBe("two-balls-dropped-together");
    expect(slugify("Résumé ✨")).toBe("resume");
    expect(slugify("!!!")).toBe("demo");
  });

  it("the committed placeholders are valid, hand-made and load", async () => {
    const store = createDemoStore(path.join(process.cwd(), "data", "demos"));
    const list = await store.listDemos();
    expect(list.map((d) => d.slug).sort()).toEqual(["falling", "pendulum"]);
    for (const d of list) expect(d.handMade).toBe(true);
    const p = await store.getDemo("pendulum");
    expect(p?.params).toHaveLength(4);
    expect(p?.code).toContain("hand-made fixture");
  });

  it("saves, lists and skips invalid files", async () => {
    const store = createDemoStore(dir);
    const base = (await createDemoStore(path.join(process.cwd(), "data", "demos")).getDemo("falling"))!;
    await store.saveDemo({ ...base, slug: "copy", handMade: undefined });
    await writeFile(path.join(dir, "broken.json"), "{ not json");
    await writeFile(path.join(dir, "evil.json"), JSON.stringify({ ...base, slug: "evil", code: base.code.replace("<head>", '<head><script src="https://x.example/a.js"></script>') }));
    expect((await store.listDemos()).map((d) => d.slug)).toEqual(["copy"]);
    expect(await store.getDemo("../etc/passwd")).toBeNull();
    expect(checkDemo({ ...base, params: [] }).ok).toBe(false);
  });
});
