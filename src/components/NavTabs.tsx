"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Workspace tabs: the current section is the open tab.
export function NavTabs({ items }: { items: { href: string; label: string; match: string }[] }) {
  const path = usePathname();
  return (
    <nav className="wtabs">
      {items.map((t) => (
        <Link key={t.href} href={t.href} aria-current={path === t.match || path.startsWith(`${t.match}/`) ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

// Section tabs inside a page: underlined, the current one in red.
export function SubTabs({ items }: { items: { href: string; label: string; match: string }[] }) {
  const path = usePathname();
  return (
    <nav className="tabs">
      {items.map((t) => (
        <Link key={t.href} href={t.href} aria-current={path === t.match || path.startsWith(`${t.match}/`) ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
