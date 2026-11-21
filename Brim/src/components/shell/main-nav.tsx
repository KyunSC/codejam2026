"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MAIN_NAV } from "./nav";

export function MainNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-auto flex-wrap gap-x-6 gap-y-1.5">
      {MAIN_NAV.map((item) => {
        if (!item.href) {
          return (
            <span key={item.label} className="muted font-medium" title="Not built yet">
              {item.label}
            </span>
          );
        }
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.label}
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
