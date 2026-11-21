import type { Metadata } from "next";
import { DM_Sans, Silkscreen } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap" });
const silkscreen = Silkscreen({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-silkscreen", display: "swap" });

export const metadata: Metadata = {
  title: "Live Sim",
  description: "A whiteboard shared by a student and their lab pet, with live simulations.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full antialiased ${dmSans.variable} ${silkscreen.variable}`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
