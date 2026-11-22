// Page sizes: the API returns 20 rows by default; a screen can ask for fewer.
export const API_PAGE_SIZE = 20;

export type Paging = { page?: number; size?: number };

export function window(p: Paging = {}) {
  const size = Math.min(500, Math.max(1, p.size ?? API_PAGE_SIZE));
  const page = Math.max(1, p.page ?? 1);
  return { limit: size, offset: (page - 1) * size };
}
