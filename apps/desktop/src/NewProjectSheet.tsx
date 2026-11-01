import { useState } from "react";
import { Button, Dialog, Field, Input } from "./ui";

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
    <Dialog
      title={initial ? "Rename project" : "New project"}
      intro={initial ? "Its meetings move with it." : "What a set of meetings is about, like a client, a fundraise or a hire."}
      onClose={onClose}
    >
      <Field label="Name" hint="Its name also helps transcription spell it right." error={taken ? "You already have a project called that." : undefined}>
        <Input
          autoFocus
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ok && onCreate(clean)}
          placeholder="Fundraise"
        />
      </Field>
      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] bg-well px-[5px] font-mono text-[11px] text-ink-2 shadow-[inset_0_0_0_1px_var(--hairline)]">↵</kbd>
          to {initial ? "rename" : "create"}
        </span>
        <span className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ok} onClick={() => onCreate(clean)}>
            {initial ? "Rename" : "Create project"}
          </Button>
        </span>
      </div>
    </Dialog>
  );
}
