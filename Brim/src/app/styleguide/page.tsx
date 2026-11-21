import type { Metadata } from "next";
import {
  ApprovalChain,
  Breadcrumb,
  Button,
  Card,
  Chip,
  DocLine,
  DocPreview,
  FlagCard,
  HeroCount,
  Mark,
  PaperMuted,
  PersonCell,
  PrimaryCell,
  SectionHeading,
  StatRow,
  StateCard,
  TableCard,
  Timeline,
  type FlagKind,
} from "@/components/ui";
import { FilterDemo } from "./filter-demo";

export const metadata: Metadata = { title: "Visual system · Brim AP" };

/*
 * Every part of the Brim visual system on one page, filled with made-up sample content
 * (Example Vendor, round numbers). Nothing here comes from the dataset or the checks; real
 * screens pass real rows into the same components.
 */

const KINDS: FlagKind[] = ["fraud", "duplicate", "tax", "split", "over-po", "check", "clean"];

const SAMPLE_ROWS: { kind: FlagKind; vendor: string; ids: string; why: string; total: string; who: string; role: string; action: string; primary?: boolean }[] = [
  { kind: "fraud", vendor: "Example Vendor Ltd.", ids: "No. 0001 · AP-00001 · approved", why: "Bank account changed on [date] by email, with no callback. Payment would go to ••0000 (was ••1111).", total: "$1,000.00", who: "A finance manager", role: "Finance manager", action: "Open", primary: true },
  { kind: "duplicate", vendor: "Sample Supply Co.", ids: "No. 0002 · AP-00002 · scheduled", why: "Same vendor and invoice number as AP-00003, received 7 days earlier.", total: "$2,000.00", who: "You", role: "AP clerk", action: "Cancel one" },
  { kind: "clean", vendor: "Placeholder Freight", ids: "No. 0004 · AP-00004 · approved", why: "Approved on [date]. Coded to 5000 Example Account.", total: "$3,000.00", who: "You", role: "AP clerk", action: "Schedule" },
];

