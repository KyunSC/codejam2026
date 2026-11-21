/**
 * Main navigation. `href` is null until the page exists, so the header shows the item without
 * linking to a 404. Set the href when the screen lands.
 */
export const MAIN_NAV: { label: string; href: string | null }[] = [
  { label: "Review queue", href: "/" },
  { label: "Inbox", href: null },
  { label: "Payments", href: null },
  { label: "Vendors", href: null },
  { label: "Reconciliation", href: null },
];
