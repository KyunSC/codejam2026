import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/authz";
import { one } from "@/lib/db";
import { NavTabs } from "@/components/NavTabs";
import { logout } from "../actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  if (user.role === "brim_employee") redirect("/organizations");
  const org = await one<{ legal_name: string }>("SELECT legal_name FROM organizations WHERE organization_id=$1", [user.organization_id]);
  const tabs = [
    { href: "/dashboard", label: "Dashboard", match: "/dashboard" },
    { href: "/invoices", label: "Invoices", match: "/invoices" },
    ...(can(user, "payment.view") ? [{ href: "/payments", label: "Payments", match: "/payments" }] : []),
    ...(can(user, "vendor.view") ? [{ href: "/vendors", label: "Vendors", match: "/vendors" }] : []),
    ...(can(user, "audit.view") ? [{ href: "/audit", label: "Audit", match: "/audit" }] : []),
    ...(can(user, "users.manage") ? [{ href: "/settings/users", label: "Settings", match: "/settings" }] : []),
  ];
  return (
    <div className="flex min-h-screen flex-col">
      <header className="z-10 border-b-2 border-border bg-bg sm:sticky sm:top-0">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-2 px-4 pt-3 sm:px-5">
          <Link href="/dashboard" className="flex items-baseline gap-2 no-underline">
            <span className="text-[17px] font-bold">{org?.legal_name}</span>
            <span className="muted text-sm">Accounts payable</span>
          </Link>
          <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
            <span className="font-bold">{user.full_name}</span>
            <span className="chip chip--gray">{user.role.replace(/_/g, " ")}</span>
            <form action={logout}><button className="btn btn--ghost btn--sm">Log out</button></form>
          </div>
          <div className="basis-full">
            <NavTabs items={tabs} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-8 sm:px-5">{children}</main>
    </div>
  );
}
