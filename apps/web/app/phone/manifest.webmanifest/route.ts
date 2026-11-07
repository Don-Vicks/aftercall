import type { MetadataRoute } from "next";

/**
 * The phone page's web app manifest, so it can be added to a home screen. It lives under
 * /phone and only the phone page links it: an app/manifest.ts would be linked from every
 * page on the site.
 */
export const dynamic = "force-static";

const manifest: MetadataRoute.Manifest = {
  id: "/phone",
  name: "Aftercall",
  short_name: "Aftercall",
  description: "Approve what your meetings want to do next. Your Mac does the sending and paying.",
  start_url: "/phone",
  scope: "/phone",
  display: "standalone",
  // The dark theme's --raised, the page's ground.
  background_color: "#1b1a17",
  theme_color: "#1b1a17",
  icons: [{ src: "/landing/app-icon.png", sizes: "256x256", type: "image/png", purpose: "any" }],
};

export function GET() {
  return new Response(JSON.stringify(manifest), { headers: { "content-type": "application/manifest+json" } });
}
