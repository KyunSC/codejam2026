import { useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// One call to the API. A FormData body is sent as multipart, anything else as JSON. Errors carry the API's message and status.
export async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const form = body instanceof FormData;
  const res = await fetch(path, {
    method,
    headers: body === undefined || form ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(data?.error ?? res.statusText, res.status);
  return data as T;
}

export const get = <T>(path: string) => call<T>("GET", path);
export const post = <T = unknown>(path: string, body?: unknown) => call<T>("POST", path, body ?? {});
export const patch = <T = unknown>(path: string, body: unknown) => call<T>("PATCH", path, body);
export const del = <T = unknown>(path: string) => call<T>("DELETE", path);

// Query string from the given values, leaving out empty ones.
export const qs = (v: Record<string, string | number | null | undefined>) => {
  const q = new URLSearchParams(Object.entries(v).filter(([, x]) => x !== null && x !== undefined && x !== "").map(([k, x]) => [k, String(x)]));
  return q.size ? `?${q}` : "";
};

export type Loaded<T> = { data?: T; error?: Error; reload: () => void };

// Data for a screen: loads when `key` changes and again on reload(). The previous data stays shown while the next arrives.
export function useLoad<T>(load: () => Promise<T>, key: string, { keepPrevious = true } = {}): Loaded<T> {
  const [state, setState] = useState<{ data?: T; error?: Error; key?: string }>({});
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    load().then(
      (data) => live && setState({ data, key }),
      (error) => live && setState({ error, key }),
    );
    return () => {
      live = false;
    };
    // `key` stands for everything `load` reads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, n]);
  const current = keepPrevious || state.key === key ? state : {};
  return { data: current.data, error: current.error, reload: () => setN((x) => x + 1) };
}
