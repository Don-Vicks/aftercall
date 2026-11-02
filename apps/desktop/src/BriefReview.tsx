import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Lock, Plus, X } from "lucide-react";
import {
  BRIEF_LIMITS,
  addWords,
  briefBlock,
  draftBrief,
  draftLimits,
  fieldOrigins,
  newPerson,
  parseBriefPeople,
  parseBriefWords,
  personIn,
  whisperVocabulary,
  type BriefDraft,
  type BriefField,
  type DraftOrigin,
  type DraftPerson,
  type DraftText,
} from "@aftercall/core";
import { Avatar, Button, IconButton, Input, TextArea, Tick, cx } from "./ui";

/** Where a brief goes, said under the card and the review. `words`: how many go with the audio. */
export function BriefPrivacy({ className, project, words }: { className?: string; project?: string; words?: number }) {
  const withAudio =
    words === undefined ? "; words to expect also go with the audio." : words === 0 ? "." : `; its ${words} ${words === 1 ? "word" : "words"} to expect also go with the audio.`;
  return (
    <p className={cx("m-0 flex items-start gap-1.5 text-xs text-muted", className)}>
      <Lock size={12} strokeWidth={2} aria-hidden="true" className="mt-[2px] shrink-0" />
      <span>
        Kept on this Mac, encrypted. NEAR AI gets it only end-to-end encrypted, with {project ? `${project}’s` : "this project’s"} meetings{withAudio}
      </span>
    </p>
  );
}

const ORIGIN_LABEL: Record<DraftOrigin, string> = { github: "GitHub", template: "template", you: "you" };

/** "from GitHub · you", in Geist Mono. */
function OriginBadge({ origins, template }: { origins: DraftOrigin[]; template?: string }) {
  if (!origins.length) return null;
  const label = origins.map((o) => (o === "template" && template ? `${template} template` : ORIGIN_LABEL[o])).join(" · ");
  return <span className="font-mono text-[11px] leading-4 text-muted">from {label}</span>;
}

function FieldHead({ id, label, origins, template, count, control = true }: { id: string; label: string; origins: DraftOrigin[]; template?: string; count?: ReactNode; control?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <label id={`${id}-label`} htmlFor={control ? id : undefined} className="text-[13px] leading-[18px] font-semibold text-ink">
        {label}
      </label>
      <span className="flex items-baseline gap-2.5">
        <OriginBadge origins={origins} template={template} />
        {count !== undefined && <span className="font-mono text-[11px] leading-4 text-muted tabular-nums">{count}</span>}
      </span>
    </div>
  );
}

/** About and What to watch for: the text, and a "Use this" tick when it came from a source. */
function TextField({
  label,
  value,
  max,
  placeholder,
  hint,
  origins,
  template,
  autoFocus,
  onChange,
}: {
  label: string;
  value: DraftText;
  max: number;
  placeholder: string;
  hint: string;
  origins: DraftOrigin[];
  template?: string;
  autoFocus?: boolean;
  onChange: (t: DraftText) => void;
}) {
  const id = useId();
  const length = Array.from(value.text).length;
  const sourced = value.origin !== "you" && value.text.trim().length > 0;
  return (
    <div className="flex flex-col gap-1.5">
      <FieldHead id={id} label={label} origins={origins} template={template} count={length > max * 0.8 ? `${length}/${max}` : undefined} />
      <TextArea
        id={id}
        autoFocus={autoFocus}
        rows={2}
        maxLength={max}
        value={value.text}
        // Typing makes it yours, and in.
        onChange={(e) => onChange({ text: e.target.value, origin: "you", on: true })}
        placeholder={placeholder}
        aria-describedby={`${id}-hint`}
        className={cx(sourced && !value.on && "opacity-50")}
      />
      {(sourced || value.note || value.alt) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          {sourced && (
            <span className="inline-flex items-center gap-2">
              <Tick size={18} checked={value.on} onChange={(on) => onChange({ ...value, on })} aria-label={`Use this ${label.toLowerCase()}`} />
              <span className="text-ink-2">Use this</span>
            </span>
          )}
          {value.note && <span className="font-mono text-[11px] text-muted">{value.note}</span>}
          {value.alt && (
            <button className="font-semibold text-verdigris hover:text-verdigris-hover" onClick={() => onChange({ text: value.alt!, origin: "github", on: true })}>
              Use GitHub’s instead
            </button>
          )}
        </div>
      )}
      <span id={`${id}-hint`} className="text-[13px] leading-[18px] text-ink-2">
        {hint}
      </span>
    </div>
  );
}

