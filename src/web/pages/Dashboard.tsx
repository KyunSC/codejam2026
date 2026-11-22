import { Link, useSearchParams } from "react-router-dom";
import { can } from "@/lib/authz";
import { money } from "@/lib/format";
import { DASHBOARD_CARDS, DASHBOARD_TILES, allowedOn, type CardId, type ResolvedItem, type TileId } from "@/lib/preferences";
import type { BarRow, DueRow, WidgetData } from "@/services/dashboard.service";
import type { User } from "@/lib/types";
import type { InvoiceRow, WaitingApproval } from "@/services/read.service";
import { call, get, useLoad } from "../api";
import { org, useSession, useUser } from "../session";
import { usePreferences } from "../preferences";
import { CustomizeButton, EditBar, EditModeProvider, useEditMode } from "../customize/EditMode";
import { SortableArea, SortableItem } from "../customize/Sortable";
import { HideButton } from "../customize/HideButton";
import { HiddenTray } from "../customize/HiddenTray";
import { reorder, setVisible } from "../customize/lists";
import { ApiForm, str } from "../components/ApiForm";
import { A, Badge, Card, Field, PageTitle, Pager, Show, Status, Table, Td, btn, btnLight, date, input, pageOf, pageParam } from "../components/ui";
import { BarList, MonthBars } from "../components/Charts";

type Pending = { href: string; ref: string; vendor: string | null; number: string | null; total: number | null; currency: string; waiting_on: string | null; note: string | null };
type Tile = { id: TileId; label: string; value: number; href: string; amount?: boolean };
type Shown = { tiles: Set<TileId>; cards: Set<CardId> };

// The dashboard: counts for the user's role, what is pending approval, department spend, and the delegate form.
// The user picks which tiles and cards show and in what order (Customize); hidden ones aren't fetched.
export function Dashboard() {
  return (
    <EditModeProvider>
      <DashboardPage />
    </EditModeProvider>
  );
}

