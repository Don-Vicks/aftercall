import type { ReactNode } from "react";
import { Geist_Mono, Instrument_Sans, Newsreader } from "next/font/google";
import "./globals.css";

const serif = Newsreader({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-serif" });
const sans = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], weight: ["400"], variable: "--font-mono" });

export const metadata = { title: "Aftercall", description: "Private meeting notes that do the follow-ups" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
