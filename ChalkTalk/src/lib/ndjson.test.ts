import { describe, expect, it } from "vitest";
import { encodeLine, eventsToStream, ndjsonResponse, readNdjson } from "./ndjson";
import type { StreamEvent } from "./types";

async function* events(): AsyncGenerator<StreamEvent> {
  yield { type: "status", stage: "thinking" };
  yield { type: "delta", text: "line1\nline2 \"quoted\"" };
  yield { type: "done", stopReason: "end_turn", usage: { input_tokens: 1, output_tokens: 2 }, ms: 5 };
}

function chunked(text: string, size: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + size));
      i += size;
    },
  });
}

async function all<T>(it: AsyncIterable<T>) {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe("ndjson", () => {
  it("encodes one object per line", () => {
    expect(encodeLine({ a: 1 })).toBe('{"a":1}\n');
  });

  it("round-trips events through a stream", async () => {
    const got = await all(readNdjson<StreamEvent>(eventsToStream(events())));
    expect(got).toEqual(await all(events()));
  });

  it("handles lines split across tiny chunks, multibyte text and a missing final newline", async () => {
    const text = encodeLine({ t: "é°θ" }) + encodeLine({ n: 2 }) + '{"last":true}';
    for (const size of [1, 3, 7]) {
      expect(await all(readNdjson(chunked(text, size)))).toEqual([{ t: "é°θ" }, { n: 2 }, { last: true }]);
    }
  });

  it("turns a thrown error into an error event", async () => {
    async function* bad(): AsyncGenerator<StreamEvent> {
      yield { type: "status", stage: "writing" };
      throw new Error("kaput");
    }
    expect(await all(readNdjson(eventsToStream(bad())))).toEqual([
      { type: "status", stage: "writing" },
      { type: "error", message: "kaput" },
    ]);
  });

  it("builds a response with the NDJSON content type", async () => {
    const res = ndjsonResponse(events());
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    expect((await res.text()).trim().split("\n")).toHaveLength(3);
  });
});
