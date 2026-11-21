import { afterEach, describe, expect, it, vi } from "vitest";
import { EFFORT, MAX_TOKENS, MODEL, hasKey, llmConfig, useStandIn } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("config", () => {
  it("exposes the model constants", () => {
    expect(MODEL).toBe("claude-sonnet-5-5");
    expect(EFFORT).toBe("medium");
    expect(MAX_TOKENS).toBe(32000);
  });

  it("treats an unset or blank key as missing", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(hasKey()).toBe(false);
    vi.stubEnv("ANTHROPIC_API_KEY", "   \n");
    expect(hasKey()).toBe(false);
    expect(useStandIn()).toBe(true);
  });

  it("uses the real model only with a key and no FAKE_MODEL", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-not-a-real-key");
    vi.stubEnv("FAKE_MODEL", "");
    expect(hasKey()).toBe(true);
    expect(useStandIn()).toBe(false);
    vi.stubEnv("FAKE_MODEL", "1");
    expect(useStandIn()).toBe(true);
  });
});

describe("llmConfig", () => {
  const env = (e: Record<string, string>) => llmConfig(e);

  it("defaults to Anthropic and reads ANTHROPIC_API_KEY", () => {
    const c = env({ ANTHROPIC_API_KEY: "k" });
    expect(c.provider.id).toBe("anthropic");
    expect(c.apiKey).toBe("k");
    expect(c.model).toBe(MODEL);
    expect(c.problem).toBeNull();
  });

  it("picks the provider from whichever provider key is set", () => {
    expect(env({ GEMINI_API_KEY: "g" }).provider.id).toBe("gemini");
    expect(env({ OPENAI_API_KEY: "o" }).model).toBe("gpt-5");
  });

  it("takes LLM_API_KEY, LLM_MODEL and LLM_BASE_URL for any provider", () => {
    const c = env({ LLM_PROVIDER: "OpenRouter", LLM_API_KEY: "k", LLM_MODEL: "some/model" });
    expect(c.provider.id).toBe("openrouter");
    expect(c.baseURL).toBe("https://openrouter.ai/api/v1");
    expect(c.problem).toBeNull();
    expect(env({ LLM_PROVIDER: "ollama", LLM_MODEL: "llava", LLM_BASE_URL: "http://box:11434/v1" })).toMatchObject({
      baseURL: "http://box:11434/v1",
      problem: null,
    });
  });

  it("explains what is missing, without the key", () => {
    expect(env({ LLM_PROVIDER: "openai" }).problem).toMatch(/No API key for OpenAI/);
    expect(env({ LLM_PROVIDER: "groq", LLM_API_KEY: "secret" }).problem).toMatch(/LLM_MODEL/);
    expect(env({ LLM_PROVIDER: "openai-compatible", LLM_MODEL: "m" }).problem).toMatch(/LLM_BASE_URL/);
    expect(env({ LLM_PROVIDER: "nope", LLM_API_KEY: "secret" }).problem).toMatch(/Unknown LLM_PROVIDER/);
    expect(JSON.stringify(env({ LLM_PROVIDER: "groq", LLM_API_KEY: "secret" }).problem)).not.toContain("secret");
  });
});
