import { handler } from "@/lib/api";
import { submitForm, submitPdf } from "@/services/rawIntake.service";

// JSON body: a form entry. Multipart body: a PDF or image upload in field "file".
export const POST = handler(async (req, user) => {
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const fd = await req.formData();
    const file = fd.get("file") as File;
    return { raw_item_id: await submitPdf(user, file.name, Buffer.from(await file.arrayBuffer())) };
  }
  const body = await req.json();
  return { raw_item_id: await submitForm(user, body.form, { submittedBy: body.submitted_by, receivedAt: body.received_at, organizationId: body.organization_id }) };
});
