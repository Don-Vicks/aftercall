import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "./recorder";

export interface RecoveryStatus {
  /** This Mac has a NEAR key. */
  hasKey: boolean;
  /** The key came from a recovery phrase, so it (and backups) can be restored. */
  fromPhrase: boolean;
  publicKey: string | null;
}

export interface Restored {
  meetings: number;
  /** Meetings already on this Mac, left as they were. */
  skipped: number;
  projects: number;
  local: Record<string, string>;
}

/** The browser preview has no Keychain: a fixed sample so the screens can be looked at. */
const PREVIEW_PHRASE = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

export const recovery = {
  status: () => (isDesktop ? invoke<RecoveryStatus>("recovery_status") : Promise.resolve<RecoveryStatus>({ hasKey: false, fromPhrase: false, publicKey: null })),
  newPhrase: () => (isDesktop ? invoke<string>("recovery_new_phrase") : Promise.resolve(PREVIEW_PHRASE)),
  /** Derives this Mac's key from the phrase and keeps it in the Keychain. Returns the public key. */
  usePhrase: (phrase: string) => (isDesktop ? invoke<string>("recovery_use_phrase", { phrase }) : Promise.reject(new Error("Recovery works in the Mac app, not the browser preview."))),
  /** Writes an encrypted backup to Downloads and returns its path. */
  exportBackup: () => invoke<string>("backup_export", { local: localSettings() }),
  importBackup: async (file: File) => {
    const restored = await invoke<Restored>("backup_import", { file: toBase64(new Uint8Array(await file.arrayBuffer())) });
    applyLocalSettings(restored.local);
    return restored;
  },
};

/** The app's own localStorage entries (autopilot rules and the like). */
function localSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("aftercall.")) out[key] = localStorage.getItem(key) ?? "";
    }
  } catch {
    // Storage blocked: the backup has no interface settings.
  }
  return out;
}

function applyLocalSettings(local: Record<string, string>) {
  try {
    for (const [key, value] of Object.entries(local)) localStorage.setItem(key, value);
  } catch {
    // Storage blocked: settings fall back to their defaults.
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** "4 meetings and 2 projects" */
export function restoredSummary(r: Restored): string {
  const parts = [`${r.meetings} ${r.meetings === 1 ? "meeting" : "meetings"}`];
  if (r.projects) parts.push(`${r.projects} ${r.projects === 1 ? "project" : "projects"}`);
  const already = r.skipped ? ` ${r.skipped} already on this Mac stayed as they were.` : "";
  return `Restored ${parts.join(" and ")}.${already}`;
}
