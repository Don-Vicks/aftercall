import { invoke } from "@tauri-apps/api/core";
import type { ProjectBrief } from "@aftercall/core";
import { isDesktop } from "./recorder";
import { fundraiseBrief } from "./sample";

export interface Project {
  id: string;
  name: string;
  /**
   * What you wrote about the project, so the notes understand it. Saved in projects.json,
   * sealed with the data key; absent in files from earlier versions.
   */
  brief?: ProjectBrief;
}

/** The browser preview: General, and the sample meeting's Fundraise with its brief. */
const PREVIEW: Project[] = [
  { id: "general", name: "General" },
  { id: "fundraise", name: "Fundraise", brief: fundraiseBrief },
];

export const projectsApi = {
  list: () => (isDesktop ? invoke<Project[]>("list_projects") : Promise.resolve(PREVIEW)),
  save: (projects: Project[]) => (isDesktop ? invoke<void>("save_projects", { projects }) : Promise.resolve()),
};

export const deleteRecording = (id: string) => (isDesktop ? invoke<void>("delete_recording", { id }) : Promise.resolve());

/** Re-files every recording of one project under another (rename or delete). */
export const moveRecordings = (from: string, to: string) => (isDesktop ? invoke<number>("move_recordings_project", { from, to }) : Promise.resolve(0));

/** A short id from a name: "Fundraise 2026" -> "fundraise-2026-k3x". */
export function projectId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";
  return `${slug}-${Math.random().toString(36).slice(2, 5)}`;
}
