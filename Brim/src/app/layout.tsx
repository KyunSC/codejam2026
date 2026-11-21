import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { AppHeader } from "@/components/shell/app-header";
import { AppFooter } from "@/components/shell/app-footer";
import { ThemeScript } from "@/components/shell/theme-script";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Brim AP",
  description: "Harborline Logistics accounts payable, from inbox to payment.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // No data-theme by default: CSS follows prefers-color-scheme until the toggle sets one.
    <html lang="en" className={`${dmSans.variable} h-full`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <ThemeScript />
        <AppHeader />
        <div className="flex flex-1 flex-col">{children}</div>
        <AppFooter />
        <Analytics />
      </body>
    </html>
  );
}
