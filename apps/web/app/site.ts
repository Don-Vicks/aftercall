/**
 * Where "Download for Mac" goes. No signed build is published yet, so while
 * NEXT_PUBLIC_DOWNLOAD_URL is unset every Download button opens the Install page
 * (/download), which says how to build the app from source. Set the variable to the
 * release file's URL and every button, and the line under it, switch over.
 */
export const DOWNLOAD_URL = process.env.NEXT_PUBLIC_DOWNLOAD_URL ?? "";
export const HAS_DOWNLOAD = DOWNLOAD_URL.length > 0;
export const DOWNLOAD_HREF = HAS_DOWNLOAD ? DOWNLOAD_URL : "/download";
/** The mono line under the hero and closing buttons. */
export const DOWNLOAD_NOTE = HAS_DOWNLOAD ? "macOS 14.2 or later" : "Signed build coming soon · build it from source today";
