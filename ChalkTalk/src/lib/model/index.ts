import "server-only";
// Aliased: the spec names it useStandIn, which the React hooks lint rule mistakes for a hook.
import { llmConfig, useStandIn as standInActive } from "../config";
import type { SimModel } from "../types";
import { OpenAICompatibleModel } from "./openai";
import { RealModel } from "./real";
import { StandInModel } from "./standin";

let standIn: StandInModel | null = null;
let real: { key: string; model: SimModel } | null = null;

/**
 * The stand-in when the provider isn't set up (or FAKE_MODEL=1). Otherwise Claude through the Anthropic SDK
 * for LLM_PROVIDER=anthropic, and the OpenAI-compatible client for every other provider.
 */
export function getModel(): SimModel {
  if (standInActive()) return (standIn ??= new StandInModel());
  const c = llmConfig();
  const key = `${c.provider.id}|${c.model}|${c.baseURL}|${c.apiKey}`;
  if (real?.key !== key) {
    real = { key, model: c.provider.id === "anthropic" ? new RealModel() : new OpenAICompatibleModel() };
  }
  return real.model;
}
