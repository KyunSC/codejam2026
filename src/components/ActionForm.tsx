"use client";

import { useActionState } from "react";

export type ActionResult = { error?: string; ok?: string } | null;

// A form bound to a server action; shows the action's error or confirmation under it.
export function ActionForm({
  action,
  children,
  className,
  id,
}: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form id={id} action={formAction} className={className}>
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {state?.error && <p className="form-error mt-2 basis-full">{state.error}</p>}
      {state?.ok && <p className="form-ok mt-2 basis-full">{state.ok}</p>}
    </form>
  );
}
