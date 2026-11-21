import { NewBoard } from "@/components/NewBoard";

/**
 * Opening the app starts a fresh whiteboard. The board is made by a POST from the browser, not while
 * rendering this page, so crawlers, health checks and prefetches don't create boards.
 */
export default function Home() {
  return <NewBoard />;
}
