import Link from "next/link";
import { Suspense } from "react";
import { MainNav } from "./main-nav";
import { PixelLogo } from "./pixel-logo";
import { ThemeToggle } from "./theme-toggle";

export interface CurrentUser {
  name: string;
  /** Plain-words role, e.g. "AP clerk". */
  roleLabel: string;
}

/**
 * Sticky header: logo, main nav, the signed-in user and Switch user, and the theme toggle.
 * Login doesn't exist yet, so with no `user` the pill says so and Switch user is disabled.
 */
export function AppHeader({ user, switchUserHref }: { user?: CurrentUser; switchUserHref?: string }) {
  return (
    <header className="z-10 sm:sticky sm:top-0 border-b border-rule bg-bg">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3.5 sm:px-5">
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <PixelLogo />
          <span className="heading text-[22px]">Brim</span>
          <span className="muted text-[13px] max-sm:hidden">for Harborline Logistics</span>
        </Link>
        <Suspense fallback={<div className="flex-1" />}>
          <MainNav />
        </Suspense>
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex h-9 items-center gap-2 rounded-full border-2 border-border bg-surface px-3.5 text-sm font-medium">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full"
              style={{ background: user ? "var(--green)" : "var(--muted)" }}
            />
            {user ? `${user.name} · ${user.roleLabel}` : "No user picked"}
          </span>
          {switchUserHref ? (
            <Link href={switchUserHref} className="btn btn--ghost btn--sm">
              Switch user
            </Link>
          ) : (
            <button type="button" className="btn btn--ghost btn--sm" disabled title="Login isn't built yet">
              Switch user
            </button>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
