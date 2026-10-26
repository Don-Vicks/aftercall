import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "./recorder";

export interface Project {
  id: string;
  name: string;
}

const PREVIEW: Project[] = [{ id: "general", name: "General" }];

export const projectsApi = {
  list: () => (isDesktop ? invoke<Project[]>("list_projects") : Promise.resolve(PREVIEW)),
  save: (projects: Project[]) => (isDesktop ? invoke<void>("save_projects", { projects }) : Promise.resolve()),
};

export const deleteRecording = (id: string) => invoke<void>("delete_recording", { id });

/** A short id from a name: "Fundraise 2026" -> "fundraise-2026-k3x". */
export function projectId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";
  return `${slug}-${Math.random().toString(36).slice(2, 5)}`;
}
