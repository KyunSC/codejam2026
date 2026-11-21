import Link from "next/link";
import { roleCan } from "@/lib/auth/matrix";
import { Suspense } from "react";
import { ROLE_LABEL, canManageUsers, canViewAudit } from "@/lib/auth/permissions";
import { readStaffSession, readUserSession } from "@/lib/auth/session";
import { LogoutButton } from "./logout-button";
import { MainNav, type NavItem } from "./main-nav";
import { PixelLogo } from "./pixel-logo";
import { ThemeToggle } from "./theme-toggle";

/**
 * Sticky header: logo, then what the session allows. Logged out: Log in and Request access.
 * Logged in: Invoices, plus Settings (controller/admin) and Audit log (controller/admin, auditor),
 * the user and Log out. Brim staff also get Brim admin.
 * The session part reads cookies, so it streams in behind Suspense.
 */
export function AppHeader() {
  return (
    <header className="z-10 border-b border-rule bg-bg sm:sticky sm:top-0">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3.5 sm:px-5">
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <PixelLogo />
          <span className="heading text-[22px]">Brim</span>
          <span className="muted text-[13px] max-sm:hidden">Accounts payable</span>
        </Link>
        <Suspense fallback={<div className="flex-1" />}>
          <HeaderSession />
        </Suspense>
        <ThemeToggle />
      </div>
    </header>
  );
}

async function HeaderSession() {
  const [session, staff] = await Promise.all([readUserSession(), readStaffSession()]);
  const items: NavItem[] = [];
  if (session) {
    if (roleCan(session.user.role, "invoice.decide")) items.push({ label: "Waiting for me", href: "/approvals" });
    items.push({ label: "Invoices", href: "/invoices" });
    if (["ap_clerk", "finance_manager", "controller_admin", "auditor"].includes(session.user.role)) items.push({ label: "Payments", href: "/payments" });
    if (canManageUsers(session.user.role)) items.push({ label: "Settings", href: "/settings" });
    if (canViewAudit(session.user.role)) items.push({ label: "Audit log", href: "/audit" });
  }
  if (staff) items.push({ label: "Brim admin", href: "/admin" });

  return (
    <>
      <MainNav items={items} />
      <div className="flex flex-wrap items-center gap-3">
        {session ? (
          <>
            <span className="inline-flex h-9 items-center gap-2 rounded-full border-2 border-border bg-surface px-3.5 text-sm font-medium">
              <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: "var(--green)" }} />
              {session.user.fullName} · {ROLE_LABEL[session.user.role]} · {session.org.name}
            </span>
            <LogoutButton />
          </>
        ) : (
          <>
            <Link href="/signup" className="btn btn--ghost btn--sm">
              Request access
            </Link>
            <Link href="/login" className="btn btn--solid btn--sm">
              Log in
            </Link>
          </>
        )}
      </div>
    </>
  );
}
