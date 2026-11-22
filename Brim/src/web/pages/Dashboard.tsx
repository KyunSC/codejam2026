import { Link } from "react-router-dom";
import { can } from "@/lib/authz";
import { money } from "@/lib/format";
import type { CardId, ResolvedItem, TileId } from "@/lib/preferences";
import type { User } from "@/lib/types";
import type { InvoiceRow, ParsedRow, WaitingApproval } from "@/services/read.service";
import { call, get, useLoad } from "../api";
import { org, useSession, useUser } from "../session";
import { usePreferences } from "../preferences";
import { useEditMode } from "../customize/EditMode";
import { SortableArea, SortableItem } from "../customize/Sortable";
import { HideButton } from "../customize/HideButton";
import { HiddenTray } from "../customize/HiddenTray";
import { reorder, setVisible } from "../customize/lists";
import { ApiForm, str } from "../components/ApiForm";
import { A, Badge, Card, Field, PageTitle, Show, Table, Td, btn, btnLight, input } from "../components/ui";

type Pending = { href: string; ref: string; vendor: string | null; number: string | null; total: number | null; currency: string; waiting_on: string | null; note: string | null };
type Tile = { id: TileId; label: string; value: number; href: string };
type Shown = { tiles: Set<TileId>; cards: Set<CardId> };

// The dashboard: counts for the user's role, what is pending approval, department spend, and the delegate form.
// The user picks which tiles and cards show and in what order (edit mode); hidden ones aren't fetched.
export function Dashboard() {
  const user = useUser();
  const { refresh } = useSession();
  const { editing } = useEditMode();
  const { prefs, update } = usePreferences();
  const { tiles: tilePrefs, cards: cardPrefs } = prefs.dashboard;
  const shown: Shown = {
    tiles: new Set(tilePrefs.filter((t) => t.visible).map((t) => t.id)),
    cards: new Set(cardPrefs.filter((c) => c.visible).map((c) => c.id)),
  };
  const shownKey = [...shown.tiles, "|", ...shown.cards].sort().join(",");
  const load = useLoad(() => loadDashboard(user, shown), `${user.status}:${shownKey}`);
  const setLeave = async (fd: FormData) => {
    if (fd.get("on_leave") === "1") await call("PUT", "/api/me/delegation", { delegate_user_id: str(fd, "delegate_user_id") });
    else await call("DELETE", "/api/me/delegation");
    await refresh();
  };

  return (
    <Show load={load}>
      {({ tiles, pending, spend, colleagues }) => {
        const months = [...new Set(spend.map((s) => s.month))];
        const depts = [...new Set(spend.map((s) => s.department))];
        const tileById = new Map(tiles.map((t) => [t.id, t]));
        const visibleTiles = tilePrefs.filter((t) => t.visible && tileById.has(t.id)).map((t) => tileById.get(t.id)!);

        const cardBody: Record<CardId, { title: React.ReactNode; body: React.ReactNode } | null> = {
          pending: {
            title: `Pending approval (${pending.length})`,
            body: (
              <Table head={["Item", "Vendor", "Total", "Waiting on"]} empty="Nothing is waiting for approval.">
                {pending.map((p) => (
                  <tr key={p.ref}>
                    <Td><A href={p.href}>{p.ref}</A>{p.note && <div className="muted text-xs">{p.note}</div>}</Td>
                    <Td>{p.vendor} {p.number}</Td>
                    <Td className="whitespace-nowrap">{money(p.total, p.currency)}</Td>
                    <Td>{p.waiting_on === "you" ? <Badge tone="gold">you</Badge> : p.waiting_on}</Td>
                  </tr>
                ))}
              </Table>
            ),
          },
          // shown only when there is spend to show, as before
          spend: spend.length > 0 ? {
            title: "Spend by department (CAD, last three months)",
            body: (
              <Table head={["Department", ...months]}>
                {depts.map((dname) => (
                  <tr key={dname}>
                    <Td>{dname}</Td>
                    {months.map((m) => <Td key={m}>{money(spend.find((s) => s.department === dname && s.month === m)?.total ?? 0)}</Td>)}
                  </tr>
                ))}
              </Table>
            ),
          } : null,
          delegate: can(user, "delegate.set") ? {
            title: "Away? Delegate your approvals",
            body: user.status === "on_leave" ? (
              <ApiForm submit={setLeave}>
                <p className="mb-2 text-sm">You are on leave; your approvals go to your delegate.</p>
                <input type="hidden" name="on_leave" value="0" />
                <button className={btnLight}>I&apos;m back</button>
              </ApiForm>
            ) : (
              <ApiForm submit={setLeave} className="flex items-end gap-2">
                <input type="hidden" name="on_leave" value="1" />
                <Field label="Delegate">
                  <select name="delegate_user_id" className={input} required>
                    <option value="">Choose…</option>
                    {colleagues.map((c) => <option key={c.user_id} value={c.user_id}>{c.full_name}</option>)}
                  </select>
                </Field>
                <button className={btn}>Go on leave</button>
              </ApiForm>
            ),
          } : null,
        };
        const visibleCards = cardPrefs.filter((c) => c.visible && cardBody[c.id]);
        const nothing = !visibleTiles.length && !visibleCards.length;

        return (
          <div className="space-y-6">
            <PageTitle sub={`${user.title ?? ""}`}>Good day, {user.full_name.split(" ")[0]}</PageTitle>
            {editing ? (
              <EditableDashboard
                tiles={visibleTiles}
                cards={visibleCards.map((c) => ({ ...c, ...cardBody[c.id]! }))}
                tilePrefs={tilePrefs}
                cardPrefs={cardPrefs}
                update={update}
              />
            ) : (
              <>
                {visibleTiles.length > 0 && (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {visibleTiles.map((t) => (
                      <Link key={t.id} to={t.href} className="card p-4">
                        <div className="heading num text-4xl leading-none">{t.value}</div>
                        <div className="label muted mt-2 text-xs">{t.label}</div>
                      </Link>
                    ))}
                  </div>
                )}
                {visibleCards.length > 0 && (
                  <div className="grid gap-6 lg:grid-cols-2">
                    {visibleCards.map((c) => <Card key={c.id} title={cardBody[c.id]!.title}>{cardBody[c.id]!.body}</Card>)}
                  </div>
                )}
                {nothing && <p className="card p-6 muted">Your dashboard is empty. Click Customize to bring tiles and cards back.</p>}
              </>
            )}
          </div>
        );
      }}
    </Show>
  );
}

