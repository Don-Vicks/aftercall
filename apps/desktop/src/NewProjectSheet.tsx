import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, FolderGit2, Info, Lock } from "lucide-react";
import {
  BRIEF_TEMPLATES,
  briefFromGithub,
  briefTemplate,
  draftBrief,
  emptyDraft,
  parseRepoInput,
  seenFrom,
  withGithub,
  withTemplate,
  type BriefDraft,
  type BriefSource,
  type BriefTemplateId,
  type GithubRepoDetails,
  type GithubSuggestion,
  type ProjectBrief,
} from "@aftercall/core";
import { BriefReview } from "./BriefReview";
import { GITHUB_PRIVACY, githubApi } from "./github";
import { Button, Dialog, Field, Input, Pill, Spinner, cx, toast } from "./ui";

const NAME_MAX = 60;

/** A name as it's saved: single spaces, trimmed. */
const tidy = (name: string) => name.replace(/\s+/g, " ").trim();

function Kbd({ children }: { children: string }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] bg-well px-[5px] font-mono text-[11px] text-ink-2 shadow-[inset_0_0_0_1px_var(--hairline)]">{children}</kbd>;
}

/** The name field with its live check: "Available", or the project you already have. */
function NameField({
  name,
  setName,
  taken,
  onEnter,
  autoFocus,
  hint = "Its name also helps transcription spell it right.",
}: {
  name: string;
  setName: (n: string) => void;
  taken: string | undefined;
  onEnter?: () => void;
  autoFocus?: boolean;
  hint?: string;
}) {
  const clean = tidy(name);
  const length = Array.from(name).length;
  return (
    <Field label="Name" hint={hint} error={taken ? `You already have a project called “${taken}”.` : undefined}>
      <div className="relative">
        <Input
          autoFocus={autoFocus}
          value={name}
          maxLength={NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.metaKey || !onEnter) return;
            // Otherwise the same Enter lands as a new line in the next step's first field.
            e.preventDefault();
            onEnter();
          }}
          placeholder="Fundraise"
          className="pr-[120px]"
        />
        <span className="pointer-events-none absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-2 text-[12px]">
          {length >= 50 && (
            <span className="font-mono text-muted tabular-nums">
              {length}/{NAME_MAX}
            </span>
          )}
          {clean && !taken && (
            <span className="inline-flex items-center gap-1 font-semibold text-verdigris">
              <Check size={13} strokeWidth={2.5} aria-hidden="true" />
              Available
            </span>
          )}
        </span>
      </div>
    </Field>
  );
}

