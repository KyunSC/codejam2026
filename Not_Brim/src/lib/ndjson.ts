// NDJSON: one JSON object per line. Used by the streaming routes and the client.
import type { BoardEvent, StreamEvent } from "./types";

export const NDJSON_TYPE = "application/x-ndjson";

export function encodeLine(value: unknown): string {
  return JSON.stringify(value) + "\n";
}

/** Turn model events into an NDJSON byte stream. A thrown error becomes a final `error` event. */
export function eventsToStream(events: AsyncIterable<StreamEvent | BoardEvent>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const it = events[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await it.next();
        if (next.done) controller.close();
        else controller.enqueue(enc.encode(encodeLine(next.value)));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Stream failed";
        controller.enqueue(enc.encode(encodeLine({ type: "error", message })));
        controller.close();
      }
    },
    async cancel() {
      await it.return?.();
    },
  });
}

export function ndjsonResponse(events: AsyncIterable<StreamEvent | BoardEvent>): Response {
  return new Response(eventsToStream(events), {
    headers: { "Content-Type": NDJSON_TYPE, "Cache-Control": "no-store" },
  });
}

/** Parse an NDJSON byte stream into objects, tolerating chunks that split lines. */
export async function* readNdjson<T = unknown>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) yield JSON.parse(line) as T;
      }
    }
    buf += dec.decode();
    if (buf.trim()) yield JSON.parse(buf.trim()) as T;
  } finally {
    reader.releaseLock();
  }
}
