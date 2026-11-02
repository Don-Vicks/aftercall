import { useState } from "react";
import { Lock } from "lucide-react";
import { BRIEF_LIMITS, briefPeopleText, cleanBrief, parseBriefPeople, parseBriefWords, type ProjectBrief } from "@aftercall/core";
import { Button, Dialog, Field, Input, TextArea, cx, toast } from "./ui";

/** The brief as it's typed: one string per field. */
export interface BriefDraft {
  about: string;
  people: string;
  words: string;
  watchFor: string;
}

export const draftFromBrief = (b: ProjectBrief | undefined): BriefDraft => ({
  about: b?.about ?? "",
  people: briefPeopleText(b?.people),
  words: (b?.words ?? []).join(", "),
  watchFor: b?.watchFor ?? "",
});

/** What gets saved: trimmed, capped and without repeats (`cleanBrief`); undefined when empty. */
export const briefFromDraft = (d: BriefDraft): ProjectBrief | undefined =>
  cleanBrief({ about: d.about, people: parseBriefPeople(d.people), words: parseBriefWords(d.words), watchFor: d.watchFor });

/** Where a brief goes, said once under the form and the card. */
export function BriefPrivacy({ className }: { className?: string }) {
  return (
    <p className={cx("m-0 flex items-start gap-1.5 text-xs text-muted", className)}>
      <Lock size={12} strokeWidth={2} aria-hidden="true" className="mt-[2px] shrink-0" />
      <span>Kept on this Mac, encrypted. NEAR AI gets it only end-to-end encrypted, with this project’s meetings; words to expect also go with the audio.</span>
    </p>
  );
}

/** The four brief fields, short and guided. Used when creating a project and on its page. */
export function BriefFields({ draft, onChange, autoFocus }: { draft: BriefDraft; onChange: (d: BriefDraft) => void; autoFocus?: boolean }) {
  const set = (k: keyof BriefDraft) => (e: { target: { value: string } }) => onChange({ ...draft, [k]: e.target.value });
  const people = parseBriefPeople(draft.people).length;
  const words = parseBriefWords(draft.words).length;
  return (
    <div className="flex flex-col gap-3.5">
      <Field label="About" hint="What this project is, in a sentence or two.">
        <TextArea
          autoFocus={autoFocus}
          rows={2}
          maxLength={BRIEF_LIMITS.about}
          value={draft.about}
          onChange={set("about")}
          placeholder="Rebuilding Moonbeam Bikes’ website: new booking flow, launch in March"
        />
      </Field>
      <Field
        label="People"
        hint="One per line, with their role. Helps name who spoke and who owns what."
        error={people > BRIEF_LIMITS.people ? `Only the first ${BRIEF_LIMITS.people} people are kept.` : undefined}
      >
        <TextArea rows={3} value={draft.people} onChange={set("people")} placeholder={"Olamide — client, product lead\nJohn — designer"} />
      </Field>
      <Field
        label="Words to expect"
        hint="Names, product terms, jargon. Sent with the audio to help spelling."
        error={words > BRIEF_LIMITS.words ? `Only the first ${BRIEF_LIMITS.words} words are kept.` : undefined}
      >
        <Input value={draft.words} onChange={set("words")} placeholder="Moonbeam, booking flow, Stripe" />
      </Field>
      <Field label="What to watch for" hint="What counts as a decision or action item. Each still needs words said on the call.">
        <TextArea
          rows={2}
          maxLength={BRIEF_LIMITS.watchFor}
          value={draft.watchFor}
          onChange={set("watchFor")}
          placeholder="Pricing decisions, deadlines, anything about the March launch"
        />
      </Field>
    </div>
  );
}

const EMPTY: BriefDraft = { about: "", people: "", words: "", watchFor: "" };

/**
 * Names a project, then (if you like) its brief: two calm steps, the second one
 * skippable. Renaming is the first step alone. Its name also helps transcription spell it right.
 */
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
  onCreate: (name: string, brief?: ProjectBrief) => void | Promise<void>;
}) {
  const [name, setName] = useState(initial ?? "");
  const [step, setStep] = useState<"name" | "brief">("name");
  const [draft, setDraft] = useState<BriefDraft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const clean = name.trim();
  const taken = clean.toLowerCase() !== (initial ?? "").toLowerCase() && existing.some((n) => n.toLowerCase() === clean.toLowerCase());
  const unchanged = initial !== undefined && clean === initial;
  const ok = clean.length > 0 && !taken && !unchanged;
  const renaming = initial !== undefined;

  const finish = async (brief?: ProjectBrief) => {
    if (busy) return;
    setBusy(true);
    try {
      await onCreate(clean, brief);
    } catch (e) {
      // Only on failure: on success the sheet is already leaving, and a render now would restart its exit.
      setBusy(false);
      toast({ text: `Couldn't save the project: ${e instanceof Error ? e.message : String(e)}`, tone: "record" });
    }
  };
  const next = () => (renaming ? void finish() : setStep("brief"));

  if (step === "brief") {
    const brief = briefFromDraft(draft);
    return (
      <Dialog title={`What is ${clean} about?`} intro="All optional. It helps the notes get names, terms and what matters right." onClose={onClose}>
        <div className="flex flex-col gap-5" style={{ animation: "ac-in 240ms var(--ease) both" }}>
          <BriefFields draft={draft} onChange={setDraft} autoFocus />
          <BriefPrivacy />
        </div>
        <div className="flex items-center justify-between gap-3 pt-1">
          <Button variant="quiet" onClick={() => setStep("name")}>
            Back
          </Button>
          <span className="flex gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => finish()}>
              Skip for now
            </Button>
            <Button variant="primary" loading={busy} disabled={!brief} onClick={() => finish(brief)}>
              Create project
            </Button>
          </span>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={renaming ? "Rename project" : "New project"}
      intro={renaming ? "Its meetings move with it." : "What a set of meetings is about, like a client, a fundraise or a hire."}
      onClose={onClose}
    >
      <Field label="Name" hint="Its name also helps transcription spell it right." error={taken ? "You already have a project called that." : undefined}>
        <Input
          autoFocus
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !ok) return;
            // Otherwise the same Enter lands as a new line in the brief's first field.
            e.preventDefault();
            next();
          }}
          placeholder="Fundraise"
        />
      </Field>
      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] bg-well px-[5px] font-mono text-[11px] text-ink-2 shadow-[inset_0_0_0_1px_var(--hairline)]">↵</kbd>
          to {renaming ? "rename" : "continue"}
        </span>
        <span className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ok} loading={busy} onClick={next}>
            {renaming ? "Rename" : "Continue"}
          </Button>
        </span>
      </div>
    </Dialog>
  );
}