function PersonRow({
  person,
  over,
  focus,
  onChange,
  onRemove,
  onPasteMany,
}: {
  person: DraftPerson;
  over: boolean;
  focus: boolean;
  onChange: (p: DraftPerson) => void;
  onRemove: () => void;
  onPasteMany: (text: string) => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focus) nameRef.current?.focus();
  }, [focus]);
  const named = person.name.trim().length > 0;
  const dim = !person.on || !named || over;
  const label = named ? person.name : person.role ? `the ${person.role}` : "this person";
  // Editing a name or role makes the row yours.
  const edit = (patch: Partial<DraftPerson>) => onChange({ ...person, ...patch, origin: "you", on: true });
  return (
    <li className="flex flex-col gap-1" style={{ animation: "ac-in 200ms var(--ease) both" }}>
      <div className="flex items-center gap-2.5">
        {named ? (
          <Tick size={20} checked={person.on} onChange={(on) => onChange({ ...person, on })} aria-label={`Include ${label}`} />
        ) : (
          // A role slot waiting for a name: nothing to tick yet.
          <span aria-hidden="true" className="size-5 shrink-0" />
        )}
        <span className={cx("shrink-0", dim && "opacity-50")}>
          {named ? (
            <Avatar name={person.name} size={24} decorative />
          ) : (
            <span aria-hidden="true" className="block size-6 rounded-full border-[1.5px] border-dashed border-border" />
          )}
        </span>
        <Input
          ref={nameRef}
          aria-label={person.role ? `Name of the ${person.role}` : "Name"}
          value={person.name}
          maxLength={BRIEF_LIMITS.name}
          placeholder="Name"
          onChange={(e) => edit({ name: e.target.value })}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (!/\n/.test(text.trim())) return;
            e.preventDefault();
            onPasteMany(text);
          }}
          className={cx("flex-[1.1]", dim && "opacity-60")}
        />
        <Input
          aria-label={`Role of ${label}`}
          value={person.role}
          maxLength={BRIEF_LIMITS.role}
          placeholder="Role (optional)"
          onChange={(e) => edit({ role: e.target.value })}
          className={cx("flex-1", dim && "opacity-60")}
        />
        <IconButton size="sm" variant="quiet" aria-label={`Remove ${label}`} onClick={onRemove}>
          <X size={14} />
        </IconButton>
      </div>
      {(person.note || over) && (
        <span className="pl-[64px] font-mono text-[11px] text-muted">{over ? `Only the first ${BRIEF_LIMITS.people} people are kept` : person.note}</span>
      )}
    </li>
  );
}

