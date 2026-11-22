// Money as shown in the app and in flag messages: "$1,234.50", or the currency code for non-CAD amounts.
export const money = (n: number | null | undefined, currency = "CAD") =>
  n == null ? "—" : n.toLocaleString("en-CA", { style: "currency", currency, currencyDisplay: currency === "CAD" ? "symbol" : "code" });
