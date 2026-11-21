import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import { FixtureHarness } from "@/components/FixtureHarness";

export const dynamic = "force-dynamic";

/** Dev-only: mounts a fixture straight into SimFrame (no validation) for bridge self-tests. */
export default async function FixturePage(props: PageProps<"/dev/fixture/[name]">) {
  if (process.env.NODE_ENV === "production") notFound();
  const { name } = await props.params;
  if (!/^[a-z0-9-]+$/.test(name)) notFound();
  let code: string;
  try {
    code = await readFile(path.join(process.cwd(), "fixtures", "sims", `${name}.html`), "utf8");
  } catch {
    notFound();
  }
  return <FixtureHarness name={name} code={code} />;
}