// The same tiles and cards in edit mode: drag to reorder, × to hide, trays to bring hidden ones back.
function EditableDashboard({ tiles, cards, tilePrefs, cardPrefs, update }: {
  tiles: Tile[];
  cards: (ResolvedItem<CardId> & { title: React.ReactNode; body: React.ReactNode })[];
  tilePrefs: ResolvedItem<TileId>[];
  cardPrefs: ResolvedItem<CardId>[];
  update: ReturnType<typeof usePreferences>["update"];
}) {
  const tilePath = { kind: "tiles" } as const;
  const cardPath = { kind: "cards" } as const;
  const labels = (items: ResolvedItem[], what: string) => Object.fromEntries(items.map((i) => [i.id, `the ${i.label} ${what}`]));
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SortableArea ids={tiles.map((t) => t.id)} labels={labels(tilePrefs, "tile")} strategy="grid" onReorder={(ids) => update(reorder(tilePath, tilePrefs, ids))}>
          {tiles.map((t) => (
            <SortableItem key={t.id} id={t.id} className="dash-tile">
              {({ grip }) => (
                <>
                  <Link to={t.href} className="card block h-full p-4">
                    <div className="heading num text-4xl leading-none">{t.value}</div>
                    <div className="label muted mt-2 text-xs">{t.label}</div>
                  </Link>
                  <div className="dash-tools">
                    {grip}
                    <HideButton label={`the ${t.label} tile`} onHide={() => update(setVisible(tilePath, tilePrefs, t.id, false))} />
                  </div>
                </>
              )}
            </SortableItem>
          ))}
        </SortableArea>
      </div>
      <HiddenTray what="tiles" items={tilePrefs} onShow={(id) => update(setVisible(tilePath, tilePrefs, id, true))} />
      <div className="grid gap-6 lg:grid-cols-2">
        <SortableArea ids={cards.map((c) => c.id)} labels={labels(cardPrefs, "card")} strategy="grid" onReorder={(ids) => update(reorder(cardPath, cardPrefs, ids))}>
          {cards.map((c) => (
            <SortableItem key={c.id} id={c.id} handle className="dash-card">
              {({ grip, dragProps }) => (
                <Card
                  headerProps={dragProps}
                  title={<span className="inline-flex items-center gap-2">{grip}{c.title}</span>}
                  actions={<HideButton label={`the ${c.label} card`} onHide={() => update(setVisible(cardPath, cardPrefs, c.id, false))} />}
                >
                  {c.body}
                </Card>
              )}
            </SortableItem>
          ))}
        </SortableArea>
      </div>
      <HiddenTray what="cards" items={cardPrefs} onShow={(id) => update(setVisible(cardPath, cardPrefs, id, true))} />
    </>
  );
}

const APPROVER_ROLES = ["approver", "finance_manager", "controller_admin"];

