import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BoardApp } from "@/components/BoardApp";
import { BOARD_ID, boardStore } from "@/lib/boards";
import { modelStatus } from "@/lib/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Whiteboard · Live Sim" };

export default async function BoardPage(props: PageProps<"/b/[id]">) {
  const { id } = await props.params;
  if (!BOARD_ID.test(id)) notFound();
  const board = await boardStore().getBoard(id);
  if (!board) notFound();
  return <BoardApp board={board} status={modelStatus()} />;
}
