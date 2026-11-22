import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { logout } from "../actions";

export default async function BrimLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  if (user.role !== "brim_employee") redirect("/dashboard");
  return (
    <div className="flex min-h-screen flex-col">
      <header className="z-10 border-b border-rule bg-bg sm:sticky sm:top-0">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3.5 sm:px-5">
          <Link href="/organizations" className="flex items-baseline gap-2 no-underline">
            <span className="text-[17px] font-bold">Brim</span>
            <span className="muted text-sm">Operations</span>
          </Link>
          <nav className="text-sm font-bold"><Link href="/organizations" className="no-underline">Organizations</Link></nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="font-bold">{user.full_name}</span>
            <form action={logout}><button className="btn btn--ghost btn--sm">Log out</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-8 sm:px-5">{children}</main>
    </div>
  );
}
