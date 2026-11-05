import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { cleanRef, count, type Kind } from "./app/metrics";

/**
 * Counts launch traffic by channel (app/metrics.ts): page visits, browser-demo opens,
 * DMG downloads and install-script fetches. A link's ?ref= names the channel and is kept for a day in a
 * first-party cookie, so a visit from X that clicks Download later still counts for X.
 * Nothing identifies the visitor: only the channel and the day are stored.
 */
const REF_COOKIE = "ac_ref";
/** Link previews and crawlers fetch pages too; they aren't people. */
const BOT = /bot\b|crawl|spider|slurp|facebookexternalhit|embedly|telegrambot|discordbot|slackbot|twitterbot|whatsapp\/|linkedinbot|preview/i;

function kindOf(req: NextRequest): Kind | null {
  const path = req.nextUrl.pathname;
  if (path === "/install.sh") return "install";
  if (path.startsWith("/releases/") && path.endsWith(".dmg")) return "download";
  // Only real page loads: not prefetches or client-side data requests.
  const prefetch = req.headers.get("next-router-prefetch") || req.headers.get("purpose") === "prefetch" || req.headers.get("rsc");
  if (!prefetch && (path === "/" || path === "/download")) return "visit";
  if (!prefetch && (path === "/demo" || path === "/demo/")) return "demo";
  return null;
}

export function proxy(req: NextRequest, event: NextFetchEvent) {
  const res = NextResponse.next();
  if (req.method !== "GET") return res;

  const fromLink = req.nextUrl.searchParams.get("ref");
  const ref = cleanRef(fromLink ?? req.cookies.get(REF_COOKIE)?.value);
  if (fromLink && ref !== "other") res.cookies.set(REF_COOKIE, ref, { maxAge: 86400, sameSite: "lax", path: "/" });

  const kind = kindOf(req);
  const ua = req.headers.get("user-agent") ?? "";
  // install.sh downloads the DMG with curl too; that run is already counted as an install.
  const counted = kind === "install" || (kind && !BOT.test(ua) && !(kind === "download" && ua.startsWith("curl/")));
  if (kind && counted) event.waitUntil(count(kind, ref).catch(() => {}));
  return res;
}

export const config = {
  matcher: ["/", "/download", "/demo", "/demo/", "/install.sh", "/releases/:file*"],
};
