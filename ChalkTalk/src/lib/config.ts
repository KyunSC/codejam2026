import "server-only";
import type { ModelStatus } from "./types";

/** The Anthropic model used when LLM_MODEL is not set. */
export const MODEL = "claude-sonnet-5-5";
/** Effort for short replies (homework answers, whiteboard tool turns), where speed matters most. */
export const CHAT_EFFORT = "low" as const;
/** Effort for simulation generation, where a broken sim costs more than a few seconds. */
export const SIM_EFFORT = "medium" as const;
export const MAX_TOKENS = 32000;

export type ProviderId = "anthropic" | "openai" | "gemini" | "openrouter" | "groq" | "ollama" | "openai-compatible";

export interface ProviderInfo {
  id: ProviderId;
  /** The service, as the UI names it ("OpenAI"). */
  label: string;
  /** What the student talks to ("Ask ChatGPT"). */
  assistant: string;
  /** The provider's own key variable, read when LLM_API_KEY is blank. */
  keyEnv: string | null;
  /** False for local servers that take any key. */
  needsKey: boolean;
  /** OpenAI-compatible endpoint (unused for Anthropic, which has its own client). */
  baseURL: string | null;
  /** Used when LLM_MODEL is blank. null means LLM_MODEL is required. */
  defaultModel: string | null;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    assistant: "Claude",
    keyEnv: "ANTHROPIC_API_KEY",
    needsKey: true,
    baseURL: null,
    defaultModel: MODEL,
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    assistant: "ChatGPT",
    keyEnv: "OPENAI_API_KEY",
    needsKey: true,
    baseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-5",
  },
  gemini: {
    id: "gemini",
    label: "Google",
    assistant: "Gemini",
    keyEnv: "GEMINI_API_KEY",
    needsKey: true,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    assistant: "AI",
    keyEnv: "OPENROUTER_API_KEY",
    needsKey: true,
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: null,
  },
  groq: {
    id: "groq",
    label: "Groq",
    assistant: "AI",
    keyEnv: "GROQ_API_KEY",
    needsKey: true,
    baseURL: "https://api.groq.com/openai/v1",
    defaultModel: null,
  },
  ollama: {
    id: "ollama",
    label: "Ollama",
    assistant: "AI",
    keyEnv: null,
    needsKey: false,
    baseURL: "http://localhost:11434/v1",
    defaultModel: null,
  },
  "openai-compatible": {
    id: "openai-compatible",
    label: "OpenAI-compatible",
    assistant: "AI",
    keyEnv: null,
    needsKey: false,
    baseURL: null,
    defaultModel: null,
  },
};

const isProvider = (v: string): v is ProviderId => Object.hasOwn(PROVIDERS, v);

/** Provider order when LLM_PROVIDER is blank: the first one whose own key is set wins. */
const INFER_ORDER: ProviderId[] = ["anthropic", "openai", "gemini", "openrouter", "groq"];

export interface LlmConfig {
  provider: ProviderInfo;
  apiKey: string | null;
  model: string | null;
  baseURL: string | null;
  /** Why the real model can't run (missing key, unknown provider...), or null when it can. Never contains the key. */
  problem: string | null;
}

type Env = Record<string, string | undefined>;
const read = (env: Env, name: string | null) => (name ? env[name]?.trim() || null : null);

/** Reads the provider settings from the environment (.env.local). */
export function llmConfig(env: Env = process.env): LlmConfig {
  const named = read(env, "LLM_PROVIDER")?.toLowerCase() ?? null;
  if (named && !isProvider(named)) {
    return {
      provider: PROVIDERS.anthropic,
      apiKey: null,
      model: null,
      baseURL: null,
      problem: `Unknown LLM_PROVIDER "${named}". Use one of: ${Object.keys(PROVIDERS).join(", ")}.`,
    };
  }
  const id: ProviderId =
    (named as ProviderId | null) ?? INFER_ORDER.find((p) => read(env, PROVIDERS[p].keyEnv)) ?? "anthropic";
  const provider = PROVIDERS[id];
  const apiKey = read(env, "LLM_API_KEY") ?? read(env, provider.keyEnv);
  const model = read(env, "LLM_MODEL") ?? provider.defaultModel;
  const baseURL = read(env, "LLM_BASE_URL") ?? provider.baseURL;

  let problem: string | null = null;
  if (provider.needsKey && !apiKey) {
    problem = `No API key for ${provider.label}. Set LLM_API_KEY${provider.keyEnv ? ` or ${provider.keyEnv}` : ""}.`;
  } else if (!model) {
    problem = `Set LLM_MODEL to the ${provider.label} model to use.`;
  } else if (id !== "anthropic" && !baseURL) {
    problem = `Set LLM_BASE_URL to the ${provider.label} endpoint (ending in /v1).`;
  }
  return { provider, apiKey, model, baseURL, problem };
}

/** True when the configured provider has everything it needs (a key, a model). Never exposes the key. */
export function hasKey(): boolean {
  return llmConfig().problem === null;
}

export function useStandIn(): boolean {
  return !hasKey() || process.env.FAKE_MODEL === "1";
}

export function modelStatus(): ModelStatus {
  const c = llmConfig();
  const fake = process.env.FAKE_MODEL === "1";
  return {
    standIn: c.problem !== null || fake,
    provider: c.provider.label,
    assistant: c.provider.assistant,
    model: c.problem ? null : c.model,
    reason: c.problem ?? (fake ? "FAKE_MODEL=1 is set." : null),
  };
}
