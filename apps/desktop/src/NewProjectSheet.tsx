import { useState } from "react";
import { Sheet } from "./Sheet";
import { Button } from "./ui";

/** Names a project: what a set of meetings is about. Payees and names in it help transcription. */
export function NewProjectSheet({ existing, onClose, onCreate }: { existing: string[]; onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState("");
  const clean = name.trim();
  const taken = existing.some((n) => n.toLowerCase() === clean.toLowerCase());
  return (
    <Sheet title="New project" intro="What a set of meetings is about, like a client, a fundraise or a hire. Its name helps transcription spell it right." onClose={onClose}>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="project-name" className="t-label text-muted">Name</label>
        <input
          id="project-name"
          autoFocus
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && clean && !taken && onCreate(clean)}
          placeholder="Fundraise"
          className="selectable h-9 rounded-sm border border-border bg-well px-3 text-sm text-ink outline-none"
        />
        {taken && <span className="text-caution">You already have a project called that.</span>}
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!clean || taken} onClick={() => onCreate(clean)}>Create project</Button>
      </div>
    </Sheet>
  );
}
