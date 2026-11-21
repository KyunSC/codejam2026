import "server-only";

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateParams } from "./bridge";
import { assertFileStorageWritable, db, type Db } from "./db";
import { validateHtml } from "./sim-html";
import type { SimParam } from "./types";

export interface Demo {
  slug: string;
  prompt: string;
  code: string;
  title: string;
  params: SimParam[];
  question: string;
  handMade?: boolean;
  savedAt: string;
}

export type DemoSummary = Pick<Demo, "slug" | "title" | "prompt" | "handMade">;

const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** "Two Balls, Dropped!" → "two-balls-dropped" */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/, "") || "demo"
  );
}

/** Check a demo read from disk or sent by the browser. */
export function checkDemo(raw: unknown): { ok: true; demo: Demo } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not an object" };
  const d = raw as Record<string, unknown>;
  if (typeof d.slug !== "string" || !SLUG.test(d.slug)) return { ok: false, reason: "bad slug" };
  for (const k of ["prompt", "code", "title", "question"] as const)
    if (typeof d[k] !== "string") return { ok: false, reason: `missing ${k}` };
  const html = validateHtml(d.code as string);
  if (!html.ok) return { ok: false, reason: html.reason };
  const params = validateParams(d.params);
  if (!params.ok) return { ok: false, reason: params.reason };
  return {
    ok: true,
    demo: {
      slug: d.slug,
      prompt: d.prompt as string,
      code: d.code as string,
      title: d.title as string,
      params: params.params,
      question: d.question as string,
      handMade: d.handMade === true ? true : undefined,
      savedAt: typeof d.savedAt === "string" ? d.savedAt : new Date(0).toISOString(),
    },
  };
}

/**
 * Demos ship as one JSON file each in a committed folder (data/demos/<slug>.json). Demos saved from the
 * app go to Postgres when there is a database (the deployed filesystem is read-only), else to that folder.
 * A saved demo with the same slug as a shipped one takes its place.
 */
export function createDemoStore(dir: string, database: Db | null = null) {
  async function fromFile(slug: string): Promise<Demo | null> {
    try {
      const checked = checkDemo(JSON.parse(await readFile(path.join(dir, `${slug}.json`), "utf8")));
      return checked.ok && checked.demo.slug === slug ? checked.demo : null;
    } catch {
      return null;
    }
  }
  async function fromDb(slug: string): Promise<Demo | null> {
    if (!database) return null;
    await database.ready;
    const { rows } = await database.pool.query<{ demo: unknown }>("SELECT demo FROM livesim_demos WHERE slug = $1", [slug]);
    const checked = rows[0] ? checkDemo(rows[0].demo) : null;
    return checked?.ok ? checked.demo : null;
  }
  async function getDemo(slug: string): Promise<Demo | null> {
    if (!SLUG.test(slug)) return null;
    return (await fromDb(slug)) ?? (await fromFile(slug));
  }
  return {
    getDemo,
    async listDemos(): Promise<DemoSummary[]> {
      let files: string[] = [];
      try {
        files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
      } catch {
        files = [];
      }
      const found = new Map<string, Demo>();
      for (const d of await Promise.all(files.map((f) => fromFile(f.slice(0, -5))))) if (d) found.set(d.slug, d);
      if (database) {
        await database.ready;
        const { rows } = await database.pool.query<{ demo: unknown }>("SELECT demo FROM livesim_demos");
        for (const r of rows) {
          const checked = checkDemo(r.demo);
          if (checked.ok) found.set(checked.demo.slug, checked.demo);
        }
      }
      return [...found.values()]
        .map(({ slug, title, prompt, handMade }) => ({ slug, title, prompt, handMade }))
        .sort((a, b) => a.title.localeCompare(b.title));
    },
    async saveDemo(demo: Demo): Promise<void> {
      if (database) {
        await database.ready;
        await database.pool.query(
          "INSERT INTO livesim_demos (slug, demo) VALUES ($1, $2::jsonb) ON CONFLICT (slug) DO UPDATE SET demo = EXCLUDED.demo",
          [demo.slug, JSON.stringify(demo)],
        );
        return;
      }
      assertFileStorageWritable();
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${demo.slug}.json`);
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, JSON.stringify(demo, null, 2) + "\n");
      await rename(tmp, file);
    },
  };
}

let defaultDemos: ReturnType<typeof createDemoStore> | null = null;

export function demos() {
  defaultDemos ??= createDemoStore(path.join(process.cwd(), "data", "demos"), db());
  return defaultDemos;
}
