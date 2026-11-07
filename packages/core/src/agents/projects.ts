/**
 * Deleting a project moves its meetings into another one. Agents reach a meeting by its
 * project (Coding agents → "Projects agents can reach": the ids chosen, or null for every
 * project; the Mac app checks it on each request, `Scope` in agents.rs), so the move must
 * not hand agents meetings they couldn't reach before.
 */

/** A project as the app lists it. */
export interface ProjectRef {
  id: string;
  name: string;
}

export interface ProjectDeletion {
  /** Where the deleted project's meetings go. */
  target: ProjectRef;
  /** The projects agents may reach afterwards, by id; null for every project. The deleted one's id is gone. */
  agentProjects: string[] | null;
  /** The target was open to agents and isn't any more, so the moved meetings stay out of their reach. */
  keepsTarget: boolean;
}

/**
 * Where a deleted project's `meetings` go, and which projects agents may reach afterwards.
 * They go to General (or the first other project), unless the deleted project was kept from
 * agents: then they go to another project kept from agents (General first), and when every
 * other project is open to agents, General is kept from them too. Null when there is no
 * other project to move them to.
 */
export function projectDeletion(projects: ProjectRef[], id: string, agentProjects: string[] | null, meetings: number): ProjectDeletion | null {
  const others = projects.filter((p) => p.id !== id);
  const first = (list: ProjectRef[]) => list.find((p) => p.name === "General") ?? list[0];
  if (!others.length) return null;
  if (agentProjects === null) return { target: first(others), agentProjects: null, keepsTarget: false };
  const open = agentProjects.filter((x) => x !== id);
  if (agentProjects.includes(id) || meetings === 0) return { target: first(others), agentProjects: open, keepsTarget: false };
  const kept = others.filter((p) => !open.includes(p.id));
  if (kept.length) return { target: first(kept), agentProjects: open, keepsTarget: false };
  const target = first(others);
  return { target, agentProjects: open.filter((x) => x !== target.id), keepsTarget: true };
}
