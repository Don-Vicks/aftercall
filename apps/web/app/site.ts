/**
 * The test build's file. Every Download button opens the Install page (/download) either
 * way: with NEXT_PUBLIC_DOWNLOAD_URL set it links this file and says how to open an
 * un-notarized build; unset, it says how to build the app from source.
 */
export const DOWNLOAD_URL = process.env.NEXT_PUBLIC_DOWNLOAD_URL ?? "";
export const HAS_DOWNLOAD = DOWNLOAD_URL.length > 0;
export const DOWNLOAD_HREF = "/download";

/** Where testers report bugs and questions (a Telegram invite link). The Install page links it when set. */
export const TESTERS_CHAT_URL = process.env.NEXT_PUBLIC_TESTERS_CHAT_URL ?? "";

/**
 * The GitHub repo is public (since 8 Nov 2026), so the landing and the site's header and footer
 * link to it. NEXT_PUBLIC_REPO_PUBLIC=0 hides those links again, e.g. for a fork kept private.
 */
export const REPO_PUBLIC = process.env.NEXT_PUBLIC_REPO_PUBLIC !== "0";

/** The mono line under the hero and closing buttons. */
export const DOWNLOAD_NOTE = HAS_DOWNLOAD
  ? "Test build on NEAR testnet · macOS 14.2 or later"
  : REPO_PUBLIC
    ? "Signed build coming soon · build it from source today"
    : "Signed build coming soon · source opens with the hackathon submission";