function Words({ draft, onChange, id, over }: { draft: BriefDraft; onChange: (d: BriefDraft) => void; id: string; over: Set<string> }) {
  const [typed, setTyped] = useState("");
  const commit = (text: string) => {
    const list = parseBriefWords(text);
    if (list.length) onChange(addWords(draft, list));
    setTyped("");
  };
  const set = (i: number, on: boolean) => onChange({ ...draft, words: draft.words.map((w, j) => (j === i ? { ...w, on } : w)) });
  const remove = (i: number) => onChange({ ...draft, words: draft.words.filter((_, j) => j !== i) });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {draft.words.map((w, i) =>
        w.on ? (
          <span
            key={`${w.word}-${i}`}
            className={cx(
              "selectable inline-flex h-7 items-center gap-1 rounded-full bg-well pr-1 pl-2.5 text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--hairline)]",
              over.has(w.word.toLowerCase()) && "text-muted line-through opacity-60",
            )}
            title={over.has(w.word.toLowerCase()) ? `Only the first ${BRIEF_LIMITS.words} words are kept` : w.origin === "you" ? undefined : `From ${ORIGIN_LABEL[w.origin]}`}
          >
            {w.word}
            {w.note === "New on GitHub" && <span className="font-mono text-[10px] text-muted">new</span>}
            {w.note === "Not on GitHub now" && <span className="font-mono text-[10px] text-muted">gone</span>}
            <button
              aria-label={`Remove ${w.word}`}
              // A word you typed goes; a suggested one stays as an unticked chip you can add back.
              onClick={() => (w.origin === "you" ? remove(i) : set(i, false))}
              className="press inline-flex size-5 items-center justify-center rounded-full text-muted hover:bg-elevated hover:text-ink"
            >
              <X size={12} strokeWidth={2.25} />
            </button>
          </span>
        ) : (
          <button
            key={`${w.word}-${i}`}
            aria-label={`Add back ${w.word}`}
            onClick={() => set(i, true)}
            className="press inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-border px-2.5 text-[13px] text-muted hover:text-ink"
          >
            <Plus size={12} strokeWidth={2.25} aria-hidden="true" />
            {w.word}
          </button>
        ),
      )}
      <input
        id={id}
        value={typed}
        maxLength={BRIEF_LIMITS.word * 4}
        onChange={(e) => (/[,\n]/.test(e.target.value) ? commit(e.target.value) : setTyped(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.metaKey) {
            e.preventDefault();
            commit(typed);
          } else if (e.key === "Backspace" && !typed) {
            const last = draft.words.map((w, i) => ({ w, i })).filter(({ w }) => w.on).pop();
            if (last) last.w.origin === "you" ? remove(last.i) : set(last.i, false);
          }
        }}
        onBlur={() => typed.trim() && commit(typed)}
        placeholder={draft.words.length ? "Add a word" : "Moonbeam, booking flow, Stripe"}
        className="selectable h-7 min-w-[150px] flex-1 rounded-full bg-transparent px-2.5 text-[13px] text-ink outline-none placeholder:text-muted focus-visible:shadow-[inset_0_0_0_1px_var(--border)]"
      />
    </div>
  );
}

/**
 * Review (and edit) a brief: each field says where it came from, items copied from a
 * source arrive ticked, people are rows and words are chips, the limits show as you go,
 * and a collapsed preview shows exactly what NEAR AI and Whisper would get. Saves nothing:
 * the sheet's or card's button does.
 */
