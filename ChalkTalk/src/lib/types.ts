// Shared types. Safe to import from both server and client code.
import type { Board, View } from "./board";

/** What the browser may know about the model (from /api/status or the page): never the key. */
export interface ModelStatus {
  standIn: boolean;
  /** The service, e.g. "OpenAI". */
  provider: string;
  /** Who the student asks, e.g. "Claude", "ChatGPT", "Gemini", or "AI". */
  assistant: string;
  /** The model id, when the real model is in use. */
  model: string | null;
  /** Why the stand-in is on, when the settings are the reason. */
  reason: string | null;
}

export type Stage = "thinking" | "writing";

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export type StreamEvent =
  | { type: "status"; stage: Stage }
  | { type: "delta"; text: string }
  | { type: "done"; stopReason: string | null; usage: Usage; ms: number }
  | { type: "error"; message: string };

export interface SimParam {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

export interface Homework {
  question: string;
  defaults: Record<string, number>;
}

export interface HomeworkInput {
  code: string;
  params: SimParam[];
  question: string;
  title?: string;
}

export interface SimModel {
  generate(prompt: string): AsyncIterable<StreamEvent>;
  repair(code: string, error: string): AsyncIterable<StreamEvent>;
  edit(code: string, request: string): AsyncIterable<StreamEvent>;
  homework(input: HomeworkInput): Promise<Homework>;
  boardTurn(input: BoardTurnInput): AsyncIterable<BoardEvent>;
}

/** One student's answer on a shared link: the prediction before Run, then what they saw. */
export interface Prediction {
  id: string;
  name: string;
  prediction: string;
  observed?: string;
  createdAt: string;
}

/** What the teacher's list gets: no id, so nobody can use it to overwrite a reflection. */
export type PublicPrediction = Omit<Prediction, "id">;

/** One "Ask Claude" on the whiteboard. */
export interface BoardTurnInput {
  board: Board;
  view: View | null;
  /** What the student typed next to "Ask Claude" (may be empty). */
  message: string;
  /** A PNG of the board, base64 without the data: prefix, so Claude can read handwriting. */
  image: string | null;
  /** Runs one board tool against the stored board and says how it went. */
  runTool(name: string, input: unknown): Promise<{ text: string; isError: boolean }>;
}

export type BoardEvent =
  | { type: "status"; stage: Stage }
  | { type: "tool"; name: string; ok: boolean; text: string }
  | { type: "board"; board: Board }
  | { type: "done"; usage: Usage; ms: number }
  | { type: "error"; message: string };

export interface SimRecord {
  id: string;
  prompt: string;
  code: string;
  title: string;
  params: SimParam[];
  question: string;
  homework?: Homework;
  shareToken?: string; // Absent on simulations saved before class links were introduced.
  predictions?: Prediction[];
  createdAt: string;
}

/** Messages the bridge inside the iframe posts to the parent. */
export type BridgeMessage =
  | { type: "ready"; title: unknown; params: unknown; question: unknown }
  | { type: "applied"; values: Record<string, number> }
  | { type: "error"; message: string; line?: number; col?: number };

export type SessionState =
  | "idle"
  | "streaming"
  | "mounting"
  | "repairing"
  | "ready"
  | "failed";
