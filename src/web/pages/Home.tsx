import { Link } from "react-router-dom";
import { Mark } from "../components/ui";

const STEPS: [string, string][] = [
  ["Capture", "Emails, PDFs and scans in English and French become invoices your team can review."],
  ["Control", "Duplicate, tax, contract and bank-change checks before anything is approved."],
  ["Pay", "Approval chains by amount and policy, release limits by role, a full audit trail."],
];

export function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="z-10 border-b border-rule bg-bg sm:sticky sm:top-0">
        <div className="mx-auto flex max-w-[1240px] items-center gap-x-8 px-4 py-3.5 sm:px-5">
          <Link to="/" className="flex items-center gap-2.5 no-underline">
            <Mark />
            <span className="heading text-[22px]">Brim</span>
            <span className="muted text-[13px] max-sm:hidden">Business cards and accounts payable</span>
          </Link>
          <div className="flex-1" />
          <Link to="/login" className="btn btn--solid btn--sm">Log in →</Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 sm:px-5">
        <section className="grid items-end gap-8 pt-10 pb-12 sm:pt-14 md:grid-cols-2">
          <div>
            <p className="label muted m-0 mb-4 text-sm">Business cards and accounts payable</p>
            <h1 className="heading m-0 text-[40px] leading-[.95] sm:text-[clamp(44px,6vw,80px)]">Pay supplier invoices from the platform that issues your cards</h1>
          </div>
          <div className="flex flex-col items-start gap-5">
            <p className="m-0 max-w-[480px] text-[17px] sm:text-[19px]">
              Invoices arrive by email, upload or form. Brim reads them, checks them against your vendors, contracts and purchase orders, routes them to the right
              approvers, and pays by EFT, cheque or single-use virtual card, with every step recorded for audit.
            </p>
            <Link to="/login" className="btn btn--solid">Log in <span aria-hidden="true">→</span></Link>
          </div>
        </section>

        <section className="border-t-2 border-border pt-12 pb-16">
          <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-6 p-0">
            {STEPS.map(([t, d], i) => (
              <li key={t}>
                <div className="card flex h-full flex-col gap-2 p-6">
                  <span className="label muted num text-sm">0{i + 1}</span>
                  <span className="heading text-2xl">{t}</span>
                  <span className="muted text-[15px]">{d}</span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-t-2 border-border" style={{ background: "#121314", color: "#c6d0da" }}>
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 px-4 py-7 text-sm sm:px-5">
          <span className="label" style={{ color: "#e9edf1" }}>© Brim Financial</span>
          <Link to="/employee-login" className="underline underline-offset-4" style={{ color: "#e9edf1" }}>Employee login</Link>
        </div>
      </footer>
    </div>
  );
}
