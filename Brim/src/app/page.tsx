import { ButtonLink, Card, SectionHeading } from "@/components/ui";

const STEPS = [
  { title: "Arrives", text: "Invoices come in from the AP inbox, an upload, or an employee's submission." },
  { title: "Read", text: "Each PDF or scan is read, in English or French, into vendor, dates, lines and taxes." },
  { title: "Coded", text: "Every line gets an expense account and department, with the reason shown." },
  { title: "Checked", text: "Vendor, contract, PO, tax and arithmetic are compared, and duplicates caught." },
  { title: "Approved", text: "The right people approve, by amount, department and policy, with delegates covered." },
  { title: "Paid", text: "Payments are scheduled and released by someone allowed to, from the same platform as your cards." },
];

const POINTS = [
  { title: "Every action on record", text: "Who did what, when, and on whose behalf, for every invoice and every change." },
  { title: "Roles enforced on the server", text: "Nobody approves their own request, and nobody releases a payment they approved." },
  { title: "Cards and invoices together", text: "Supplier invoices and card spend in one place, so nothing is paid twice." },
];

/** The public home page: what the product does, and the way in. */
export default function Home() {
  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 sm:px-5">
      <section className="grid items-end gap-8 pt-10 pb-12 sm:pt-14 md:grid-cols-[repeat(auto-fit,minmax(420px,1fr))]">
        <div>
          <p className="label muted m-0 mb-4 text-sm">Brim accounts payable</p>
          <h1 className="heading m-0 text-[40px] leading-[.95] sm:text-[clamp(44px,6.4vw,88px)]">
            Supplier invoices, from inbox to payment
          </h1>
        </div>
        <div className="flex flex-col items-start gap-5">
          <p className="m-0 max-w-[480px] text-[17px] sm:text-[19px]">
            Brim reads your supplier invoices, checks them, sends them to the right approvers and pays them from the
            platform that already runs your company cards.
          </p>
          <div className="flex flex-wrap gap-3.5">
            <ButtonLink href="/login" variant="solid" arrow>
              Log in
            </ButtonLink>
            <ButtonLink href="/signup">Request access</ButtonLink>
          </div>
        </div>
      </section>

      <section aria-labelledby="how" className="border-t-2 border-border pt-12 pb-12">
        <SectionHeading id="how">How an invoice moves</SectionHeading>
        <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-6 p-0">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <Card className="flex h-full flex-col gap-2 p-6">
                <span className="label muted num text-sm">{String(i + 1).padStart(2, "0")}</span>
                <span className="heading text-2xl">{s.title}</span>
                <span className="muted text-[15px]">{s.text}</span>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="why" className="border-t-2 border-border pt-12 pb-16">
        <SectionHeading id="why">Built for audit</SectionHeading>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-6">
          {POINTS.map((p) => (
            <div key={p.title} className="border-l-4 pl-5" style={{ borderColor: "var(--red)" }}>
              <p className="label m-0 mb-2">{p.title}</p>
              <p className="muted m-0 text-[15px]">{p.text}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
