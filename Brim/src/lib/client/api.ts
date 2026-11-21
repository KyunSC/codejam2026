/**
 * Browser-side calls to our API. Throws an Error with the server's message on failure, so a
 * form can show it as is.
 */
export async function send<T = unknown>(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: { ...headers } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { ...headers, "content-type": "application/json" };
  }
  const res = await fetch(url, init);
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message ?? `Request failed (${res.status}).`);
  return data as T;
}
