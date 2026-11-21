// Shared types. Safe to import from both server and client code.

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
}

/** One student's answer on a shared link: the prediction before Run, then what they saw. */
export interface Prediction {
  id: string;
  name: string;
  prediction: string;
  observed?: string;
  createdAt: string;
}

export interface SimRecord {
  id: string;
  prompt: string;
  code: string;
  title: string;
  params: SimParam[];
  question: string;
  homework?: Homework;
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
