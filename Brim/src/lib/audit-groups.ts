/**
 * Groups audit rows into actions for the audit log: rows that share an `actionGroupId` were written
 * by one action (one transaction) and show as one entry. The row written first is the headline
 * (e.g. "added the user" when an account request is approved); the rest are its parts, in the order
 * they were written. An entry sits in the log where its action finished (its newest row).
 */

interface GroupableRow {
  seq: bigint;
  actionGroupId: string | null;
}

export interface ActionEntry<R> {
  head: R;
  parts: R[];
}

const bySeq = (a: { seq: bigint }, b: { seq: bigint }) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0);

/**
 * `page`: one page of the log, newest first. `groupRows`: every row of the groups on that page,
 * including rows that fell outside the page or the filters. `beforeSeq`: the page's cursor; a group
 * whose newest row is at or above it was already shown on a newer page and is left out.
 */
export function groupIntoActions<R extends GroupableRow>(page: readonly R[], groupRows: readonly R[], beforeSeq?: bigint): ActionEntry<R>[] {
  const members = new Map<string, R[]>();
  for (const r of [...page, ...groupRows]) {
    if (!r.actionGroupId) continue;
    const list = members.get(r.actionGroupId) ?? [];
    if (!list.some((x) => x.seq === r.seq)) list.push(r);
    members.set(r.actionGroupId, list);
  }

  const placed: { entry: ActionEntry<R>; at: bigint }[] = [];
  const seen = new Set<string>();
  for (const r of page) {
    if (!r.actionGroupId) {
      placed.push({ entry: { head: r, parts: [] }, at: r.seq });
      continue;
    }
    if (seen.has(r.actionGroupId)) continue;
    seen.add(r.actionGroupId);
    const rows = [...members.get(r.actionGroupId)!].sort(bySeq);
    const newest = rows[rows.length - 1].seq;
    if (beforeSeq !== undefined && newest >= beforeSeq) continue;
    const [head, ...parts] = rows;
    placed.push({ entry: { head, parts }, at: newest });
  }
  return placed.sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0)).map((p) => p.entry);
}
