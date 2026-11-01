import type { ReactNode } from "react";
// The same font files as the desktop app (bundled, no request to a font service).
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/500.css";
import "@fontsource/instrument-sans/600.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@aftercall/tokens/tokens.css";
import "./globals.css";

export const metadata = {
  title: "Aftercall · private meeting notes that do the follow-ups",
  description: "A Mac app that makes private notes of your calls inside NEAR AI's secure hardware, then sends the recap and pays what you agreed, once you say so.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
