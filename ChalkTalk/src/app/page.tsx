import type { Metadata } from "next";
import { BoardsHome } from "@/components/BoardsHome";
import { modelStatus } from "@/lib/config";

// Reads .env.local on every request, so the badge names the provider in use.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "My whiteboards · Live Sim" };

/** The boards page: your whiteboards (remembered by this browser) and the demo whiteboards. */
export default function Home() {
  return <BoardsHome status={modelStatus()} />;
}
