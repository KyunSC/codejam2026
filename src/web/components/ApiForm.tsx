import { useEffect, useState } from "react";

// A form whose submit calls the API; shows the error, or the confirmation `submit` returns, under it.
// The pressed button's name and value are in the FormData, like a regular form post.
export function ApiForm({
  submit,
  children,
  className,
  id,
  reset,
  inline,
  confirm,
}: {
  submit: (fd: FormData) => Promise<string | void>;
  children: React.ReactNode;
  className?: string;
  id?: string;
  // clear the fields after it worked, for forms that create something
  reset?: boolean;
  // show the message beside the button, for one-button forms in a toolbar
  inline?: boolean;
  // for a critical action: the question asked in a box before anything is sent; a function picks it from the button pressed, or null to skip
  confirm?: string | ((fd: FormData) => string | null);
}) {
  const [state, setState] = useState<{ error?: string; ok?: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [asking, setAsking] = useState<{ question: string; fd: FormData; form: HTMLFormElement } | null>(null);
  const send = async (fd: FormData, form: HTMLFormElement) => {
    setPending(true);
    try {
      const ok = await submit(fd);
      setState(ok ? { ok } : null);
      if (reset && form.isConnected) form.reset();
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setPending(false);
    }
  };
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form, (e.nativeEvent as SubmitEvent).submitter);
    const question = typeof confirm === "function" ? confirm(fd) : confirm;
    if (question) setAsking({ question, fd, form });
    else void send(fd, form);
  };
  return (
    <form id={id} onSubmit={onSubmit} className={inline ? `flex flex-wrap items-center gap-x-2 gap-y-1 ${className ?? ""}` : className}>
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {state?.error && <p className={inline ? "max-w-xs text-xs text-flag [overflow-wrap:anywhere]" : "form-error col-span-full mt-2 basis-full"}>{state.error}</p>}
      {state?.ok && <p className={inline ? "max-w-xs text-xs muted [overflow-wrap:anywhere]" : "form-ok col-span-full mt-2 basis-full"}>{state.ok}</p>}
      {asking && (
        <ConfirmBox
          question={asking.question}
          onConfirm={() => { setAsking(null); void send(asking.fd, asking.form); }}
          onCancel={() => setAsking(null)}
        />
      )}
    </form>
  );
}

// The box asking to confirm a critical action, over the page; Escape or Cancel closes it.
function ConfirmBox({ question, onConfirm, onCancel }: { question: string; onConfirm: () => void; onCancel: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div role="alertdialog" aria-modal="true" className="card w-full max-w-md space-y-4 p-5" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm">{question}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn--solid btn--sm" onClick={onConfirm} autoFocus>Confirm</button>
        </div>
      </div>
    </div>
  );
}

// Text fields of a form: empty ones are null.
export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return v == null || v === "" ? null : String(v);
};
export const numOrNull = (fd: FormData, k: string) => (str(fd, k) == null ? null : Number(str(fd, k)));
