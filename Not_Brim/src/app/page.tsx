import { TeacherApp } from "@/components/TeacherApp";

import { store } from "@/lib/store";

export default async function Home(props: PageProps<"/">) {
  const token = (await props.searchParams).class;
  const sim = typeof token === "string" && /^[0-9a-f]{32}$/.test(token) ? await store().getSharedSim(token) : null;
  return <TeacherApp initialShared={sim && sim.shareToken ? { id: sim.shareToken, title: sim.title } : null} />;
}
