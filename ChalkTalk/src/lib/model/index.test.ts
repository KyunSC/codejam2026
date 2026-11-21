import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getModel } from "./index";
import { RealModel } from "./real";
import { StandInModel } from "./standin";
import { OpenAICompatibleModel } from "./openai";

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  for (const k of ["LLM_PROVIDER", "LLM_API_KEY", "LLM_MODEL", "LLM_BASE_URL", "OPENAI_API_KEY", "GEMINI_API_KEY"]) vi.stubEnv(k, "");
});

describe("getModel", () => {
  it("uses the stand-in with no key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "  ");
    expect(getModel()).toBeInstanceOf(StandInModel);
  });

  it("uses the stand-in when FAKE_MODEL=1 even with a key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-not-a-real-key");
    vi.stubEnv("FAKE_MODEL", "1");
    expect(getModel()).toBeInstanceOf(StandInModel);
  });

  it("selects the real model with a key (constructed, never called)", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-not-a-real-key");
    vi.stubEnv("FAKE_MODEL", "");
    expect(getModel()).toBeInstanceOf(RealModel);
  });

  it("selects the OpenAI-compatible client for any other provider", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("LLM_PROVIDER", "gemini");
    vi.stubEnv("LLM_API_KEY", "test-not-a-real-key");
    vi.stubEnv("FAKE_MODEL", "");
    expect(getModel()).toBeInstanceOf(OpenAICompatibleModel);
  });
});
