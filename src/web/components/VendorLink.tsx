import { can } from "@/lib/authz";
import { useUser } from "../session";
import { A } from "./ui";

// A vendor's name: a link to its page for those who may open vendor pages, plain text for everyone else,
// so nobody is sent to a page they cannot see.
export function VendorLink({ id, children }: { id: string | null | undefined; children: React.ReactNode }) {
  const user = useUser();
  if (!id || !can(user, "vendor.view")) return <>{children}</>;
  return <A href={`/vendors/${id}`}>{children}</A>;
}
