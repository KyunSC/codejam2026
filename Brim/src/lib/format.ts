/** Display formatting shared by server and client components. */

type Num = { toString(): string } | number | string | null | undefined;

export function formatMoney(amount: Num, currency?: string | null): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = Number(amount.toString());
  if (!Number.isFinite(n)) return String(amount);
  const text = n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${text} ${currency}` : text;
}

/** A calendar date (stored as midnight UTC) as YYYY-MM-DD. */
export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toISOString().slice(0, 10);
}

/** A moment, in Toronto time: YYYY-MM-DD HH:MM. */
export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(d))
    .replace(",", "");
}

/** First value of a search param. */
export function param(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}
