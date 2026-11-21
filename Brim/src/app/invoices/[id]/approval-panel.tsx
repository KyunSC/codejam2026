"use client";

/**
 * Approval chain on the invoice screen: the steps (or, before submit, the preview of them) with the
 * rule behind each and delegate labels, and the action this person may take now: submit (AP clerk),
 * approve or reject (the current step's assignee), reopen a rejected invoice (AP clerk).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApprovalChain, type ApprovalStepView, Button, Card } from "@/components/ui";
import { FormError, Select, TextArea } from "@/components/forms/form-bits";
import { send } from "@/lib/client/api";

export interface ChainStep {
  who: string;
  role: string;
  policy: string;
  delegateNote: string | null;
  state: "done" | "current" | "waiting";
  decision: string | null;
}

export function ApprovalPanel({
  slug,
  invoiceId,
  version,
  steps,
  isPreview,
  blocked,
  releasers,
  canSubmit,
  canDecide,
  canReopen,
  reasons,
}: {
  slug: string;
  invoiceId: string;
  version: number;
  steps: ChainStep[];
  isPreview: boolean;
  blocked: string[];
  releasers: string | null;
  canSubmit: boolean;
  canDecide: boolean;
  canReopen: boolean;
  reasons: readonly string[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");

  async function post(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      await send("POST", `/api/orgs/${slug}/invoices/${invoiceId}/${path}`, body, { "If-Match": String(version) });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  const view: ApprovalStepView[] = steps.map((s) => ({
    who: s.who,
    role: s.role,
    does: s.decision === "rejected" ? "rejected" : s.decision === "approved" ? "approved" : "approves",
    policy: s.policy,
    state: s.state,
    delegateNote: s.delegateNote,
  }));

  return (
    <Card className="flex flex-col gap-4 p-6">
      {isPreview && <p className="label muted m-0 text-sm">Preview: who will approve if submitted now</p>}
      {view.length > 0 ? <ApprovalChain steps={view} /> : <p className="muted m-0">No approval steps yet.</p>}
      {releasers && <p className="m-0 text-[15px]"><span className="muted">May release the payment: </span>{releasers}</p>}
      {blocked.length > 0 && (
        <div role="alert" className="form-error m-0">
          {blocked.map((b, i) => (
            <p key={i} className="m-0">{b}</p>
          ))}
        </div>
      )}
      {canSubmit && (
        <div>
          <Button variant="solid" disabled={busy || blocked.length > 0} onClick={() => post("submit", {})}>
            Submit for approval
          </Button>
        </div>
      )}
      {canDecide && (
        <div className="flex flex-col gap-2.5">
          <Select aria-label="Rejection reason" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Reason (needed to reject)</option>
            {reasons.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
          <TextArea aria-label="Comment" rows={2} placeholder="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="flex flex-wrap gap-2.5">
            <Button variant="solid" disabled={busy} onClick={() => post("approve", { comment: comment || null })}>
              Approve
            </Button>
            <Button
              disabled={busy || !reason}
              onClick={() => post("reject", { comment: [reason, comment].filter(Boolean).join(": ") })}
            >
              Reject
            </Button>
          </div>
        </div>
      )}
      {canReopen && (
        <div className="flex flex-col gap-2.5">
          <TextArea aria-label="Why reopen" rows={2} placeholder="Why it goes back to review (required)" value={comment} onChange={(e) => setComment(e.target.value)} />
          <div>
            <Button disabled={busy || !comment.trim()} onClick={() => post("reopen", { reason: comment })}>
              Reopen for review
            </Button>
          </div>
        </div>
      )}
      <FormError message={error} />
    </Card>
  );
}