/** "Start from": the templates as radio chips; arrow keys move between them. */
function TemplateChips({ value, onChange }: { value: BriefTemplateId; onChange: (id: BriefTemplateId) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (e: KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + BRIEF_TEMPLATES.length) % BRIEF_TEMPLATES.length;
    onChange(BRIEF_TEMPLATES[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-labelledby="start-from" className="flex flex-wrap gap-1.5">
      {BRIEF_TEMPLATES.map((t, i) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => move(e, i)}
            className={cx(
              "press inline-flex h-8 items-center rounded-full px-3.5 text-[13px] font-medium transition-[box-shadow,color,background-color] duration-[var(--dur-1)]",
              on ? "bg-verdigris-tint text-verdigris shadow-[inset_0_0_0_1.5px_var(--verdigris)]" : "bg-well text-ink-2 shadow-[inset_0_0_0_1px_var(--hairline)] hover:text-ink",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

type Step = "start" | "github" | "review";
type Found = { details: GithubRepoDetails; suggestion: GithubSuggestion };

/**
 * New project: a name and where to start from (a template, and GitHub), then the
 * GitHub step if picked, then "Review your brief". Blank and Enter still creates the
 * project at once. Renaming is the name alone. Nothing is saved until Create.
 */
export function NewProjectSheet({
  existing,
  initial,
  payees = [],
  onClose,
  onCreate,
}: {
  existing: string[];
  /** Set when renaming. */
  initial?: string;
  /** Payee names, for the preview of Whisper's spelling prompt. */
  payees?: string[];
  onClose: () => void;
  onCreate: (name: string, brief?: ProjectBrief, source?: BriefSource) => void | Promise<void>;
}) {
  const [name, setName] = useState(initial ?? "");
  const [step, setStep] = useState<Step>("start");
  const [template, setTemplate] = useState<BriefTemplateId>("blank");
  const [fromGithub, setFromGithub] = useState(false);
  const [draft, setDraft] = useState<BriefDraft>(emptyDraft);
  const [found, setFound] = useState<Found | null>(null);
  const [busy, setBusy] = useState(false);
  const renaming = initial !== undefined;

  const clean = tidy(name);
  const taken = clean.toLowerCase() !== (initial ?? "").toLowerCase() ? existing.find((n) => n.toLowerCase() === clean.toLowerCase()) : undefined;
  const unchanged = renaming && clean === initial;
  const nameOk = clean.length > 0 && !taken && !unchanged;
  const blank = template === "blank" && !fromGithub;

  const finish = async (brief?: ProjectBrief, source?: BriefSource) => {
    if (busy) return;
    setBusy(true);
    try {
      await onCreate(clean, brief, brief ? source : undefined);
    } catch (e) {
      // Only on failure: on success the sheet is already leaving, and a render now would restart its exit.
      setBusy(false);
      toast({ text: `Couldn't save the project: ${e instanceof Error ? e.message : String(e)}`, tone: "record" });
    }
  };

  if (renaming) {
    return (
      <Dialog title="Rename project" intro="Its meetings move with it." onClose={onClose}>
        <NameField autoFocus name={name} setName={setName} taken={taken} onEnter={() => nameOk && void finish()} />
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted">
            <Kbd>↵</Kbd> to rename
          </span>
          <span className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!nameOk} loading={busy} onClick={() => finish()}>
              Rename
            </Button>
          </span>
        </div>
      </Dialog>
    );
  }

  const pickTemplate = (id: BriefTemplateId) => {
    setTemplate(id);
    setDraft((d) => withTemplate(d, id));
  };

  // A repo is used only while GitHub is picked: turning it off takes its items back.
  const toggleGithub = () => {
    if (fromGithub && found) {
      setDraft((d) => ({ ...d, about: d.about.origin === "github" ? emptyDraft().about : d.about, people: d.people.filter((p) => p.origin !== "github"), words: d.words.filter((w) => w.origin !== "github") }));
      setFound(null);
    }
    setFromGithub((v) => !v);
  };

  const create = () => {
    if (!nameOk) return;
    const s = fromGithub ? found?.suggestion : undefined;
    const source: BriefSource | undefined = s ? { kind: "github", repo: s.repo, fetchedAt: Math.floor(Date.now() / 1000), seen: seenFrom(s) } : undefined;
    void finish(draftBrief(draft), source);
  };

  if (step === "github") {
    return (
      <Dialog title="Fill from GitHub" intro="Its description, topics, README and contributors, for you to check before anything is saved." onClose={onClose}>
        <GithubStep
          onBack={() => setStep("start")}
          found={found}
          onFound={(f) => {
            setFound(f);
            setDraft((d) => withGithub(d, f.suggestion));
            if (!clean) setName(f.suggestion.name);
          }}
          onNext={() => setStep("review")}
        />
      </Dialog>
    );
  }

  if (step === "review") {
    const t = briefTemplate(template);
    const suggested = found && clean === found.suggestion.name;
    return (
      <Dialog title="Review your brief" intro="Untick anything that’s wrong. Nothing is saved until you create the project." onClose={onClose} width={640}>
        <div
          className="flex flex-col gap-5"
          style={{ animation: "ac-in 240ms var(--ease) both" }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.metaKey) {
              e.preventDefault();
              create();
            }
          }}
        >
          <NameField
            name={name}
            setName={setName}
            taken={taken}
            hint={suggested ? `From ${found.suggestion.repo}. Its name also helps transcription spell it right.` : undefined}
          />
          <BriefReview draft={draft} onChange={setDraft} project={clean} payees={payees} templateLabel={t.id === "blank" ? undefined : t.label} aboutHint={t.aboutHint} />
        </div>
        <div className="flex items-center justify-between gap-3 pt-1">
          <Button variant="quiet" onClick={() => setStep(fromGithub ? "github" : "start")}>
            Back
          </Button>
          <span className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 text-xs text-muted" aria-hidden="true">
              <Kbd>⌘</Kbd>
              <Kbd>↵</Kbd>
            </span>
            <Button variant="primary" loading={busy} disabled={!nameOk} onClick={create}>
              Create project
            </Button>
          </span>
        </div>
      </Dialog>
    );
  }

  // GitHub can suggest the name, so it may be left empty; otherwise a name comes first.
  const canGo = blank ? nameOk : fromGithub ? !taken && !unchanged : nameOk;
  const next = () => {
    if (!canGo) return;
    if (blank) void finish();
    else setStep(fromGithub ? "github" : "review");
  };

  return (
    <Dialog title="New project" intro="What a set of meetings is about, like a client, a fundraise or a hire." onClose={onClose}>
      <div className="flex flex-col gap-5">
        <NameField autoFocus name={name} setName={setName} taken={taken} onEnter={next} />
        <div className="flex flex-col gap-2">
          <span id="start-from" className="text-[13px] leading-[18px] font-semibold text-ink">
            Start from
          </span>
          <TemplateChips value={template} onChange={pickTemplate} />
          <span className="text-[13px] leading-[18px] text-ink-2">
            {template === "blank"
              ? "An empty brief. You can add one now or later, on the project’s page."
              : `Fills what to watch for, roles to name and a few ${briefTemplate(template).label.toLowerCase()} words. Never names or facts.`}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] leading-[18px] font-semibold text-ink">Or fill the brief from</span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={fromGithub}
              onClick={toggleGithub}
              className={cx(
                "press inline-flex h-9 items-center gap-2 rounded-sm px-3 text-[13px] font-medium transition-[box-shadow,color,background-color] duration-[var(--dur-1)]",
                fromGithub ? "bg-verdigris-tint text-verdigris shadow-[inset_0_0_0_1.5px_var(--verdigris)]" : "text-ink-2 shadow-[inset_0_0_0_1px_var(--border)] hover:bg-elevated hover:text-ink",
              )}
            >
              {fromGithub ? <Check size={14} strokeWidth={2.5} aria-hidden="true" /> : <FolderGit2 size={14} aria-hidden="true" />}
              GitHub repo
            </button>
          </div>
        </div>
        <p className="m-0 flex items-start gap-1.5 border-t border-hairline pt-4 text-xs text-muted">
          <Lock size={12} strokeWidth={2} aria-hidden="true" className="mt-[2px] shrink-0" />
          <span>Kept on this Mac, encrypted. None of it leaves the Mac until you record a meeting in it.</span>
        </p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <Kbd>↵</Kbd> to {blank ? "create" : "continue"}
        </span>
        <span className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canGo} loading={busy} onClick={next}>
            {blank ? "Create project" : "Continue"}
          </Button>
        </span>
      </div>
    </Dialog>
  );
}

/** The GitHub step: paste a repo, look it up, see what was found. */
function GithubStep({ onBack, found, onFound, onNext }: { onBack: () => void; found: Found | null; onFound: (f: Found) => void; onNext: () => void }) {
  const [input, setInput] = useState(found?.details.repo ?? "");
  const [cli, setCli] = useState<boolean | null>(null);
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(0);

  useEffect(() => {
    githubApi.cli().then(setCli, () => setCli(false));
  }, []);

  const lookUp = async (text = input) => {
    const repo = parseRepoInput(text);
    if (!repo) {
      setError("That isn’t a GitHub repo. Paste its address, like github.com/owner/name.");
      return;
    }
    const n = ++asked.current;
    setLooking(true);
    setError(null);
    try {
      const details = await githubApi.repo(repo);
      if (n !== asked.current) return;
      onFound({ details, suggestion: briefFromGithub(details) });
    } catch (e) {
      if (n !== asked.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (n === asked.current) setLooking(false);
    }
  };

  const same = found && parseRepoInput(input)?.toLowerCase() === found.details.repo.toLowerCase();

  return (
    <>
      <div className="flex flex-col gap-4" style={{ animation: "ac-in 240ms var(--ease) both" }}>
        <Field
          label="Repository"
          error={error ?? undefined}
          hint={cli === null ? "Looking for GitHub CLI…" : cli ? "GitHub CLI found: private repos work when you’re signed in to it." : "No GitHub CLI found: public repos only, up to 60 lookups an hour."}
        >
          <div className="flex gap-2">
            <Input
              autoFocus
              mono
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                if (parseRepoInput(text)) setTimeout(() => void lookUp(text), 0);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (same && !looking) onNext();
                else void lookUp();
              }}
              placeholder="github.com/owner/name"
            />
            <Button onClick={() => lookUp()} loading={looking} disabled={!input.trim()}>
              Look up
            </Button>
          </div>
        </Field>

        {looking && !found && (
          <p className="m-0 flex items-center gap-2 text-[13px] text-ink-2" aria-live="polite">
            <Spinner size={12} tone="current" /> Asking GitHub…
          </p>
        )}

        {found && (
          <div
            key={found.details.repo}
            className={cx("flex flex-col gap-2 rounded-md bg-raised px-4 py-3 shadow-1 transition-opacity duration-[var(--dur-2)]", looking && "opacity-60")}
            style={{ animation: "ac-in 240ms var(--ease) both" }}
            aria-live="polite"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] text-ink">{found.details.repo}</span>
              <Pill tone="muted">{found.details.private ? "Private" : "Public"}</Pill>
              {found.details.language && <span className="text-[13px] text-muted">{found.details.language}</span>}
            </div>
            {found.suggestion.about ? (
              <p className="m-0 text-ink">{found.suggestion.about}</p>
            ) : (
              <p className="m-0 text-[13px] text-muted">No description or README paragraph to use as About.</p>
            )}
            <p className="m-0 text-[13px] text-muted">
              {[
                found.suggestion.aboutFrom === "readme" ? "About from the README" : null,
                `${found.suggestion.people.length} ${found.suggestion.people.length === 1 ? "person" : "people"}`,
                `${found.suggestion.words.length} ${found.suggestion.words.length === 1 ? "word" : "words"}`,
                found.details.via === "gh" ? "looked up with GitHub CLI" : "looked up without signing in",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        )}

        <p className="m-0 flex items-start gap-1.5 text-xs text-muted">
          <Info size={12} strokeWidth={2} aria-hidden="true" className="mt-[2px] shrink-0" />
          <span>{GITHUB_PRIVACY}</span>
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 pt-1">
        <Button variant="quiet" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" disabled={!found || looking} onClick={onNext}>
          Review brief
        </Button>
      </div>
    </>
  );
}