export default function StyleguidePage() {
  return (
    <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-14 px-4 pt-10 pb-16 sm:px-5">
      <div>
        <p className="label muted m-0 mb-3 text-sm">Sample content · not from the dataset</p>
        <h1 className="heading m-0 text-[40px] leading-[.95] sm:text-[64px]">Visual system</h1>
        <p className="m-0 mt-4 max-w-[60ch]">
          The parts every Brim screen is built from. Use the theme toggle in the header to check both themes.
        </p>
      </div>

      <section aria-labelledby="sg-buttons">
        <SectionHeading id="sg-buttons">Buttons and chips</SectionHeading>
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap gap-3.5">
            <Button variant="solid">
              Primary action <span aria-hidden="true">→</span>
            </Button>
            <Button>Ghost action</Button>
            <Button variant="solid" size="sm">
              Small primary
            </Button>
            <Button size="sm">Small ghost</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <Chip key={k} kind={k} />
            ))}
          </div>
          <FilterDemo
            options={[
              { value: "all", label: "All", count: 12 },
              { value: "fraud", label: "Fraud", count: 1, kind: "fraud" },
              { value: "duplicate", label: "Duplicate", count: 2, kind: "duplicate" },
              { value: "clean", label: "Clean", count: 9, kind: "clean" },
            ]}
          />
        </div>
      </section>

      <section aria-labelledby="sg-hero" className="flex flex-col gap-8">
        <SectionHeading id="sg-hero">Hero count and stats</SectionHeading>
        <HeroCount flagged={3} unpaid={12} fraud={1} fraudHref="#sg-queue" />
        <StatRow
          label="Queue at a glance"
          stats={[
            { label: "Unpaid", value: "12 · $10,000" },
            { label: "Scheduled to pay", value: "9 · $8,000" },
            { label: "Invoices in history", value: "100" },
            { label: "Paid twice in history", value: "1 pair", alert: true },
          ]}
        />
      </section>

      <section aria-labelledby="sg-queue">
        <SectionHeading id="sg-queue">Queue table</SectionHeading>
        <TableCard label="Sample queue">
          <thead>
            <tr>
              <th scope="col">Flag</th>
              <th scope="col">Vendor · invoice</th>
              <th scope="col">Why it stopped</th>
              <th scope="col" className="text-right">Total</th>
              <th scope="col">Next person</th>
              <th scope="col"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_ROWS.map((r) => (
              <tr key={r.ids}>
                <td><Chip kind={r.kind} /></td>
                <td><PrimaryCell title={r.vendor} detail={r.ids} /></td>
                <td className={`text-[15px] ${r.kind === "clean" ? "muted" : ""}`}>{r.why}</td>
                <td className="amt">{r.total}</td>
                <td><PersonCell name={r.who} role={r.role} /></td>
                <td><Button variant={r.primary ? "solid" : "ghost"} size="sm">{r.action}</Button></td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      </section>

      <section aria-labelledby="sg-toolbox">
        <SectionHeading id="sg-toolbox">Tool cards</SectionHeading>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-6">
          {[
            { t: "Inbox", d: "Read every email and attachment into a draft.", c: "10 emails", k: "duplicate" as FlagKind },
            { t: "Payments", d: "Schedule approved invoices for EFT, card or cheque.", c: "9 scheduled", k: "over-po" as FlagKind },
            { t: "Reconcile", d: "Match the bank statement to payments.", c: "2 unexplained", k: "fraud" as FlagKind },
          ].map((x) => (
            <a key={x.t} href="#sg-toolbox" className="card flex flex-col gap-2.5 p-[22px]">
              <span className="label text-xl">{x.t}</span>
              <span className="muted text-[15px]">{x.d}</span>
              <Chip kind={x.k} className="self-start">{x.c}</Chip>
            </a>
          ))}
        </div>
      </section>

      <section aria-labelledby="sg-invoice" className="flex flex-col gap-7">
        <SectionHeading id="sg-invoice">Invoice screen</SectionHeading>
        <Breadcrumb items={[{ label: "Review queue", href: "/" }, { label: "Example Vendor Ltd. · 0001" }]} />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="label muted m-0 mb-2 text-[13px]">AP-00001 · received [date]</p>
            <p className="heading m-0 text-[36px] leading-[.95] sm:text-[clamp(36px,4.6vw,60px)]">
              0001 <span className="muted">·</span> $1,130.00
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button>Override with reason</Button>
            <Button variant="solid">Ask vendor for a corrected invoice</Button>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-8">
          <div className="min-w-0 flex-[1_1_440px]">
            <DocPreview caption="Gold: read from the document and agrees with the vendor record. Red: the values the flag is about.">
              <div className="flex flex-wrap justify-between gap-4">
                <div>
                  <div className="text-xl font-bold">Example Vendor Ltd.</div>
                  <div><PaperMuted>123 Sample St, City PR A1A 1A1</PaperMuted></div>
                  <div><PaperMuted>Tax no. <Mark tone="match">000000000RT0001</Mark></PaperMuted></div>
                </div>
                <div className="sm:text-right">
                  <div className="text-xl font-bold tracking-[.04em]">INVOICE</div>
                  <div>No. <Mark tone="match">0001</Mark></div>
                  <div>Date <Mark tone="match">[date]</Mark></div>
                </div>
              </div>
              <div className="my-[22px] rounded px-3.5 py-3" style={{ background: "var(--paper-2)" }}>
                <div className="text-xs font-bold tracking-[.06em]" style={{ color: "var(--paper-muted)" }}>BILL TO</div>
                Harborline Logistics — <Mark tone="flag">[bill-to address]</Mark>
              </div>
              <DocLine head cells={["Description", "Qty", "Amount"]} />
              <DocLine cells={["Sample service", "1", "600.00"]} />
              <DocLine cells={["Sample goods", "2", "400.00"]} />
              <div className="mt-3.5 grid grid-cols-[1fr_100px] justify-items-end gap-1.5">
                <span>Subtotal</span><span className="num">1,000.00</span>
                <span>Tax 13%</span><span className="num"><Mark tone="flag">130.00</Mark></span>
                <span className="font-bold">Total CAD</span><span className="num font-bold"><Mark tone="match">1,130.00</Mark></span>
              </div>
            </DocPreview>
          </div>

          <div className="flex min-w-0 flex-[1_1_520px] flex-col gap-7">
            <StateCard
              items={[
                { label: "State", value: <Chip kind="tax">Needs fixing</Chip> },
                { label: "Next person", value: <><b>You</b>, then an approver</> },
                { label: "Requested by", value: <><b>A requester</b> · Operations</> },
                { label: "Due", value: <><b>[date]</b> · net 30</> },
              ]}
            />
            <section aria-labelledby="sg-flags">
              <SectionHeading id="sg-flags" level={3}>1 flag</SectionHeading>
              <FlagCard
                kind="tax"
                title="Wrong tax for province"
                message={<>This invoice is billed to <b>[province]</b>, where 5% GST applies (<b>$50.00</b>). The vendor charged 13% HST (<b>$130.00</b>), <b>$80.00</b> too much.</>}
                evidence={[
                  { label: "Expected", value: "$50.00", source: "tax_codes.csv GST5 × subtotal" },
                  { label: "Charged", value: "$130.00", source: "invoice, tax line" },
                ]}
                actions={<><Button variant="solid">Ask vendor for a corrected invoice</Button><Button>Override with reason</Button></>}
              />
            </section>
            <section aria-labelledby="sg-coding">
              <SectionHeading id="sg-coding" level={3}>Coding</SectionHeading>
              <TableCard label="Coding" minWidth={480}>
                <thead>
                  <tr><th scope="col">Line</th><th scope="col">Account · reason</th><th scope="col" className="text-right">Amount</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Sample service</td>
                    <td><b>5000 Example Account</b> · Operations<div className="muted text-[13px]">Vendor&rsquo;s default account</div></td>
                    <td className="amt">600.00</td>
                  </tr>
                  <tr>
                    <td>Sample goods</td>
                    <td><b>5100 Other Example</b> · Operations<div className="muted text-[13px]">8 of 10 past lines like this went here</div></td>
                    <td className="amt">400.00</td>
                  </tr>
                </tbody>
              </TableCard>
            </section>
            <section aria-labelledby="sg-chain">
              <SectionHeading id="sg-chain" level={3}>Approval chain</SectionHeading>
              <ApprovalChain
                steps={[
                  { who: "You", role: "AP clerk", does: "fixes and submits", policy: "Every invoice starts with AP review", state: "current" },
                  { who: "An approver", role: "Department manager", does: "approves", policy: "P01: up to $10,000 → department manager", state: "waiting" },
                  { who: "A finance manager", role: "Finance manager", does: "releases", policy: "P09: payments up to $100,000", state: "waiting" },
                ]}
              />
            </section>
            <section aria-labelledby="sg-history">
              <SectionHeading id="sg-history" level={3}>History</SectionHeading>
              <Timeline
                events={[
                  { at: "[date]", text: "Received from the AP inbox" },
                  { at: "[date] 09:00", text: <>Flagged: <b>Wrong tax for province</b></> },
                ]}
              />
            </section>
          </div>
        </div>
      </section>

      <Card className="p-6">
        <p className="label m-0 mb-2">Contrast</p>
        <p className="muted m-0">Muted text on a card. Body text and muted text both clear 4.5:1 in both themes.</p>
      </Card>
    </main>
  );
}