export function BriefReview({
  draft,
  onChange,
  project,
  payees,
  templateLabel,
  aboutHint,
  changes,
  autoFocus,
}: {
  draft: BriefDraft;
  onChange: (d: BriefDraft) => void;
  /** The project's name: the first of Whisper's words, and the privacy line. */
  project: string;
  /** Payee names: Whisper gets them after the project's. */
  payees: string[];
  /** "Client project", for "from Client project template". */
  templateLabel?: string;
  aboutHint?: string;
  /** On Refresh: what changed on GitHub. */
  changes?: string[];
  autoFocus?: boolean;
}) {
  const ids = { people: useId(), words: useId() };
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const brief = draftBrief(draft);
  const limits = draftLimits(draft);
  // "from you" says something only next to fields that came from somewhere else.
  const anySourced = (["about", "people", "words", "watchFor"] as const).some((f) => fieldOrigins(draft, f).some((o) => o !== "you"));
  const origins = (f: BriefField) => {
    const list = fieldOrigins(draft, f);
    return anySourced ? list : list.filter((o) => o !== "you");
  };
  const block = briefBlock(brief).trim();
  const whisper = whisperVocabulary([project || "(project name)", ...payees], brief?.words);
  const unnamed = draft.people.some((p) => p.on && !p.name.trim());

  const setPerson = (key: string, p: DraftPerson) => onChange({ ...draft, people: draft.people.map((x) => (x.key === key ? p : x)) });
  const pasteMany = (key: string, text: string) => {
    const rows = parseBriefPeople(text).map((p) => newPerson(p.name, p.role ?? ""));
    if (!rows.length) return;
    const i = draft.people.findIndex((x) => x.key === key);
    const people = [...draft.people];
    people.splice(i, 1, ...rows);
    onChange({ ...draft, people });
  };
  const addPerson = () => {
    const p = newPerson();
    onChange({ ...draft, people: [...draft.people, p] });
    setFocusKey(p.key);
  };

  return (
    <div className="flex flex-col gap-5">
      {changes && changes.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md bg-well px-4 py-3 shadow-[inset_0_0_0_1px_var(--hairline)]" role="status">
          <span className="text-[13px] font-semibold text-ink">What changed on GitHub</span>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[13px] text-ink-2">
            {changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <TextField
        label="About"
        value={draft.about}
        max={BRIEF_LIMITS.about}
        placeholder={aboutHint || "Rebuilding Moonbeam Bikes’ website: new booking flow, launch in March"}
        hint="What this project is, in a sentence or two."
        origins={origins("about")}
        template={templateLabel}
        autoFocus={autoFocus}
        onChange={(about) => onChange({ ...draft, about })}
      />

      <div className="flex flex-col gap-2">
        <FieldHead id={ids.people} control={false} label="People" origins={origins("people")} template={templateLabel} count={`${limits.people} of ${BRIEF_LIMITS.people}`} />
        {draft.people.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-labelledby={`${ids.people}-label`}>
            {draft.people.map((p) => (
              <PersonRow
                key={p.key}
                person={p}
                over={limits.peopleOver.has(p.key)}
                focus={focusKey === p.key}
                onChange={(next) => setPerson(p.key, next)}
                onRemove={() => onChange({ ...draft, people: draft.people.filter((x) => x.key !== p.key) })}
                onPasteMany={(text) => pasteMany(p.key, text)}
              />
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="quiet" size="sm" className="-ml-2" icon={<Plus size={14} />} onClick={addPerson}>
            Add person
          </Button>
          {unnamed && <span className="text-[13px] text-muted">Rows without a name are left out.</span>}
        </div>
        <span className="text-[13px] leading-[18px] text-ink-2">Who’s who. Helps name who spoke and who owns what. Paste “Name — role” lines to add several.</span>
      </div>

      <div className="flex flex-col gap-2">
        <FieldHead id={ids.words} label="Words to expect" origins={origins("words")} template={templateLabel} count={`${limits.words} of ${BRIEF_LIMITS.words}`} />
        <Words draft={draft} onChange={onChange} id={ids.words} over={limits.wordsOver} />
        <span className="text-[13px] leading-[18px] text-ink-2">
          Names, product terms, jargon. Sent with the audio to help spelling. Enter or a comma adds one.
          {limits.wordsOver.size > 0 && ` Only the first ${BRIEF_LIMITS.words} are kept.`}
        </span>
      </div>

      <TextField
        label="What to watch for"
        value={draft.watchFor}
        max={BRIEF_LIMITS.watchFor}
        placeholder="Pricing decisions, deadlines, anything about the March launch"
        hint="What counts as a decision or action item. Each still needs words said on the call."
        origins={origins("watchFor")}
        template={templateLabel}
        onChange={(watchFor) => onChange({ ...draft, watchFor })}
      />

      <details className="group rounded-md bg-well shadow-[inset_0_0_0_1px_var(--hairline)]">
        <summary className="flex cursor-default list-none items-center gap-1.5 rounded-md px-4 py-3 text-[13px] font-semibold text-ink select-none [&::-webkit-details-marker]:hidden">
          <ChevronRight size={14} aria-hidden="true" className="text-muted transition-transform duration-[var(--dur-1)] group-open:rotate-90" />
          What NEAR AI gets with each meeting
          <span className="ml-auto font-mono text-[11px] font-normal text-muted">preview</span>
        </summary>
        <div className="flex flex-col gap-3 px-4 pb-4">
          <span className="text-[13px] text-ink-2">Inside the end-to-end encrypted notes request, word for word:</span>
          {block ? (
            <pre className="selectable m-0 max-h-[300px] overflow-auto rounded-sm bg-raised px-3 py-2.5 font-mono text-[12px] leading-[18px] whitespace-pre-wrap text-ink shadow-[inset_0_0_0_1px_var(--hairline)]">
              {block}
            </pre>
          ) : (
            <p className="m-0 text-[13px] text-muted">Nothing: without a brief, the notes request is exactly as it would be without one.</p>
          )}
          <span className="text-[13px] text-ink-2">Whisper’s spelling prompt, sent with the audio over TLS:</span>
          <p className="selectable m-0 font-mono text-[12px] leading-[18px] text-ink">{whisper.join(", ")}</p>
          <span className="text-xs text-muted">Ask your meetings gets About, People and Words too (not What to watch for). Where the brief came from never goes anywhere.</span>
        </div>
      </details>

      <BriefPrivacy project={project || undefined} words={brief?.words?.length ?? 0} />
    </div>
  );
}

/** True when the review has nothing in it (no named person, no word, no text). */
export const draftIsEmpty = (d: BriefDraft) => !d.about.text.trim() && !d.watchFor.text.trim() && !d.words.some((w) => w.on) && !d.people.some(personIn);
