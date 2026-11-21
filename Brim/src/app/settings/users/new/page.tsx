import { Suspense } from "react";
import { Breadcrumb } from "@/components/ui";
import { canManageUsers } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/current";
import { userFormChoices } from "../load";
import { UserForm } from "../user-form";

export default function NewUserPage() {
  return (
    <main className="mx-auto w-full max-w-[960px] px-4 pt-8 pb-16 sm:px-5">
      <Breadcrumb items={[{ label: "Settings", href: "/settings?tab=users" }, { label: "Add user" }]} />
      <h1 className="heading mt-4 mb-8 text-[40px] leading-[.95] sm:text-[56px]">Add user</h1>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <View />
      </Suspense>
    </main>
  );
}

async function View() {
  const { user, org } = await requireUser();
  if (!canManageUsers(user.role)) return <p className="form-error">Only controllers and admins add users.</p>;
  const choices = await userFormChoices(org.id);
  return (
    <UserForm
      slug={org.slug}
      {...choices}
      initial={{
        externalId: "",
        fullName: "",
        email: "",
        title: "",
        role: "employee",
        departmentId: "",
        managerId: "",
        delegateId: "",
        approvalLimitCad: "0",
        workProvince: "",
        status: "active",
        statusSince: "",
        hireDate: "",
      }}
    />
  );
}
