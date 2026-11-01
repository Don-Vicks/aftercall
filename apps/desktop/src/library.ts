import { invoke } from "@tauri-apps/api/core";
import { isYou, type Meeting } from "@aftercall/core";
import { account as sampleAccount } from "./sample";

/**
 * Data helpers shared by the library screens: People, Person, Ask, All meetings
 * and Action items. They read the meetings already in the app; nothing here
 * leaves the Mac.
 */

/**
 * The meetings those screens read. The built-in sample was "recorded" by its own
 * fictional user (victor.near), so its items owned by that user read as yours there.
 */
export function libraryMeetings(meetings: Meeting[], sampleId: string): Meeting[] {
  return meetings.map((m) => (m.id === sampleId ? { ...m, actionItems: m.actionItems.map((a) => (isYou(a.owner, [sampleAccount]) ? { ...a, owner: "You" } : a)) } : m));
}

/** "3 min"; a call under a minute still reads "1 min". */
export function minutes(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

/** "1 meeting", "3 meetings" */
export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

/** What "Delete everything on this Mac" removed (delete_all_data, src-tauri/src/wipe.rs). */
export interface Wiped {
  folderRemoved: boolean;
  keychainRemoved: string[];
  keychainFailed: string[];
}

/** Deletes the app's data folder and Keychain items, then the interface's own settings. */
export async function deleteEverything(): Promise<Wiped> {
  const wiped = await invoke<Wiped>("delete_all_data");
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith("aftercall.")) localStorage.removeItem(key);
  } catch {
    // Storage blocked: nothing kept there.
  }
  return wiped;
}
