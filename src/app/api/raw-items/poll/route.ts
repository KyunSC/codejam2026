import { handler } from "@/lib/api";
import { pollInbox } from "@/services/inboxPolling.service";

export const POST = handler(async (_req, user) => pollInbox(user));
