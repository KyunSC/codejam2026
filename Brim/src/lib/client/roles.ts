/** Role choices for forms. Mirrors ROLE_LABEL in src/lib/auth/permissions.ts, without server imports. */
export const ROLE_OPTIONS = [
  { value: "employee", label: "Employee" },
  { value: "ap_clerk", label: "AP clerk" },
  { value: "approver", label: "Approver" },
  { value: "finance_manager", label: "Finance manager" },
  { value: "controller_admin", label: "Controller / admin" },
  { value: "auditor", label: "Auditor" },
] as const;

export const ROLE_TEXT: Record<string, string> = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label]));
