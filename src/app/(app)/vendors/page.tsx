import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/authz";
import { query } from "@/lib/db";
import { A, Badge, Card, PageTitle, Status, Table, Td, btn } from "@/components/ui";
import { vendorName } from "@/lib/normalize";

export default async function VendorsPage({ searchParams }: PageProps<"/vendors">) {
  const user = await requireUser();
  if (!can(user, "vendor.view")) notFound();
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "all";
  const vendors = await query<{ vendor_id: string; legal_name: string; category: string | null; province_or_state: string | null; country: string | null; preferred_payment_method: string; status: string; gst_hst_number: string | null; bank_account: string | null; invoices: number; pending_change: boolean }>(
    `SELECT v.*, (SELECT count(*)::int FROM invoices i WHERE i.vendor_id=v.vendor_id) invoices,
       EXISTS (SELECT 1 FROM vendor_bank_changes c WHERE c.vendor_id=v.vendor_id AND (c.status='pending' OR NOT c.verified_by_callback)) pending_change
     FROM vendors v WHERE v.organization_id=$1 ${status === "all" ? "" : "AND v.status=$2"} ORDER BY v.legal_name`,
    status === "all" ? [user.organization_id] : [user.organization_id, status],
  );
  const base = (s: string) => vendorName(s).replace(/ (inc|ltd|llp)$/, "");
  const lookalike = (v: (typeof vendors)[number]) => vendors.some((o) => o.vendor_id !== v.vendor_id && base(o.legal_name) === base(v.legal_name));
  return (
    <div className="space-y-5">
      <PageTitle sub="New vendors wait for finance manager approval. A change of bank details is a request that must be verified by callback.">Vendors</PageTitle>
      <Card
        title={`${vendors.length} vendors`}
        actions={
          <>
            {["all", "active", "pending_review", "on_hold"].map((s) => (
              <Link key={s} href={s === "all" ? "/vendors" : `/vendors?status=${s}`} scroll={false} className="chip" aria-current={s === status}>{s.replace("_", " ")}</Link>
            ))}
            {can(user, "vendor.onboard") && <Link href="/vendors/new" className={btn}>Onboard vendor</Link>}
          </>
        }
      >
        <Table head={["Vendor", "Category", "Location", "GST/HST", "Pays by", "Invoices", "Status", "Warnings"]}>
          {vendors.map((v) => (
            <tr key={v.vendor_id}>
              <Td><A href={`/vendors/${v.vendor_id}`}>{v.legal_name}</A> <span className="text-xs muted">{v.vendor_id}</span></Td>
              <Td>{v.category}</Td>
              <Td>{v.province_or_state} {v.country}</Td>
              <Td className="font-mono text-xs">{v.gst_hst_number ?? "—"}</Td>
              <Td>{v.preferred_payment_method}</Td>
              <Td>{v.invoices}</Td>
              <Td><Status value={v.status} /></Td>
              <Td className="space-x-1">
                {lookalike(v) && <Badge tone="gold">lookalike name</Badge>}
                {v.pending_change && <Badge tone="red">bank change unverified</Badge>}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
