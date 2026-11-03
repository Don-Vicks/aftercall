import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readText, writeSecret } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { isDesktop } from "./recorder";

/**
 * Keeping a phrase other than on paper: Copy (cleared after 60 seconds), a recovery kit
 * saved where you pick, or the same kit printed. For both phrases on the phrase screens:
 * a new NEAR account's and Aftercall's own. The words go only to the clipboard, the file
 * you pick (written by Rust, recovery_kit.rs) or the print panel; nothing here stores them.
 */

/** What a kit says about whose words these are and how to bring them back. */
export interface KitAbout {
  /** The kit's heading: the account ("ada.testnet") or "Aftercall recovery phrase". */
  name: string;
  /** Under the heading: what the words are. */
  kind: string;
  /** How to restore, in one paragraph. */
  restore: string;
  /** What someone with the words can do, in one sentence. */
  risk: string;
  /** The Save dialog's suggested file name. */
  fileName: string;
}

/** Said in every kit file and printout, after `risk`. */
export const KIT_KEEP = "Keep this file offline — a USB drive or a printout — not in iCloud, email or chat.";
/** The same advice on screen, where there's no file yet. */
export const SCREEN_KEEP = "Keep copies offline: paper or a USB drive, not iCloud, email or chat.";

/** A new NEAR testnet account's phrase (CreateAccount.tsx). */
export function walletKit(account: string): KitAbout {
  return {
    name: account,
    kind: "NEAR testnet wallet phrase",
    restore:
      "Import into Meteor: open wallet.meteorwallet.app, switch the network to Testnet, pick the recovery phrase option and type the 12 words in order. Any NEAR wallet that imports a 12-word phrase works too.",
    risk: "Anyone with these words controls this account.",
    fileName: `${account} recovery kit.txt`,
  };
}

/** Aftercall's own recovery phrase, for this Mac's limited key and encrypted backups. */
export function appKit(): KitAbout {
  return {
    name: "Aftercall recovery phrase",
    kind: "This Mac's limited NEAR key and your encrypted backups",
    restore:
      "Aftercall → Settings → Recovery phrase → I have a phrase, then type the 12 words in order. On a new Mac, pick Restore from a recovery phrase on the first screen. It brings back this Mac's key and opens your backups.",
    risk: "Anyone with these words can use this Mac's key, within your contract's limits, and open your encrypted backups.",
    fileName: "Aftercall recovery kit.txt",
  };
}

/** "3 November 2026", in the Mac's time zone. */
export function kitDate(d = new Date()): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

const nn = (n: number) => String(n).padStart(2, "0");

/** The kit as plain text: one page, the words numbered one per line. */
export function kitText(about: KitAbout, words: readonly string[], date: string): string {
  return [
    "Recovery kit",
    about.name,
    `${about.kind} · saved ${date}`,
    "",
    `Your ${words.length} words, in order`,
    "",
    ...words.map((w, i) => `${nn(i + 1)}  ${w}`),
    "",
    "How to restore",
    about.restore,
    "",
    "Keep it safe",
    `${about.risk} ${KIT_KEEP}`,
    "",
    "Made by Aftercall, which doesn't keep these words.",
    "",
  ].join("\n");
}

/** A folder that syncs to a cloud service: iCloud Drive, or a provider under ~/Library/CloudStorage. */
export function syncedFolder(path: string): boolean {
  return /\/Library\/(Mobile Documents|CloudStorage)\/|\/(Dropbox|Google Drive|OneDrive)\//i.test(path);
}

/**
 * Asks where to save the kit (the native Save dialog) and writes it there from Rust.
 * Resolves with the saved path, or null when you cancel.
 */
export async function saveKit(about: KitAbout, text: string): Promise<string | null> {
  if (!isDesktop) throw new Error("Saving a kit works in the Mac app, not the browser preview.");
  const path = await save({
    title: "Save recovery kit",
    defaultPath: about.fileName,
    filters: [{ name: "Plain text", extensions: ["txt"] }],
    canCreateDirectories: true,
  });
  if (!path) return null;
  return invoke<string>("recovery_save_kit", { path, text });
}

/** Seconds a copied phrase stays on the clipboard. */
export const CLEAR_AFTER = 60;

/**
 * The Mac app's clipboard (tauri-plugin-clipboard-manager); the browser's in the preview.
 * writeSecret is plain text marked concealed (org.nspasteboard.ConcealedType), which asks
 * clipboard managers not to keep it in their history.
 */
const clipboard = {
  write: (text: string) => (isDesktop ? writeSecret(text) : navigator.clipboard.writeText(text)),
  read: () => (isDesktop ? readText() : navigator.clipboard.readText()),
};

/**
 * Copy for a phrase: puts the words on the clipboard, then clears it after 60 seconds, when
 * the step closes, or on `clear()`, but only if it still holds exactly these words, so
 * something you copied since stays. `left` counts down the seconds while it's there.
 */
export function usePhraseClipboard(text: string) {
  const [left, setLeft] = useState<number | null>(null);
  /** What this hook put there, until it's cleared or replaced. */
  const copied = useRef<string | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
  };
  const clear = async () => {
    stop();
    setLeft(null);
    const ours = copied.current;
    copied.current = null;
    if (!ours) return;
    try {
      if ((await clipboard.read()) === ours) await clipboard.write("");
    } catch {
      // Nothing readable (an image, or the clipboard is empty): not ours to clear.
    }
  };

  const copy = async () => {
    stop();
    await clipboard.write(text);
    copied.current = text;
    // From a deadline, not by counting ticks: a hidden window's timers run late.
    const deadline = Date.now() + CLEAR_AFTER * 1000;
    setLeft(CLEAR_AFTER);
    tick.current = setInterval(() => {
      const s = Math.ceil((deadline - Date.now()) / 1000);
      if (s <= 0) void clear();
      else setLeft(s);
    }, 250);
  };

  // Leaving the step clears it too.
  useEffect(() => () => void clear(), []);

  return { copy, clear, left };
}
