/**
 * The payments dashboard (BUILD_PLAN Payments → Dashboard): payments by bucket with the amount by
 * currency, and for each row who may release it (or why nobody can) and what blocks it. Read-only.
 */
import Decimal from "decimal.js";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { releaseEligibility } from "@/lib/rules/routing/route";
import { addDays, today } from "@/lib/today";
import { paymentBlockers } from "./payments";
import { loadLiveRefs } from "./refs";

export const BUCKETS = ["ready", "overdue", "due_this_week", "scheduled", "awaiting_release", "sent", "failed"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const BUCKET_LABEL: Record<Bucket, string> = {
  ready: "Approved, ready to prepare",
  overdue: "Overdue",
  due_this_week: "Due this week",
  scheduled: "Scheduled later",
  awaiting_release: "Awaiting release",
  sent: "Sent, not cleared",
  failed: "Failed",
};

export interface DashboardRow {
  kind: "invoice" | "payment";
  paymentId: string | null;
  invoiceId: string;
  vendorId: string | null;
  vendorName: string | null;
  method: string | null;
  date: string | null;
  currency: string;
  amount: string;
  amountCad: string;
  status: string;
  buckets: Bucket[];
  releasers: string[];
  releaseBlocked: string | null;
  blockers: Array<{ code: string; message: string }>;
  failureReason: string | null;
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export async function paymentsDashboard(organizationId: string, bucket?: string | null) {
  const prisma = db();
  const now = today();
  const soon = addDays(now, config.payments.dueSoonDays);
  const [payments, ready, users] = await Promise.all([
    prisma.payment.findMany({
      where: { organizationId, status: { in: ["scheduled", "released", "sent", "failed"] } },
      include: { vendor: { select: { legalName: true } } },
      orderBy: [{ scheduledDate: "asc" }, { id: "asc" }],
    }),
    prisma.invoice.findMany({
      where: { organizationId, status: "approved", payments: { none: { status: { in: ["scheduled", "released", "sent", "settled"] } } } },
      include: { vendor: { select: { legalName: true } } },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    }),
    prisma.user.findMany({ where: { organizationId }, select: { id: true, externalId: true, fullName: true } }),
  ]);
  const refs = await loadLiveRefs(prisma, organizationId);
  const invoiceIds = [...payments.map((p) => p.invoiceId), ...ready.map((i) => i.id)];
  const steps = await prisma.approvalStep.findMany({ where: { organizationId, invoiceId: { in: invoiceIds }, decision: "approved" } });
  const stepsBy = new Map<string, typeof steps>();
  for (const s of steps) stepsBy.set(s.invoiceId, [...(stepsBy.get(s.invoiceId) ?? []), s]);
  const nameByPid = new Map(users.flatMap((u) => [[u.externalId ?? u.id, u.fullName], [u.id, u.fullName]] as const));

  const who = (invoiceId: string, amountCad: number) => {
    const s = (stepsBy.get(invoiceId) ?? []).map((x) => ({
      assignedToId: refs.people.toPerson(x.decidedById ?? x.assignedToId),
      onBehalfOfId: refs.people.toPerson(x.onBehalfOfId),
    }));
    const r = releaseEligibility(amountCad, s, refs.policyRules, refs);
    return { releasers: r.releaserIds.map((id) => nameByPid.get(id) ?? id), releaseBlocked: r.blockedReason };
  };

  const rows: DashboardRow[] = [];
  for (const inv of ready) {
    const blockers = await prisma.$transaction((tx) => paymentBlockers(tx, organizationId, inv.id, "prepare"));
    const due = iso(inv.dueDate);
    const amountCad = inv.totalCad?.toString() ?? inv.total?.toString() ?? "0";
    rows.push({
      kind: "invoice",
      paymentId: null,
      invoiceId: inv.id,
      vendorId: inv.vendorId,
      vendorName: inv.vendor?.legalName ?? inv.vendorName,
      method: null,
      date: due,
      currency: inv.currency ?? "CAD",
      amount: inv.total?.toString() ?? "0",
      amountCad,
      status: inv.status,
      buckets: ["ready", ...(due && due < now ? (["overdue"] as Bucket[]) : due && due <= soon ? (["due_this_week"] as Bucket[]) : [])],
      ...who(inv.id, Number(amountCad)),
      blockers,
      failureReason: null,
    });
  }
  for (const p of payments) {
    const date = iso(p.scheduledDate)!;
    const buckets: Bucket[] = [];
    if (p.status === "scheduled") {
      buckets.push("awaiting_release");
      buckets.push(date < now ? "overdue" : date <= soon ? "due_this_week" : "scheduled");
    } else if (p.status === "released") buckets.push(date < now ? "overdue" : "due_this_week");
    else if (p.status === "sent") buckets.push("sent");
    else if (p.status === "failed") buckets.push("failed");
    const blockers = p.status === "scheduled" ? await prisma.$transaction((tx) => paymentBlockers(tx, organizationId, p.invoiceId, "release")) : [];
    rows.push({
      kind: "payment",
      paymentId: p.id,
      invoiceId: p.invoiceId,
      vendorId: p.vendorId,
      vendorName: p.vendor.legalName,
      method: p.method,
      date,
      currency: p.currency,
      amount: p.amount.toString(),
      amountCad: p.amountCad.toString(),
      status: p.status,
      buckets,
      ...(p.status === "scheduled" ? who(p.invoiceId, Number(p.amountCad)) : { releasers: [], releaseBlocked: null }),
      blockers,
      failureReason: p.failureReason,
    });
  }

  const totals = Object.fromEntries(
    BUCKETS.map((b) => {
      const byCur: Record<string, string> = {};
      for (const r of rows.filter((x) => x.buckets.includes(b))) {
        byCur[r.currency] = new Decimal(byCur[r.currency] ?? 0).plus(r.amount).toFixed(2);
      }
      return [b, { count: rows.filter((x) => x.buckets.includes(b)).length, byCurrency: byCur }];
    }),
  ) as Record<Bucket, { count: number; byCurrency: Record<string, string> }>;

  const wanted = bucket && (BUCKETS as readonly string[]).includes(bucket) ? (bucket as Bucket) : null;
  // Rows that need attention first: held, then by date.
  const sorted = rows.sort((a, b) => Number(b.blockers.length > 0) - Number(a.blockers.length > 0) || (a.date ?? "").localeCompare(b.date ?? ""));
  return { today: now, totals, rows: wanted ? sorted.filter((r) => r.buckets.includes(wanted)) : sorted };
}
