import { invoke } from "@tauri-apps/api/core";
import { isDesktop, type SavedRecording } from "./recorder";
import designerKickoff from "../../../samples/designer-kickoff/script.json";
import teamCheckin from "../../../samples/team-checkin/script.json";

/**
 * The fictional sample calls in samples/ (made by scripts/make-samples.mjs). In the
 * Mac app, opening one copies its two audio stems into the recordings folder as an
 * ordinary recording labelled "Sample", ready for "Make notes" on real NEAR AI.
 */
export interface SampleScript {
  id: string;
  title: string;
  fictional: string;
  seconds: number;
  lines: { at: number; speaker: "you" | "others"; name: string; text: string }[];
}

export const sampleScripts = [designerKickoff, teamCheckin] as SampleScript[];

/** In the browser preview there is no recordings folder: these stand in, held in memory. */
const previewScripts = new Map<string, SampleScript>();

export async function openSample(sampleId: string, project: string): Promise<SavedRecording> {
  if (isDesktop) return invoke<SavedRecording>("open_sample", { sample: sampleId, project });
  const script = sampleScripts.find((s) => s.id === sampleId);
  if (!script) throw new Error("No such sample");
  let id = Math.floor(Date.now() / 1000);
  while (previewScripts.has(String(id))) id++;
  previewScripts.set(String(id), script);
  return { id: String(id), project, startedAt: id, seconds: script.seconds, chunks: 1, dir: "", label: "Sample", title: script.title };
}

/** True when the sample exists only in this browser tab (pnpm dev:ui), with no audio to process. */
export const isPreviewSample = (recordingId: string) => previewScripts.has(recordingId);

/** What a sample call says, line by line, to compare with the notes. Undefined for real recordings. */
export function sampleScriptFor(r: SavedRecording): SampleScript | undefined {
  return previewScripts.get(r.id) ?? (r.label === "Sample" ? sampleScripts.find((s) => s.title === r.title) : undefined);
}
