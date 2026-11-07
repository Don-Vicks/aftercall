import type { Metadata, Viewport } from "next";
import { PhoneClient } from "./PhoneClient";

export const metadata: Metadata = {
  title: "Phone · Aftercall",
  description: "Approve what your meetings want to do next, from your phone. Your Mac does the sending and paying.",
  // Scoped to /phone, so adding the landing page to a home screen doesn't install this.
  manifest: "/phone/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Aftercall", statusBarStyle: "default" },
  // iOS's Add to Home Screen: the icon edge to edge on its dark ground (scripts/phone-icons.sh).
  icons: { apple: { url: "/phone-icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" } },
  // Nothing on this page is for search engines.
  robots: { index: false, follow: false },
};

/** The page's ground (--raised) in each theme, for the browser's bars. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#1b1a17" },
    { media: "(prefers-color-scheme: light)", color: "#fbf9f4" },
  ],
};

export default function PhonePage() {
  return <PhoneClient />;
}
