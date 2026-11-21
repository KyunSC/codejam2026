import { Suspense } from "react";
import { Breadcrumb } from "@/components/ui";
import { canManageUsers } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/current";
import { formatDate } from "@/lib/format";
import { AppError } from "@/lib/http";
import { getUser } from "@/lib/users/service";
import { userFormChoices } from "../load";
import { UserForm } from "../user-form";

export default function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto w-full max-w-[960px] px-4 pt-8 pb-16 sm:px-5">
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <View params={params} />
      </Suspense>
    </main>
  );
}

async function View({ params }: { params: Promise<{ id: string }> }) {
  const { user: me, org } = await requireUser();
  if (!canManageUsers(me.role)) return <p className="form-error">Only controllers and admins edit users.</p>;
  const { id } = await params;
  let u;
  try {
    u = await getUser(org.id, id);
  } catch (err) {
    if (err instanceof AppError && err.status === 404) return <p className="form-error">{err.message}</p>;
    throw err;
  }
  const choices = await userFormChoices(org.id);
  return (
    <>
      <Breadcrumb items={[{ label: "Settings", href: "/settings?tab=users" }, { label: u.fullName }]} />
      <h1 className="heading mt-4 mb-8 text-[40px] leading-[.95] sm:text-[56px]">{u.fullName}</h1>
      <UserForm
        slug={org.slug}
        {...choices}
        initial={{
          id: u.id,
          externalId: u.externalId ?? "",
          fullName: u.fullName,
          email: u.email,
          title: u.title ?? "",
          role: u.role,
          departmentId: u.departmentId ?? "",
          managerId: u.managerId ?? "",
          delegateId: u.delegateId ?? "",
          approvalLimitCad: u.approvalLimitCad.toString(),
          workProvince: u.workProvince ?? "",
          status: u.status,
          statusSince: u.statusSince ? formatDate(u.statusSince) : "",
          hireDate: u.hireDate ? formatDate(u.hireDate) : "",
        }}
      />
    </>
  );
}