function DashboardPage() {
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
  const [sp] = useSearchParams();
  const page = pageParam(sp.get("page"));
  const setLeave = async (fd: FormData) => {
    if (fd.get("on_leave") === "1") await call("PUT", "/api/me/delegation", { delegate_user_id: str(fd, "delegate_user_id") });
    else await call("DELETE", "/api/me/delegation");
    await refresh();
  };

  return (
    <Show load={load}>
      {({ tiles, pending, spend, colleagues, widgets }) => {
        const months = [...new Set(spend.map((s) => s.month))];
        const depts = [...new Set(spend.map((s) => s.department))];
        const tileById = new Map(tiles.map((t) => [t.id, t]));
        const visibleTiles = tilePrefs.filter((t) => t.visible && tileById.has(t.id)).map((t) => tileById.get(t.id)!);

        const cardBody: Record<CardId, { title: React.ReactNode; body: React.ReactNode } | null> = {
          pending: {
            title: `Pending approval (${pending.length})`,
            body: (
              <>
                <Table head={["Item", "Vendor", "Total", "Waiting on"]} empty="Nothing is waiting for approval.">
                  {pageOf(pending, page).map((p) => (
                    <tr key={p.ref}>
                      <Td><A href={p.href}>{p.ref}</A>{p.note && <div className="muted text-xs">{p.note}</div>}</Td>
                      <Td>{p.vendor} {p.number}</Td>
                      <Td className="whitespace-nowrap">{money(p.total, p.currency)}</Td>
                      <Td>{p.waiting_on === "you" ? <Badge tone="gold">you</Badge> : p.waiting_on}</Td>
                    </tr>
                  ))}
                </Table>
                <Pager param="page" page={page} total={pending.length} />
              </>
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
          monthly_spend: widgets.monthly_spend ? {
            title: "Monthly spend (CAD, last 12 months)",
            body: <MonthBars rows={widgets.monthly_spend as BarRow[]} format={(n) => money(n)} />,
          } : null,
          vendor_spend: widgets.vendor_spend ? {
            title: "Top vendors (CAD, last three months)",
            body: <BarList rows={widgets.vendor_spend as BarRow[]} format={(n) => money(n)} empty="No spend in the last three months." />,
          } : null,
          account_spend: widgets.account_spend ? {
            title: "Spend by GL account (CAD, last three months)",
            body: <BarList rows={widgets.account_spend as BarRow[]} format={(n) => money(n)} empty="No spend in the last three months." />,
          } : null,
          invoice_status: widgets.invoice_status ? {
            title: "Invoices by status",
            body: <BarList rows={widgets.invoice_status as BarRow[]} format={(n) => String(n)} empty="No invoices." />,
          } : null,
          payment_methods: widgets.payment_methods ? {
            title: "Payments by method (CAD, last three months)",
            body: <BarList rows={widgets.payment_methods as BarRow[]} format={(n) => money(n)} empty="No payments in the last three months." />,
          } : null,
          upcoming_due: widgets.upcoming_due ? {
            title: `Due in the next 14 days (${(widgets.upcoming_due as DueRow[]).length})`,
            body: (
              <Table head={["Invoice", "Vendor", "Due", "Total", "Status"]} empty="Nothing unpaid is due in the next 14 days.">
                {(widgets.upcoming_due as DueRow[]).map((r) => (
                  <tr key={r.invoice_id}>
                    <Td><A href={`/invoices/${r.invoice_id}`}>{r.invoice_id}</A></Td>
                    <Td>{r.vendor}</Td>
                    <Td className="whitespace-nowrap">{date(r.due_date)}</Td>
                    <Td className="whitespace-nowrap">{money(r.total, r.currency)}</Td>
                    <Td><Status value={r.status} /></Td>
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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <PageTitle sub={`${user.title ?? ""}`}>Good day, {user.full_name.split(" ")[0]}</PageTitle>
              <CustomizeButton />
            </div>
            <EditBar />
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
                        <div className="heading num text-4xl leading-none">{t.amount ? money(t.value) : t.value}</div>
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
                  {/* while customizing, a tile is only something to move: not a link, so letting go of a drag opens nothing */}
                  <div className="card block h-full select-none p-4">
                    <div className="heading num text-4xl leading-none">{t.amount ? money(t.value) : t.value}</div>
                    <div className="label muted mt-2 text-xs">{t.label}</div>
                  </div>
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
                  {/* the card's links, buttons and forms don't respond while customizing */}
                  <div inert className="select-none">{c.body}</div>
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

  const [rawWork, toReview, waiting, approved, scheduled, vendorsPending, openChanges, othersPending, spend, users] = await Promise.all([
    when(can(user, "parsed.review") && (tile("raw_needs") || tile("raw_waiting")), () => get<{ reading: number; needs: number; waiting: number; todo: number }>(at("/raw-items/attention")), null),
    when(can(user, "parsed.review") && tile("to_review"), () => count("/parsed-invoices?size=1"), 0),
    when(can(user, "approval.act") && (tile("my_approvals") || pendingCard), () => get<WaitingApproval[]>(at("/approvals?waiting_on=me")), []),
    when(can(user, "payment.prepare") && tile("approved_unscheduled"), () => count("/invoices?status=approved&type=invoice&size=1"), 0),
    when(can(user, "payment.release") && tile("to_release"), () => count("/payments?status=scheduled&size=1"), 0),
    when(can(user, "vendor.approve") && tile("vendors_pending"), () => count("/vendors?status=pending_review&size=1"), 0),
    when(can(user, "vendor.approve") && tile("bank_changes"), () => get<unknown[]>(at("/bank-changes?open=true")).then((r) => r.length), 0),
    when(!can(user, "approval.act") && pendingCard, () => get<InvoiceRow[]>(at("/invoices?status=pending_approval&size=100")), []),
    when(shown.cards.has("spend"), () => get<{ department: string; month: string; total: number }[]>(at("/department-spend")), []),
    when(can(user, "delegate.set") && shown.cards.has("delegate"), () => get<User[]>(at("/user-choices")), []),
  ]);

  const tiles: Tile[] = [];
  // the AP clerk's queue: invoices to check and approve, emails and uploads nobody has dealt with, and requests still out
  if (can(user, "parsed.review")) {
    tiles.push({ id: "to_review", label: "Invoices to review", value: toReview, href: "/invoices#parsed" });
    tiles.push({ id: "raw_needs", label: "Emails needing attention", value: rawWork?.needs ?? 0, href: "/invoices?raw=needs#raw" });
    tiles.push({ id: "raw_waiting", label: "Waiting on a sender", value: rawWork?.waiting ?? 0, href: "/invoices?raw=waiting#raw" });
  }
  if (can(user, "approval.act")) tiles.push({ id: "my_approvals", label: "Waiting for your approval", value: waiting.length, href: "/invoices#invoices" });
  if (can(user, "payment.prepare")) tiles.push({ id: "approved_unscheduled", label: "Approved, not yet scheduled", value: approved, href: "/payments#ready" });
  if (can(user, "payment.release")) tiles.push({ id: "to_release", label: "Payments to release", value: scheduled, href: "/payments?status=scheduled#payments" });
  if (can(user, "vendor.approve")) {
    tiles.push({ id: "vendors_pending", label: "Vendors pending approval", value: vendorsPending, href: "/vendors?status=pending_review" });
    tiles.push({ id: "bank_changes", label: "Bank changes pending", value: openChanges, href: "/vendors" });
  }

  // Invoice steps waiting on you (or someone you cover); for those who approve nothing, the invoices they can see still being approved.
  const pending: Pending[] = pendingCard ? [
    ...waiting.map((a) => ({
      href: `/invoices/${a.invoice_id}`, ref: a.invoice_id, vendor: a.vendor_name, number: a.vendor_invoice_number, total: a.total, currency: a.currency,
      waiting_on: "you", note: a.on_behalf_of ? `on behalf of ${a.on_behalf_of}` : null,
    })),
    ...othersPending.map((i) => ({
      href: `/invoices/${i.invoice_id}`, ref: i.invoice_id, vendor: i.vendor_name, number: i.vendor_invoice_number, total: i.total, currency: i.currency,
      waiting_on: i.waiting_on, note: null,
    })),
  ] : [];
  // the widgets added from the palette: one request for those on the page
  const added = [...DASHBOARD_TILES, ...DASHBOARD_CARDS].filter((d) => d.byDefault === false && allowedOn(d, user) && (shown.tiles.has(d.id as TileId) || shown.cards.has(d.id as CardId)));
  const widgets: WidgetData = added.length ? await get<WidgetData>(at(`/dashboard-widgets?ids=${added.map((d) => d.id).join(",")}`)) : {};
  const n = (id: keyof WidgetData) => (typeof widgets[id] === "number" ? (widgets[id] as number) : 0);
  const extra: Tile[] = [
    { id: "overdue", label: "Overdue invoices", value: n("overdue"), href: "/invoices" },
    { id: "due_week", label: "Due in the next 7 days", value: n("due_week"), href: "/invoices" },
    { id: "paid_month", label: "Paid this month (CAD)", value: n("paid_month"), href: "/payments?status=settled", amount: true },
    { id: "outstanding_cheques", label: "Outstanding cheques", value: n("outstanding_cheques"), href: "/payments?status=outstanding" },
    { id: "open_pos", label: "Open purchase orders", value: n("open_pos"), href: "/purchase-orders" },
    { id: "contracts_ending", label: "Contracts ending in 60 days", value: n("contracts_ending"), href: "/contracts" },
  ];
  tiles.push(...extra.filter((t) => widgets[t.id] !== undefined));

  const colleagues = users.filter((u) => u.status === "active" && u.user_id !== user.user_id && APPROVER_ROLES.includes(u.role));
  return { tiles, pending, spend, colleagues, widgets };
}
