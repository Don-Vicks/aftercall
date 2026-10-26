import { useState } from "react";
import { Sheet } from "./Sheet";
import { Button } from "./ui";

/** Names a project, or renames one. Its name also helps transcription spell it right. */
export function NewProjectSheet({
  existing,
  initial,
  onClose,
  onCreate,
}: {
  existing: string[];
  /** Set when renaming. */
  initial?: string;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState(initial ?? "");
  const clean = name.trim();
  const taken = clean.toLowerCase() !== (initial ?? "").toLowerCase() && existing.some((n) => n.toLowerCase() === clean.toLowerCase());
  const unchanged = initial !== undefined && clean === initial;
  const ok = clean.length > 0 && !taken && !unchanged;
  return (
    <Sheet
      title={initial ? "Rename project" : "New project"}
      intro={initial ? "Its meetings move with it." : "What a set of meetings is about, like a client, a fundraise or a hire. Its name helps transcription spell it right."}
      onClose={onClose}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="project-name" className="t-label text-muted">Name</label>
        <input
          id="project-name"
          autoFocus
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ok && onCreate(clean)}
          placeholder="Fundraise"
          className="selectable h-9 rounded-sm border border-border bg-well px-3 text-sm text-ink outline-none"
        />
        {taken && <span className="text-caution">You already have a project called that.</span>}
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ok} onClick={() => onCreate(clean)}>{initial ? "Rename" : "Create project"}</Button>
      </div>
    </Sheet>
  );
}
