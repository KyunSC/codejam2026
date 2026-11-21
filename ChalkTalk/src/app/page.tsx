import type { Metadata } from "next";
import { BoardsHome } from "@/components/BoardsHome";

export const metadata: Metadata = { title: "My whiteboards · Live Sim" };

/** The boards page: your whiteboards (remembered by this browser) and the demo whiteboards. */
export default function Home() {
  return <BoardsHome />;
}
