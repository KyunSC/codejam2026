/** Audit rows in plain words, for the invoice history and the audit log page. */

const ACTION_TEXT: Record<string, string> = {
  "invoice.received": "brought the invoice in",
  "invoice.created": "created the invoice in the form",
  "invoice.checks_run": "ran the checks on a typed invoice",
  "email.received": "received the email",
  "user.created": "added the user",
  "user.updated": "changed the user",
  "user.password_set": "set the user's password",
  "user.deleted": "deleted the user",
  "user.logged_in": "logged in",
  "organization.created": "created the organization",
  "organization.updated": "renamed the organization",
  "access_request.created": "asked for an account",
  "access_request.approved": "approved the account request",
  "access_request.rejected": "rejected the account request",
};

const ACTOR_TEXT: Record<string, string> = {
  llm: "The reader",
  system: "Brim",
  brim_admin: "Brim staff",
};

export function actionText(action: string): string {
  return ACTION_TEXT[action] ?? action;
}

export function actorText(row: { actorType: string; actorId: string | null }, actorName?: string | null): string {
  if (row.actorType === "user") return actorName ?? row.actorId ?? "Someone";
  if (row.actorType === "llm") return `${ACTOR_TEXT.llm} (${row.actorId})`;
  return ACTOR_TEXT[row.actorType] ?? row.actorType;
}

export function describeAction(row: { actorType: string; actorId: string | null; action: string }, actorName?: string | null): string {
  return `${actorText(row, actorName)} ${actionText(row.action)}`;
}
