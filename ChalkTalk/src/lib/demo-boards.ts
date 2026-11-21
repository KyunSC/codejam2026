import "server-only";

import { NOTE_SIZE, SIM_SIZE, type BoardItem } from "./board";
import { demos } from "./demos";

/** A ready-made board everyone gets on the boards page: one of the saved demos, set up with its question. */
export interface DemoBoard {
  slug: string;
  title: string;
  prompt: string;
}

export async function listDemoBoards(): Promise<DemoBoard[]> {
  return (await demos().listDemos()).map(({ slug, title, prompt }) => ({ slug, title, prompt }));
}

/** The items a copy of a demo board starts with: the student's question and the simulation answering it. */
export async function demoBoardItems(slug: string): Promise<{ title: string; items: BoardItem[] } | null> {
  const demo = await demos().getDemo(slug);
  if (!demo) return null;
  const note: BoardItem = { id: "demonote", author: "student", kind: "note", text: demo.prompt, x: 40, y: 40, ...NOTE_SIZE };
  const sim: BoardItem = {
    id: "demosim",
    author: "claude",
    kind: "sim",
    prompt: demo.prompt,
    code: demo.code,
    title: demo.title,
    question: demo.question,
    params: demo.params,
    values: Object.fromEntries(demo.params.map((p) => [p.id, p.value])),
    x: 40 + NOTE_SIZE.w + 40,
    y: 40,
    ...SIM_SIZE,
  };
  return { title: demo.title, items: [note, sim] };
}
