import { redirect } from "next/navigation";
import { boardStore } from "@/lib/boards";

export const dynamic = "force-dynamic";

/** Opening the app starts a fresh whiteboard. */
export default async function Home() {
  const board = await boardStore().createBoard();
  redirect(`/b/${board.id}`);
}
