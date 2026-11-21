import { NewBoard } from "@/components/NewBoard";

/** /new starts an empty whiteboard straight away (a POST from the browser, so prefetches don't make boards). */
export default function NewBoardPage() {
  return <NewBoard />;
}
