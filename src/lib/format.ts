// Money as shown in the app and in flag messages: "$1,234.50", or the currency code for non-CAD amounts.
export const money = (n: number | null | undefined, currency = "CAD") =>
  n == null ? "—" : n.toLocaleString("en-CA", { style: "currency", currency, currencyDisplay: currency === "CAD" ? "symbol" : "code" });

// How a vendor asked for a bank change. The callback check is recorded on its own; the dataset's "phone_callback_verified" means phone.
const CHANNELS: Record<string, string> = { email_request: "email", phone: "phone", phone_callback_verified: "phone", vendor_portal: "vendor portal" };
export const channelName = (channel: string) => CHANNELS[channel] ?? channel.replace(/_/g, " ");
