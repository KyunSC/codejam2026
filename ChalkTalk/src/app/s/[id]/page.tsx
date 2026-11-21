import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StudentApp } from "@/components/StudentApp";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Homework · Live Sim" };

export default async function StudentPage(props: PageProps<"/s/[id]">) {
  const { id } = await props.params;
  const shared = /^[0-9a-f]{32}$/.test(id);
  if (!shared && !/^[0-9a-f]{12}$/.test(id)) notFound();
  const sim = shared ? await store().getSharedSim(id) : await store().getSim(id);
  if (!sim) notFound();
  // Opened before "Share" made the homework: fall back to the class question and defaults.
  const question = sim.homework?.question ?? sim.question;
  const initial = sim.homework?.defaults;
  return <StudentApp simId={shared ? id : null} code={sim.code} title={sim.title} question={question} initial={initial} />;
}
