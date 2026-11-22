import { useState } from "react";

// A form whose submit calls the API; shows the error, or the confirmation `submit` returns, under it.
// The pressed button's name and value are in the FormData, like a regular form post.
export function ApiForm({
  submit,
  children,
  className,
  id,
}: {
  submit: (fd: FormData) => Promise<string | void>;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const [state, setState] = useState<{ error?: string; ok?: string } | null>(null);
  const [pending, setPending] = useState(false);
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    setPending(true);
    try {
      const ok = await submit(fd);
      setState(ok ? { ok } : null);
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setPending(false);
    }
  };
  return (
    <form id={id} onSubmit={onSubmit} className={className}>
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {state?.error && <p className="form-error mt-2 basis-full">{state.error}</p>}
      {state?.ok && <p className="form-ok mt-2 basis-full">{state.ok}</p>}
    </form>
  );
}

// Text fields of a form: empty ones are null.
export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return v == null || v === "" ? null : String(v);
};
export const numOrNull = (fd: FormData, k: string) => (str(fd, k) == null ? null : Number(str(fd, k)));
