import { afterEach, describe, expect, it, vi } from "vitest";
import { EFFORT, MAX_TOKENS, MODEL, hasKey, useStandIn } from "./config";

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
