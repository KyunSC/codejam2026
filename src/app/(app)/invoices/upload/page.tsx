import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/authz";
import { ActionForm } from "@/components/ActionForm";
import { Card, PageTitle, btn, btnLight } from "@/components/ui";
import { uploadAction } from "../../../actions";

export default async function UploadPage() {
  const user = await requireUser();
  if (!can(user, "raw.submit")) notFound();
  return (
    <div className="max-w-2xl">
      <PageTitle sub="The file is stored as a raw item as it is. An AP clerk extracts it from the Invoices page.">Upload an invoice</PageTitle>
      <Card>
        <ActionForm action={uploadAction} className="space-y-4">
          <div className="dropzone">
            <input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg" required className="block w-full text-sm" />
            <p className="muted mt-2 text-xs">PDF, PNG or JPEG</p>
          </div>
          <div className="flex gap-3">
            <button className={btn}>Upload</button>
            <Link href="/invoices" className={btnLight}>Cancel</Link>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
