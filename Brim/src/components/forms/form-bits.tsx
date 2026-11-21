import type { ComponentProps, ReactNode } from "react";

/** A labelled input. */
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Input(props: ComponentProps<"input">) {
  return <input className="input" {...props} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select className="input" {...props} />;
}

export function TextArea(props: ComponentProps<"textarea">) {
  return <textarea className="input" {...props} />;
}

export function FormError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="form-error m-0">
      {message}
    </p>
  ) : null;
}

/** The narrow centred column used by the login and sign-up pages. */
export function AuthPage({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-[520px] px-4 py-12 sm:px-5 sm:py-16">
      <p className="label muted m-0 mb-3 text-sm">{eyebrow}</p>
      <h1 className="heading m-0 mb-8 text-[40px] leading-[.95] sm:text-[56px]">{title}</h1>
      {children}
    </main>
  );
}
