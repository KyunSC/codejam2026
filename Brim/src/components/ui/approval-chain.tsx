import type { ReactNode } from "react";

export interface ApprovalStepView {
  /** Who acts, e.g. "Dev Malhotra". */
  who: ReactNode;
  /** Their role in plain words. */
  role: string;
  /** What they do at this step: "approves", "releases". */
  does: string;
  /** The policy behind the step, e.g. "P01: up to $10,000 → department manager". */
  policy?: ReactNode;
  /** The step the invoice is waiting on is drawn in gold; done steps in green. */
  state?: "done" | "current" | "waiting";
  /** e.g. "acting for Ana Ruiz (on leave)". */
  delegateNote?: ReactNode;
}

export function ApprovalChain({ steps, label = "Approval chain" }: { steps: ApprovalStepView[]; label?: string }) {
  return (
    <ol aria-label={label} className="m-0 flex list-none flex-col p-0">
      {steps.map((s, i) => {
        const fill = s.state === "current" ? "var(--gold)" : s.state === "done" ? "var(--green)" : "var(--surface)";
        const onFill = s.state === "current" || s.state === "done";
        return (
          <li
            key={i}
            className="flex gap-4 py-3.5"
            style={{ borderTop: i === 0 ? "2px solid var(--border)" : "1px solid var(--line)" }}
            aria-current={s.state === "current" ? "step" : undefined}
          >
            <span
              className="grid size-9 flex-none place-items-center rounded-[3px] border-2 font-bold"
              style={{
                background: fill,
                color: onFill ? "var(--ink)" : "var(--text)",
                borderColor: onFill ? "var(--ink)" : "var(--border)",
              }}
            >
              {i + 1}
            </span>
            <div className="min-w-0">
              <b>{s.who}</b> · {s.role} — {s.does}
              {s.state === "done" && <span className="sr-only"> (done)</span>}
              {s.state === "current" && <span className="sr-only"> (waiting on this step)</span>}
              {s.delegateNote && <div className="text-sm">{s.delegateNote}</div>}
              {s.policy && <div className="muted text-sm">{s.policy}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
