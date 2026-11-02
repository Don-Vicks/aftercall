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

/*
 * Motion is opt-in and decided before the first paint. The server renders every
 * animated part in its finished state; this adds `motion` to <html> only when the
 * visitor hasn't asked for reduced motion and the page isn't driven by automation,
 * so JS-off visits, reduced motion, headless captures and print all show the final
 * content. `?motion=1` forces it on for testing. Reduced motion adds `calm` (fades
 * only). If the page's script hasn't started within 4 s, motion is dropped so nothing
 * stays hidden.
 */
const MOTION_GATE = `(function(){try{var d=document.documentElement,f=/[?&]motion=1/.test(location.search);if(!f&&matchMedia("(prefers-reduced-motion: reduce)").matches){d.classList.add("calm");return}if(navigator.webdriver&&!f)return;d.classList.add("motion");setTimeout(function(){if(!window.__acMotion)d.classList.remove("motion")},4000)}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: MOTION_GATE }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
