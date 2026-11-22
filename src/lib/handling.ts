// How AP deals with a raw item that holds no invoice or could not be read. Shared by the server and the web app.

export const HANDLING_OUTCOMES = {
  requested: "Requested from sender",
  reviewed: "Reviewed and filed",
  answered: "Answered",
  forwarded: "Forwarded",
  dismissed: "Dismissed",
} as const;
export type HandlingOutcome = keyof typeof HANDLING_OUTCOMES;

// What each outcome is for, shown beside the choice.
export const HANDLING_HINTS: Record<HandlingOutcome, string> = {
  requested: "The attachment is missing or unreadable: you asked the sender to send it again. It stays under Waiting on sender.",
  reviewed: "Nothing to pay, e.g. a statement of account: you checked it against what is on file.",
  answered: "A question, e.g. about a payment: you replied to the sender.",
  forwarded: "It is for someone else: you sent it to them.",
  dismissed: "Nothing to do, e.g. marketing or spam.",
};

// The raw items that need handling: no invoice in them, or not readable.
export const HANDLEABLE = ["no_invoice", "failed"] as const;
