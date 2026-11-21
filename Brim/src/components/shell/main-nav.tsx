"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  label: string;
  href: string;
}

/** The links the session allows, with the current section underlined. */
export function MainNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-auto flex-wrap gap-x-6 gap-y-1.5">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`font-medium decoration-2 underline-offset-4 hover:underline ${active ? "underline" : "no-underline"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
