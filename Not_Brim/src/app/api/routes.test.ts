import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as generate } from "./generate/route";
import { POST as edit } from "./edit/route";
import { POST as repair } from "./repair/route";
import { GET as status } from "./status/route";

afterEach(() => vi.unstubAllEnvs());

const post = (body: unknown) =>
  new Request("http://test/api/generate", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

describe("/api/status", () => {
  it("reports stand-in mode without a key and never leaks the key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await (await status()).json()).toEqual({ standIn: true });
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-not-real");
    vi.stubEnv("FAKE_MODEL", "");
    const text = await (await status()).text();
    expect(text).toBe('{"standIn":false}');
  });
});

describe("/api/generate", () => {
  it("rejects bad bodies", async () => {
    expect((await generate(post("not json"))).status).toBe(400);
    expect((await generate(post({ prompt: "   " }))).status).toBe(400);
    expect((await generate(post({ prompt: "x".repeat(5000) }))).status).toBe(413);
  });

  it("streams NDJSON from the stand-in", async () => {
    vi.stubEnv("FAKE_MODEL", "1");
    const res = await generate(post({ prompt: "pendulum" }));
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(JSON.parse(first.split("\n")[0])).toEqual({ type: "status", stage: "thinking" });
    await reader.cancel();
  });
});

describe("/api/repair", () => {
  it("needs code and error, and streams from the stand-in", async () => {
    vi.stubEnv("FAKE_MODEL", "1");
    expect((await repair(post({ code: "<html></html>" }))).status).toBe(400);
    expect((await repair(post({ code: "x".repeat(200_000), error: "boom" }))).status).toBe(413);
    const res = await repair(post({ code: "<html></html>", error: "boom" }));
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(JSON.parse(first.split("\n")[0]).type).toBe("status");
    await reader.cancel();
  });
});

describe("/api/edit", () => {
  it("needs code and request, and streams from the stand-in", async () => {
    vi.stubEnv("FAKE_MODEL", "1");
    expect((await edit(post({ code: "<html></html>" }))).status).toBe(400);
    const res = await edit(post({ code: "<html></html>", request: "make it red" }));
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    await res.body!.cancel();
  });
});
