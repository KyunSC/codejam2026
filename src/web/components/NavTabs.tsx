import { Link, useLocation } from "react-router-dom";

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

// Section tabs inside a page: underlined, the current one in red.
export function SubTabs({ items }: { items: Tab[] }) {
  const { pathname } = useLocation();
  return (
    <nav className="tabs">
      {items.map((t) => <Link key={t.href} to={t.href} aria-current={current(pathname, t)}>{t.label}</Link>)}
    </nav>
  );
}
