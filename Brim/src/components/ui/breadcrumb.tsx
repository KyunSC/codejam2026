import Link from "next/link";
import { Fragment } from "react";

export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="muted text-[15px]">
      {items.map((it, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden="true"> / </span>}
          {it.href ? (
            <Link href={it.href} className="hover:text-text">
              {it.label}
            </Link>
          ) : (
            <span aria-current="page">{it.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
