import { Suspense } from "react";
import { requireUser } from "@/lib/auth/current";
import { roleCan } from "@/lib/auth/matrix";
import { db } from "@/lib/db";
import { listPolicies } from "@/lib/workflow/policies";
import { PolicyEditor } from "./policy-editor";

export default function PoliciesPage() {
  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 pt-10 pb-16 sm:px-5">
      <Suspense fallback={<p className="muted">Loading policies…</p>}>
        <PoliciesView />
      </Suspense>
    </main>
  );
}

async function PoliciesView() {
  const { user, org } = await requireUser();
  if (!roleCan(user.role, "admin.read")) {
    return <p className="muted">Only the controller and the auditor can see the approval policy.</p>;
  }
  const data = await db().$transaction((tx) => listPolicies(tx, user));
  return (
    <>
      <p className="label muted m-0 mb-3 text-sm">{org.name}</p>
      <h1 className="heading m-0 mb-3 text-[40px] leading-[.95] sm:text-[56px]">Approval policy</h1>
      <p className="muted m-0 mb-6 max-w-[70ch] text-[15px]">
        One row per rule. Every rule whose conditions all hold adds its steps; the chain is then resolved to people. P07, P08 and P11 are the
        brief&apos;s rules for every role and cannot be changed. An edit applies to invoices submitted after it: steps already created stay as they are.
        {data.canEdit ? " Try a draft on any invoice before saving it." : " You can read the rules and try drafts, but not save them."}
      </p>
      <PolicyEditor slug={org.slug} rules={JSON.parse(JSON.stringify(data.rules))} options={JSON.parse(JSON.stringify(data.options))} canEdit={data.canEdit} />
    </>
  );
}
