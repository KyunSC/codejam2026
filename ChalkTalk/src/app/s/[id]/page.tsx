import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OpenSharedBoard } from "@/components/OpenSharedBoard";
import { StudentApp } from "@/components/StudentApp";
import { boardStore, SHARE_TOKEN } from "@/lib/boards";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Shared whiteboard · Live Sim" };

/**
 * A student link. A shared board's link opens the student's own copy of the board. Links shared from a
 * single simulation before boards were shared (homework with a prediction) still open that simulation.
 */
export default async function StudentPage(props: PageProps<"/s/[id]">) {
  const { id } = await props.params;
  if (SHARE_TOKEN.test(id)) {
    const board = await boardStore().getSharedBoard(id);
    if (board) return <OpenSharedBoard token={id} title={board.title} />;
  }
  const shared = /^[0-9a-f]{32}$/.test(id);
  if (!shared && !/^[0-9a-f]{12}$/.test(id)) notFound();
  const sim = shared ? await store().getSharedSim(id) : await store().getSim(id);
  if (!sim) notFound();
  // Opened before "Share" made the homework: fall back to the class question and defaults.
  const question = sim.homework?.question ?? sim.question;
  const initial = sim.homework?.defaults;
  return <StudentApp simId={shared ? id : null} code={sim.code} title={sim.title} question={question} initial={initial} />;
}
