import { invoke } from "@tauri-apps/api/core";
import { bestEvent, type CalendarEvent } from "@aftercall/core";
import { isDesktop, type SavedRecording } from "./recorder";

export type CalendarStatus = "not-asked" | "denied" | "granted";

/**
 * The macOS calendar, read-only. Everything here is optional: without access (or in
 * the browser preview) recordings keep their time-based names and recaps ask for an
 * address as before.
 */
export const calendar = {
  status: (): Promise<CalendarStatus> => (isDesktop ? invoke<CalendarStatus>("calendar_status") : Promise.resolve("denied")),
  /** Shows the macOS prompt the first time; afterwards macOS answers from Settings. */
  requestAccess: (): Promise<boolean> => (isDesktop ? invoke<boolean>("calendar_request_access") : Promise.resolve(false)),
  /** The event a recording belongs to, or null. Never throws. */
  eventFor: async (r: Pick<SavedRecording, "startedAt" | "seconds">): Promise<CalendarEvent | null> => {
    if (!isDesktop) return null;
    const end = r.startedAt + Math.max(r.seconds, 60);
    const events = await invoke<CalendarEvent[]>("calendar_events_between", { start: r.startedAt, end }).catch(() => []);
    return bestEvent(events, r.startedAt, end);
  },
};

/** Calendar titles for recordings that have no notes yet, by recording id. */
export async function eventTitles(list: SavedRecording[]): Promise<Record<string, string>> {
  if ((await calendar.status().catch(() => "denied")) !== "granted") return {};
  const found = await Promise.all(list.filter((r) => !r.notes && !r.label).map(async (r) => [r.id, (await calendar.eventFor(r))?.title ?? ""] as const));
  return Object.fromEntries(found.filter(([, title]) => title));
}
