import { afterEach, describe, expect, it, vi } from "vitest";
import { getModel } from "./index";
import { RealModel } from "./real";
import { StandInModel } from "./standin";

afterEach(() => vi.unstubAllEnvs());

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
});
