import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "./recorder";

/**
 * Slack through the Rust side (`src-tauri/src/slack.rs`), which keeps the webhook in the
 * Keychain and posts from there. The window hands the webhook over once, to save it, and
 * never gets it back: it can only ask whether one is set.
 */
export const slackWebhook = {
  has: () => invoke<boolean>("slack_has_webhook"),
  /** Rust checks again that it is Slack's own before it saves it. */
  set: (url: string) => invoke<void>("slack_set_webhook", { url: url.trim() }),
  clear: () => invoke<void>("slack_clear_webhook"),
  /** Posts a recap's text, as `slackRecapText` writes it, to the webhook's channel. */
  post: (text: string) => invoke<void>("slack_post_recap", { text }),
};

/** Whether a Slack webhook is saved on this Mac; false in the browser preview, null until known. */
export function useSlackConnected(): boolean | null {
  const [connected, setConnected] = useState<boolean | null>(isDesktop ? null : false);
  useEffect(() => {
    if (!isDesktop) return;
    let live = true;
    slackWebhook
      .has()
      .then((on) => live && setConnected(on))
      .catch(() => live && setConnected(false));
    return () => {
      live = false;
    };
  }, []);
  return connected;
}
