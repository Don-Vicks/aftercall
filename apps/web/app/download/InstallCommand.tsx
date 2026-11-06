"use client";

import { useEffect, useState } from "react";
import { CopyButton } from "../client";
import d from "./download.module.css";

/** The test build's one-line install (public/install.sh): no "could not verify" warning, since curl doesn't mark the file as downloaded. */
const INSTALL_URL = "https://getaftercall.vercel.app/install.sh";
// With a ref the URL is quoted: zsh, the Mac's default shell, reads an unquoted ? as a file pattern and stops.
const command = (ref?: string) => `curl -fsSL ${ref ? `"${INSTALL_URL}?ref=${ref}"` : INSTALL_URL} | sh`;

/**
 * The visitor's channel, from ?ref= on this page or the ac_ref cookie proxy.ts keeps, so the
 * install counts for it: curl sends no cookie. Only a ref cleanRef (app/metrics.ts) would keep.
 */
function channel(): string | undefined {
  const fromLink = new URLSearchParams(window.location.search).get("ref");
  const fromCookie = document.cookie.match(/(?:^|;\s*)ac_ref=([^;]*)/)?.[1];
  const r = (fromLink ?? (fromCookie && decodeURIComponent(fromCookie)) ?? "").trim().toLowerCase();
  return /^[a-z0-9-]{1,32}$/.test(r) ? r : undefined;
}

/** The install command and its Copy button, with the visitor's channel once the page has loaded. */
export function InstallCommand() {
  const [text, setText] = useState(command());
  useEffect(() => setText(command(channel())), []);

  return (
    <>
      <div className={d.terminalHead}>
        <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>
          Quickest: install from Terminal
        </span>
        <CopyButton text={text} label="Copy the install command" />
      </div>
      <pre tabIndex={0} aria-label="Install command" className={d.wrapCommand}>
        {text}
      </pre>
    </>
  );
}
