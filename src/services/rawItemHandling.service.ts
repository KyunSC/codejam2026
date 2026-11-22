import { one, query, tx } from "@/lib/db";
import { assertCan, assertMember } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { User } from "@/lib/types";
import { HANDLEABLE, HANDLING_OUTCOMES, type HandlingOutcome } from "@/lib/handling";

// A raw item that holds no invoice (a statement, an inquiry, a missing attachment, marketing) or could not be read
// still needs someone to deal with it. The AP clerk records how: each handling is a new row in raw_item_handling, the
// latest one is the item's state, and the raw item itself is never changed. Every handling is audited with it.

export { HANDLEABLE, HANDLING_OUTCOMES, type HandlingOutcome } from "@/lib/handling";

export type HandlingRow = {
  handling_id: string;
  outcome: HandlingOutcome;
  note: string;
  handled_at: string;
  handled_by: string;
  handled_by_name: string;
  forwarded_to_user_id: string | null;
  forwarded_to_name: string | null;
};

export async function handleRawItem(
  user: User | null,
  organizationId: string,
  rawItemId: string,
  input: { outcome?: unknown; note?: unknown; forwardedTo?: unknown },
) {
  assertMember(user, organizationId);
  assertCan(user, "parsed.review");
  const outcome = String(input.outcome ?? "");
  if (!(outcome in HANDLING_OUTCOMES)) throw new ValidationError(`outcome is one of: ${Object.keys(HANDLING_OUTCOMES).join(", ")}`);
  const note = String(input.note ?? "").trim();
  if (note.length < 3) throw new ValidationError("Say what you did, in a sentence");
  const forwardedTo = outcome === "forwarded" ? String(input.forwardedTo ?? "") : null;

  return tx(async (c) => {
    const raw = await one<{ status: string }>(
      "SELECT status FROM raw_items WHERE raw_item_id=$1 AND organization_id=$2 FOR UPDATE",
      [rawItemId, organizationId],
      c,
    );
    if (!raw) throw new NotFoundError("No such raw item");
    if (!(HANDLEABLE as readonly string[]).includes(raw.status)) {
      throw new ValidationError("Only an item with no invoice in it, or one that could not be read, is handled this way");
    }
    if (outcome === "forwarded") {
      const to = await one<{ user_id: string }>(
        "SELECT user_id FROM users WHERE user_id=$1 AND organization_id=$2 AND status <> 'terminated'",
        [forwardedTo, organizationId],
        c,
      );
      if (!to) throw new ValidationError("Forward it to a current member of the organization");
    }
    const row = await one<{ handling_id: string }>(
      `INSERT INTO raw_item_handling (organization_id, raw_item_id, outcome, forwarded_to_user_id, note, handled_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING handling_id`,
      [organizationId, rawItemId, outcome, forwardedTo, note, user.user_id],
      c,
    );
    await writeAudit(c, {
      organizationId,
      actor: user,
      action: "raw_item.handle",
      entityType: "raw_item",
      entityId: rawItemId,
      after: { outcome, forwarded_to_user_id: forwardedTo },
      note,
    });
    return row!.handling_id;
  });
}

// What was done with a raw item, oldest first.
export async function handlingHistory(organizationId: string, rawItemId: string) {
  return query<HandlingRow>(
    `SELECT h.handling_id::text, h.outcome, h.note, h.handled_at, h.handled_by, u.full_name AS handled_by_name,
            h.forwarded_to_user_id, f.full_name AS forwarded_to_name
       FROM raw_item_handling h
       JOIN users u ON u.user_id=h.handled_by
       LEFT JOIN users f ON f.user_id=h.forwarded_to_user_id
      WHERE h.organization_id=$1 AND h.raw_item_id=$2
      ORDER BY h.handling_id`,
    [organizationId, rawItemId],
  );
}

// How many raw items still need handling, and how many wait on their sender. For the AP clerk's tabs and dashboard.
export async function attentionCounts(user: User | null, organizationId: string) {
  assertMember(user, organizationId);
  assertCan(user, "parsed.review");
  const r = await one<{ needs: number; waiting: number }>(
    `SELECT count(*) FILTER (WHERE h.outcome IS NULL)::int AS needs,
            count(*) FILTER (WHERE h.outcome = 'requested')::int AS waiting
       FROM raw_items r
       LEFT JOIN LATERAL (SELECT outcome FROM raw_item_handling WHERE raw_item_id=r.raw_item_id ORDER BY handling_id DESC LIMIT 1) h ON true
      WHERE r.organization_id=$1 AND r.status = ANY($2)`,
    [organizationId, HANDLEABLE],
  );
  return r ?? { needs: 0, waiting: 0 };
}
