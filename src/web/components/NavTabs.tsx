import { Link, useLocation } from "react-router-dom";
import type { ResolvedTab } from "@/lib/preferences";
import { usePreferences } from "../preferences";
import { useEditMode } from "../customize/EditMode";
import { SortableArea, SortableItem } from "../customize/Sortable";
import { HideButton } from "../customize/HideButton";
import { HiddenTray } from "../customize/HiddenTray";
import { reorder, setVisible } from "../customize/lists";

type Tab = { href: string; label: string; match: string };
const current = (path: string, t: Tab) => (path === t.match || path.startsWith(`${t.match}/`) ? "page" : undefined);

// Workspace tabs: the current section is the open tab.
export function NavTabs({ items }: { items: Tab[] }) {
  const { pathname } = useLocation();
  return (
    <nav className="wtabs">
      {items.map((t) => <Link key={t.href} to={t.href} aria-current={current(pathname, t)}>{t.label}</Link>)}
    </nav>
  );
}

const HOME = (
  <svg className="wtab-home" width="12" height="12" viewBox="0 0 16 16" role="img" aria-label="Start page"><path d="M2 8l6-5.5L14 8v6H10v-4H6v4H2z" fill="currentColor" /></svg>
);

// The signed-in user's tabs, in their order and without the ones they hid (prefs.tabs is already limited to their role).
// In edit mode: drag to reorder, × to hide, a tray to bring hidden tabs back, a house on the start page.
export function WorkspaceTabs() {
  const { editing } = useEditMode();
  const { prefs, update } = usePreferences();
  const { pathname } = useLocation();
  const visible = prefs.tabs.filter((t) => t.visible);
  if (!editing) return <NavTabs items={visible} />;

  const path = { kind: "tabs" } as const;
  const locked = visible.filter((t) => t.locked);
  const movable = visible.filter((t) => !t.locked);
  const tab = (t: ResolvedTab, grip: React.ReactNode) => (
    <>
      {grip}
      <Link to={t.href} aria-current={current(pathname, t)}>
        {prefs.landingPage === t.id && HOME}
        {t.label}
      </Link>
      {!t.locked && <HideButton label={`the ${t.label} tab`} onHide={() => update(setVisible(path, prefs.tabs, t.id, false))} />}
    </>
  );
  return (
    <>
      <nav className="wtabs wtabs--editing" aria-label="Workspace tabs">
        {locked.map((t) => <span key={t.id} className="wtab-item wtab-item--locked">{tab(t, null)}</span>)}
        <SortableArea
          ids={movable.map((t) => t.id)}
          labels={Object.fromEntries(prefs.tabs.map((t) => [t.id, `the ${t.label} tab`]))}
          strategy="horizontal"
          onReorder={(ids) => update(reorder(path, prefs.tabs, [...locked.map((t) => t.id), ...ids]))}
        >
          {movable.map((t) => (
            <SortableItem key={t.id} id={t.id} as="span" className="wtab-item">
              {({ grip }) => tab(t, grip)}
            </SortableItem>
          ))}
        </SortableArea>
      </nav>
      <HiddenTray what="tabs" className="mt-2" items={prefs.tabs} onShow={(id) => update(setVisible(path, prefs.tabs, id, true))} />
    </>
  );
}

// Section tabs inside a page: underlined, the current one in red.
export function SubTabs({ items }: { items: Tab[] }) {
  const { pathname } = useLocation();
  return (
    <nav className="tabs">
      {items.map((t) => <Link key={t.href} to={t.href} aria-current={current(pathname, t)}>{t.label}</Link>)}
    </nav>
  );
}
