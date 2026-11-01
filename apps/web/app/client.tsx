"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui";

/** Copies `text`; says "Copied" with a tick for a moment. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return; // No clipboard (an insecure page or a denied permission): leave the text to select by hand.
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button type="button" onClick={copy} aria-label={label} className="btn btn-tool press">
      {copied ? (
        <span className="pop accent" style={{ display: "inline-flex", alignItems: "center", gap: 6, ["--dur" as string]: "260ms" }}>
          <Icon name="check" size={13} stroke={2.5} />
          Copied
        </span>
      ) : (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="copy" size={13} />
          Copy
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}