// Each part from its own endpoint, asked only when the user's role shows it and the user hasn't hidden it.
export async function loadDashboard(user: User, shown: Shown) {
  const at = (path: string) => org(user, path);
  const count = (path: string) => get<{ total_count: number }[]>(at(path)).then((rows) => rows[0]?.total_count ?? 0);
  const when = <T,>(ok: boolean, f: () => Promise<T>, empty: T) => (ok ? f() : Promise.resolve(empty));
  const tile = (id: TileId) => shown.tiles.has(id);
  const pendingCard = shown.cards.has("pending");

  const [rawNew, parsed, waiting, approved, scheduled, vendorsPending, openChanges, othersPending, spend, users] = await Promise.all([
    when(can(user, "raw.extract") && tile("raw_new"), () => count("/raw-items?status=new&size=1"), 0),
    when((can(user, "raw.extract") && tile("parsed_review")) || (can(user, "parsed.review") && pendingCard), () => get<ParsedRow[]>(at("/parsed-invoices?size=100")), []),
    when(can(user, "approval.act") && (tile("my_approvals") || pendingCard), () => get<WaitingApproval[]>(at("/approvals?waiting_on=me")), []),
    when(can(user, "payment.prepare") && tile("approved_unscheduled"), () => count("/invoices?status=approved&type=invoice&size=1"), 0),
    when(can(user, "payment.release") && tile("to_release"), () => count("/payments?status=scheduled&size=1"), 0),
    when(can(user, "vendor.approve") && tile("vendors_pending"), () => get<unknown[]>(at("/vendors?status=pending_review")).then((r) => r.length), 0),
    when(can(user, "vendor.approve") && tile("bank_changes"), () => get<unknown[]>(at("/bank-changes?open=true")).then((r) => r.length), 0),
    when(!can(user, "approval.act") && !can(user, "parsed.review") && pendingCard, () => get<InvoiceRow[]>(at("/invoices?status=pending_approval&size=100")), []),
    when(shown.cards.has("spend"), () => get<{ department: string; month: string; total: number }[]>(at("/department-spend")), []),
    when(can(user, "delegate.set") && shown.cards.has("delegate"), () => get<User[]>(at("/users")), []),
  ]);

  const tiles: Tile[] = [];
  if (can(user, "raw.extract")) {
    tiles.push({ id: "raw_new", label: "Raw items to extract", value: rawNew, href: "/invoices" });
    tiles.push({ id: "parsed_review", label: "Parsed invoices to review", value: parsed[0]?.total_count ?? 0, href: "/invoices" });
  }
  if (can(user, "approval.act")) tiles.push({ id: "my_approvals", label: "Waiting for your approval", value: waiting.length, href: "/invoices" });
  if (can(user, "payment.prepare")) tiles.push({ id: "approved_unscheduled", label: "Approved, not yet scheduled", value: approved, href: "/invoices?status=approved" });
  if (can(user, "payment.release")) tiles.push({ id: "to_release", label: "Payments to release", value: scheduled, href: "/payments" });
  if (can(user, "vendor.approve")) {
    tiles.push({ id: "vendors_pending", label: "Vendors pending approval", value: vendorsPending, href: "/vendors" });
    tiles.push({ id: "bank_changes", label: "Bank changes pending", value: openChanges, href: "/vendors" });
  }

  // Invoice steps waiting on you (or someone you cover), parsed invoices for the clerk, otherwise the invoices you can see still being approved.
  const pending: Pending[] = pendingCard ? [
    ...waiting.map((a) => ({
      href: `/invoices/${a.invoice_id}`, ref: a.invoice_id, vendor: a.vendor_name, number: a.vendor_invoice_number, total: a.total, currency: a.currency,
      waiting_on: "you", note: a.on_behalf_of ? `on behalf of ${a.on_behalf_of}` : null,
    })),
    ...(can(user, "parsed.review") ? parsed : []).map((p) => ({
      href: `/invoices/${p.parsed_invoice_id}`, ref: p.parsed_invoice_id, vendor: p.vendor_name ?? p.invoice_json.vendor_name, number: p.invoice_json.vendor_invoice_number,
      total: p.invoice_json.total, currency: p.invoice_json.currency ?? "CAD", waiting_on: "you", note: "parsed, to approve into invoices",
    })),
    ...othersPending.map((i) => ({
      href: `/invoices/${i.invoice_id}`, ref: i.invoice_id, vendor: i.vendor_name, number: i.vendor_invoice_number, total: i.total, currency: i.currency,
      waiting_on: i.waiting_on, note: null,
    })),
  ] : [];
  const colleagues = users.filter((u) => u.status === "active" && u.user_id !== user.user_id && APPROVER_ROLES.includes(u.role));
  return { tiles, pending, spend, colleagues };
}
