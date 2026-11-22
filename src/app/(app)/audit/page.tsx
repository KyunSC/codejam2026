import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/authz";
import { auditBatch } from "@/lib/auditEvents";
import { AuditList } from "@/components/AuditList";
import { Card, PageTitle, btnLight, input } from "@/components/ui";

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const user = await requireUser();
  if (!can(user, "audit.view")) notFound();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const first = await auditBatch(user.organization_id!, q, null);
  return (
    <div className="space-y-5">
      <PageTitle sub="Every action, who took it and when. The log cannot be edited or deleted.">Audit</PageTitle>
      <Card
        title="Events"
        actions={
          <>
            <form className="flex gap-2"><input name="q" defaultValue={q} placeholder="Filter: action, invoice, person…" className={`${input} w-64`} /><button className={btnLight}>Filter</button></form>
            <a href={`/api/audit/export${q ? `?q=${encodeURIComponent(q)}` : ""}`} className={btnLight}>Export CSV</a>
          </>
        }
      >
        <AuditList key={q} initial={first} q={q} />
      </Card>
    </div>
  );
}
