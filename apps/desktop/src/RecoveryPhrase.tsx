import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, type Variant } from "motion/react";
import * as m from "motion/react-m";
import { Archive, ArrowRight, Check, Copy, Download, KeyRound, Lock, Printer, ShieldAlert, X } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { recovery, restoredSummary, type RecoveryStatus, type Restored } from "./recovery";
import { KIT_KEEP, SCREEN_KEEP, appKit, kitDate, kitText, saveKit, syncedFolder, usePhraseClipboard, type KitAbout } from "./recoveryKit";
import { isDesktop } from "./recorder";
import { CheckCircle } from "./primitives/Check";
import { Button, Card, Dialog, Input, Pill, SectionTitle, Spinner, Tick, cx, exit, springs, toast, useConfirm } from "./ui";
import { CardRow, IconDisc, Why, errorText, rise } from "./SettingsParts";
import { QuietAction, StepActions } from "./Flow";
import { AssistantStep, BackButton } from "./SetupAssistant";

/** "01", "02" … as the boards number words. */
const nn = (n: number) => String(n).padStart(2, "0");

/**
 * A new phrase for this Mac, made once per visit to the phrase screens, and the
 * three positions to ask back: one from each third of the phrase. Nothing is
 * stored until the words are confirmed, and the phrase itself is never stored.
 */
export function useNewPhrase() {
  const [phrase, setPhrase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const words = useMemo(() => phrase?.split(" ") ?? [], [phrase]);
  const ask = useMemo(() => {
    const third = Math.floor(words.length / 3);
    return [0, 1, 2].map((i) => i * third + Math.floor(Math.random() * third));
  }, [words.length]);
  const load = () => {
    setError(null);
    recovery
      .newPhrase()
      .then(setPhrase)
      .catch((e) => setError(errorText(e)));
  };
  return { phrase, words, ask, error, load, forget: () => setPhrase(null) };
}

/**
 * What a phrase screen says, so the two phrases never look alike: Aftercall's own (this
 * Mac's limited key, the default) and a new NEAR account's (CreateAccount.tsx).
 */
export interface PhraseWords {
  icon: ReactNode;
  title: string;
  intro: ReactNode;
  /** Whose phrase this is, for screen readers ("NEAR wallet phrase"). */
  name: string;
  /** Over the words: whose phrase this is. */
  label: ReactNode;
  /** Under the words: what Aftercall does with them, and why offline. */
  notes: ReactNode;
  /** What a saved or printed recovery kit says (recoveryKit.ts). */
  kit: KitAbout;
}

/** Aftercall's own recovery phrase. `afterWallet` when a NEAR account's phrase was just written down too. */
export function appPhraseWords(count: number, afterWallet = false): PhraseWords {
  return {
    icon: <KeyRound size={22} strokeWidth={1.75} />,
    title: `Write these ${count} words down`,
    intro: afterWallet
      ? "A second phrase, and a different one: Aftercall's own, for this Mac's limited key. These words bring that key back on a new Mac. Write them on paper in order, or save a recovery kit."
      : "This Mac gets its own NEAR key for proofs and payments. These words bring it back on a new Mac. Write them on paper in order, or save a recovery kit.",
    name: "Aftercall recovery phrase",
    label: (
      <>
        Aftercall recovery phrase <span className="text-muted">· this Mac's key</span>
      </>
    ),
    notes: (
      <>
        <p className="m-0 flex items-center gap-2 text-[13px] leading-[18px] text-ink-2">
          <Lock size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-muted" />
          Aftercall never stores the phrase, so it can't show these words again.
        </p>
        <Why label="Why offline?">
          Paper and a USB drive can't be read over the internet; iCloud, email and chat can. A kit goes only where you save it. Copy is for pasting into a
          password manager: Aftercall clears the clipboard after 60 seconds, but a clipboard app may keep its own copy. Don't photograph the words.
        </Why>
      </>
    ),
    kit: appKit(),
  };
}

/** Step: the words, once, ways to keep them (paper, Copy, a saved or printed kit), and a tick that they're kept. */
export function PhraseStep({
  words,
  error,
  says,
  onBack,
  onContinue,
}: {
  words: string[];
  error: string | null;
  /** What the screen says; Aftercall's own phrase unless given. */
  says?: PhraseWords;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [wrote, setWrote] = useState(false);
  const count = words.length || 12;
  const tickLabel = useId();
  const say = says ?? appPhraseWords(count);
  return (
    <AssistantStep
      icon={say.icon}
      title={say.title}
      intro={say.intro}
      back={<BackButton onClick={onBack} />}
      primary={
        <Button variant="primary" disabled={!wrote} onClick={onContinue}>
          Continue
          <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
        </Button>
      }
    >
      <div className="flex flex-col gap-3" style={rise(1)}>
        {error ? (
          <p className="selectable m-0 text-record">{error}</p>
        ) : words.length === 0 ? (
          <Spinner label="Making your phrase" />
        ) : (
          <PhraseWell words={words} says={say} />
        )}
        <p className="m-0 flex items-start gap-2 rounded-md bg-caution-tint px-3 py-2 text-[13px] leading-[19px] text-ink">
          <ShieldAlert size={14} strokeWidth={1.75} aria-hidden="true" className="mt-[2.5px] shrink-0 text-caution" />
          <span>
            {say.kit.risk} {SCREEN_KEEP}
          </span>
        </p>
        {say.notes}
      </div>
      <Card interactive onClick={() => words.length && setWrote(!wrote)} pad="none" style={rise(2)}>
        <div className="flex items-center gap-3 px-4 py-3">
          {/* The tick is the checkbox; the rest of the card is a bigger target for the pointer. */}
          <span onClick={(e) => e.stopPropagation()} className="inline-flex">
            <Tick checked={wrote} onChange={setWrote} disabled={!words.length} aria-labelledby={tickLabel} />
          </span>
          <span id={tickLabel} className="flex-1 text-[15px] leading-5 font-semibold text-ink">
            I've written them down or saved a kit
          </span>
          <span className="text-[13px] text-muted">all {count}, in order</span>
        </div>
      </Card>
    </AssistantStep>
  );
}

/**
 * The words in a well, with the quiet ways to keep them in its header: Copy (cleared after
 * 60 seconds), Save kit (the native Save dialog, then Rust writes the file) and Print (the
 * same kit as a print-only page, removed once the print panel is done). Writing them down
 * stays the first way; these are secondary.
 */
function PhraseWell({ words, says }: { words: string[]; says: PhraseWords }) {
  const kit = says.kit;
  const clip = usePhraseClipboard(words.join(" "));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  /** Fixed when the step opens, so the file and the printout say the same day. */
  const date = useMemo(() => kitDate(), []);

  const copy = async () => {
    setProblem(null);
    try {
      await clip.copy();
    } catch (e) {
      setProblem(`Couldn't copy: ${errorText(e)}`);
    }
  };
  const save = async () => {
    setProblem(null);
    setSaving(true);
    try {
      const path = await saveKit(kit, kitText(kit, words, date));
      if (path) setSaved(path);
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const action = "h-7! px-2! text-ink-2 hover:text-ink";
  return (
    <div className="flex flex-col rounded-md bg-well shadow-[inset_0_0_0_1px_var(--hairline)]">
      <div className="flex items-center gap-2 pt-1.5 pr-2 pl-3.5">
        <span className="t-eyebrow min-w-0 flex-1 truncate text-ink-2">{says.label}</span>
        <span role="group" aria-label="Keep a copy" className="flex shrink-0 items-center">
          <Button variant="ghost" size="sm" className={action} onClick={copy} icon={<Copy size={13} strokeWidth={2} aria-hidden="true" />}>
            Copy
          </Button>
          <Button variant="ghost" size="sm" className={action} loading={saving} onClick={save} icon={<Download size={13} strokeWidth={2} aria-hidden="true" />}>
            Save kit…
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={action}
            aria-label="Print or save as PDF"
            title="Print or save as PDF"
            onClick={() => setPrinting(true)}
            icon={<Printer size={13} strokeWidth={2} aria-hidden="true" />}
          >
            Print…
          </Button>
        </span>
      </div>
      <ol aria-label={says.name} className="m-0 grid list-none grid-cols-3 gap-1.5 p-2.5 pt-1.5">
        {words.map((w, i) => (
          <li
            key={i}
            className="flex items-baseline gap-2.5 rounded-sm bg-elevated px-3 py-[7px] shadow-1"
            style={{ animation: `ac-in 280ms ${120 + i * 25}ms var(--ease) both` }}
          >
            <span className="w-[18px] shrink-0 text-right font-mono text-xs text-muted">{nn(i + 1)}</span>
            <span className="selectable font-mono text-[14px] leading-5 whitespace-nowrap text-ink">{w}</span>
          </li>
        ))}
      </ol>
      <div aria-live="polite" className="-mt-0.5 flex flex-col gap-1 px-3.5 pb-2.5 empty:hidden">
        {clip.left !== null && (
          <p className="m-0 flex items-center gap-2 text-[13px] leading-[19px] text-ink-2">
            <Check size={13} strokeWidth={2.5} aria-hidden="true" className="text-verdigris" />
            <span>
              Copied · clears in <span className="font-mono text-ink tabular-nums">{clip.left}</span> s
            </span>
            <button type="button" onClick={() => void clip.clear()} className="press rounded-sm font-semibold text-verdigris hover:text-verdigris-hover">
              Clear now
            </button>
          </p>
        )}
        {saved && (
          <p className="m-0 flex flex-wrap items-center gap-x-2 text-[13px] leading-[19px] text-ink-2">
            <Check size={13} strokeWidth={2.5} aria-hidden="true" className="text-verdigris" />
            Saved to <span className="t-mono selectable min-w-0 break-all text-ink">{saved}</span>
            <button type="button" onClick={() => revealItemInDir(saved)} className="press rounded-sm font-semibold text-verdigris hover:text-verdigris-hover">
              Show in Finder
            </button>
          </p>
        )}
        {saved && syncedFolder(saved) && (
          <p className="m-0 text-[13px] leading-[19px] text-caution">That folder syncs to the cloud. Move the kit to a USB drive, or print it and delete the file.</p>
        )}
        {problem && <p className="selectable m-0 text-[13px] leading-[19px] break-words text-record">{problem}</p>}
      </div>
      {printing && <KitPrint kit={kit} words={words} date={date} onDone={() => setPrinting(false)} />}
    </div>
  );
}

/**
 * Prints the kit: mounts it as a print-only page (with everything else in the window,
 * other printable pages included, kept off the paper), opens the print panel, and takes
 * the page out of the document again. In the Mac app the panel is a sheet that doesn't
 * block, so the page stays until you next click or type in the window (which you can't
 * while the sheet is open), or until the step closes.
 */
function KitPrint({ kit, words, date, onDone }: { kit: KitAbout; words: string[]; date: string; onDone: () => void }) {
  useEffect(() => {
    let finished = false;
    const unlisten = () => {
      window.removeEventListener("pointerdown", finish, true);
      window.removeEventListener("keydown", finish, true);
    };
    function finish() {
      if (finished) return;
      finished = true;
      unlisten();
      document.body.classList.remove("printing-kit");
      onDone();
    }
    document.body.classList.add("printing-kit");
    // After the page is in the document and laid out.
    const frame = requestAnimationFrame(() => {
      let opened: unknown;
      try {
        // Tauri's window.print opens the macOS print panel and returns a promise; browsers block and return nothing.
        opened = (window.print as () => unknown)();
      } catch (e) {
        toast({ text: `Couldn't open the print panel: ${errorText(e)}`, tone: "record" });
        return finish();
      }
      if (!(opened instanceof Promise)) return finish();
      opened.then(
        () => {
          if (finished) return;
          window.addEventListener("pointerdown", finish, true);
          window.addEventListener("keydown", finish, true);
        },
        (e: unknown) => {
          toast({ text: `Couldn't open the print panel: ${errorText(e)}`, tone: "record" });
          finish();
        },
      );
    });
    return () => {
      cancelAnimationFrame(frame);
      unlisten();
      document.body.classList.remove("printing-kit");
    };
  }, []);
  return createPortal(<KitPage kit={kit} words={words} date={date} />, document.body);
}

/** The kit as a printed page: ink on white in the app's type, whatever the theme. Shown only when printing. */
export function KitPage({ kit, words, date }: { kit: KitAbout; words: readonly string[]; date: string }) {
  return (
    <div className="print-only kit-print bg-elevated text-ink" data-theme="light" aria-hidden="true">
      <article className="mx-auto flex max-w-[600px] flex-col gap-6">
        <header className="flex flex-col gap-1.5">
          <p className="t-eyebrow m-0 text-ink-2">Recovery kit</p>
          <h1 className="t-display m-0 break-words">{kit.name}</h1>
          <p className="m-0 text-[13px] text-ink-2">
            {kit.kind} · saved {date}
          </p>
        </header>
        <section className="flex flex-col gap-2.5">
          <h2 className="t-section m-0">Your {words.length} words, in order</h2>
          <ol className="m-0 grid list-none grid-cols-3 gap-2 p-0 [break-inside:avoid]">
            {words.map((w, i) => (
              <li key={i} className="flex items-baseline gap-2.5 rounded-sm border border-border px-3 py-2">
                <span className="w-[18px] shrink-0 text-right font-mono text-xs text-ink-2">{nn(i + 1)}</span>
                <span className="font-mono text-[15px] leading-5">{w}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className="flex flex-col gap-1.5 [break-inside:avoid]">
          <h2 className="t-section m-0">How to restore</h2>
          <p className="m-0 font-serif text-[16px] leading-[25px]">{kit.restore}</p>
        </section>
        <section className="flex flex-col gap-1.5 rounded-md border border-border px-4 py-3 [break-inside:avoid]">
          <h2 className="t-section m-0">Keep it safe</h2>
          <p className="m-0 text-[14px] leading-[21px]">
            {kit.risk} {KIT_KEEP}
          </p>
        </section>
        <footer className="border-t border-hairline pt-3 text-[12px] text-ink-2">Made by Aftercall, which doesn't keep these words.</footer>
      </article>
    </div>
  );
}

const shake: Variant = { x: [0, -6, 6, -4, 4, -2, 0], transition: { duration: 0.36, ease: "easeOut" } };

/**
 * Step: three of the words typed back from the paper. A word that matches gets its
 * tick at once; a wrong one is marked when you leave the field or press Return, and
 * the field shakes (with reduced motion it only turns red).
 */
export function ConfirmStep({
  words,
  ask,
  busy,
  error,
  intro = "Type three of your words from your paper or kit, not from memory: one from each third.",
  icon = <KeyRound size={22} strokeWidth={1.75} />,
  confirmLabel = "Continue",
  onBack,
  onConfirm,
}: {
  words: string[];
  ask: number[];
  busy: boolean;
  error: string | null;
  intro?: ReactNode;
  icon?: ReactNode;
  /** The primary button, once all three match. */
  confirmLabel?: string;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  /** Fields left or submitted at least once since they last changed: only these show No match. */
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  /** A counter per field; each bump plays the shake again. */
  const [shakes, setShakes] = useState<Record<number, number>>({});
  const id = useId();

  const typed = (i: number) => (answers[i] ?? "").trim().toLowerCase();
  const matches = (i: number) => typed(i) === words[i];
  const wrong = (i: number) => Boolean(checked[i]) && typed(i) !== "" && !matches(i);
  const all = ask.every(matches);
  const firstWrong = ask.find(wrong);

  const mark = (list: number[]) => {
    const bad = list.filter((i) => typed(i) !== "" && !matches(i));
    setChecked((c) => ({ ...c, ...Object.fromEntries(list.map((i) => [i, true])) }));
    if (bad.length) setShakes((s) => ({ ...s, ...Object.fromEntries(bad.map((i) => [i, (s[i] ?? 0) + 1])) }));
  };

  return (
    <AssistantStep
      icon={icon}
      title="Check you have them"
      intro={intro}
      back={<BackButton onClick={onBack}>Show words again</BackButton>}
      primary={
        <Button variant="primary" disabled={!all} loading={busy} onClick={onConfirm}>
          {confirmLabel}
          <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
        </Button>
      }
    >
      <section aria-label="Your words" className="flex flex-col gap-3" style={rise(1)}>
        <div className="flex flex-col rounded-md bg-elevated shadow-1">
          {ask.map((i, row) => {
            const ok = matches(i);
            const bad = wrong(i);
            return (
              <div key={i} className={cx("flex items-center gap-4 px-[18px] py-3.5", row < ask.length - 1 && "border-b border-hairline")}>
                <label htmlFor={`${id}-${i}`} className="w-[84px] shrink-0 font-semibold text-ink">
                  Word <span className="font-mono font-medium">{nn(i + 1)}</span>
                </label>
                <m.div
                  className="min-w-0 flex-1"
                  initial={false}
                  animate={shakes[i] ? (shakes[i] % 2 ? "a" : "b") : "rest"}
                  variants={{ rest: { x: 0 }, a: shake, b: shake }}
                >
                  <Input
                    id={`${id}-${i}`}
                    mono
                    invalid={bad}
                    value={answers[i] ?? ""}
                    onChange={(e) => {
                      setAnswers({ ...answers, [i]: e.target.value });
                      setChecked({ ...checked, [i]: false });
                    }}
                    onBlur={() => typed(i) && mark([i])}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      if (all && !busy) onConfirm();
                      else mark(ask);
                    }}
                    aria-describedby={bad ? `${id}-error` : undefined}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder={`Type word ${i + 1}`}
                    className={cx("h-[38px]!", ok && "border-verdigris!")}
                  />
                </m.div>
                <span aria-live="polite" className="flex w-[112px] shrink-0 justify-end">
                  <AnimatePresence mode="wait" initial={false}>
                    {ok ? (
                      <m.span
                        key="ok"
                        className="inline-flex"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1, transition: springs.bouncy }}
                        exit={{ opacity: 0, transition: exit }}
                      >
                        <Pill tone="verdigris" icon={<CheckCircle size={16} play />} className="pl-[5px]">
                          Matches
                        </Pill>
                      </m.span>
                    ) : bad ? (
                      <m.span
                        key="bad"
                        className="inline-flex"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1, transition: springs.bouncy }}
                        exit={{ opacity: 0, transition: exit }}
                      >
                        <Pill tone="record" icon={<X size={12} strokeWidth={2.5} aria-hidden="true" />} className="pl-2 whitespace-nowrap">
                          No match
                        </Pill>
                      </m.span>
                    ) : null}
                  </AnimatePresence>
                </span>
              </div>
            );
          })}
        </div>
        {firstWrong !== undefined && (
          <p id={`${id}-error`} className="m-0 text-[13px] leading-[18px] text-record">
            Word {firstWrong + 1} doesn't match. Check what you wrote down or saved.
          </p>
        )}
        {error && <p className="selectable m-0 text-[13px] leading-[18px] text-record">{error}</p>}
      </section>
    </AssistantStep>
  );
}

/**
 * Enter a phrase to bring back the key it made: a field per word (12, or 24 for an
 * older phrase). Pasting the whole phrase into any field fills them all; a space
 * moves to the next word.
 */
export function RestorePhrase({
  onDone,
  onCancel,
  cancelLabel = "Cancel",
  warning,
  variant = "page",
}: {
  onDone: (publicKey: string) => void;
  onCancel?: () => void;
  cancelLabel?: string;
  warning?: string;
  /** "page" for the first-run screen (large actions), "dialog" inside a sheet. */
  variant?: "page" | "dialog";
}) {
  const [size, setSize] = useState<12 | 24>(12);
  const [words, setWords] = useState<string[]>(() => Array<string>(12).fill(""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  /** A field to focus once the next render has it (after a paste grows the grid). */
  const focusNext = useRef<number | null>(null);
  useEffect(() => {
    if (focusNext.current === null) return;
    inputs.current[focusNext.current]?.focus();
    focusNext.current = null;
  });

  const filled = words.slice(0, size).filter((w) => w.trim()).length;
  const complete = filled === size;

  /** Puts `list` into the fields from `start` on, growing to 24 when it needs to. */
  const fill = (start: number, list: string[]) => {
    const nextSize: 12 | 24 = start + list.length > 12 ? 24 : size;
    const next = Array.from({ length: nextSize }, (_, i) => words[i] ?? "");
    list.slice(0, nextSize - start).forEach((w, k) => (next[start + k] = w.toLowerCase()));
    setSize(nextSize);
    setWords(next);
    setError(null);
    focusNext.current = Math.min(start + list.length, nextSize - 1);
  };

  const change = (i: number, value: string) => {
    const parts = value.trim().split(/\s+/).filter(Boolean);
    if (parts.length > 1) return fill(i, parts);
    const next = [...words];
    next[i] = value.trim().toLowerCase();
    setWords(next);
    setError(null);
    // A space after a word moves on, as typing from paper does.
    if (/\s$/.test(value) && parts.length === 1 && i < size - 1) inputs.current[i + 1]?.focus();
  };

  const resize = (n: 12 | 24) => {
    setSize(n);
    setWords((w) => Array.from({ length: n }, (_, i) => w[i] ?? ""));
  };

  const restore = async () => {
    if (!complete || busy) return;
    setError(null);
    setBusy(true);
    try {
      const publicKey = await recovery.usePhrase(words.slice(0, size).join(" "));
      setWords(Array<string>(size).fill(""));
      onDone(publicKey);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const page = variant === "page";
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={`Recovery phrase, ${size} words`} className="grid grid-cols-3 gap-2">
        {Array.from({ length: size }, (_, i) => (
          <label key={i} className="group relative block">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-xs text-muted group-focus-within:text-verdigris"
            >
              {nn(i + 1)}
            </span>
            <Input
              ref={(el) => {
                inputs.current[i] = el;
              }}
              mono
              aria-label={`Word ${i + 1}`}
              value={words[i] ?? ""}
              onChange={(e) => change(i, e.target.value)}
              onPaste={(e) => {
                const parts = e.clipboardData.getData("text").trim().split(/\s+/).filter(Boolean);
                if (parts.length < 2) return;
                e.preventDefault();
                fill(i, parts);
              }}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !words[i] && i > 0) {
                  e.preventDefault();
                  inputs.current[i - 1]?.focus();
                }
                if (e.key === "Enter") restore();
              }}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="h-10! pl-[38px]! pr-2.5!"
            />
          </label>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span aria-live="polite" className="t-mono text-muted">
          {filled} of {size} words
        </span>
        <button type="button" onClick={() => resize(size === 12 ? 24 : 12)} className="press rounded-sm text-[13px] font-semibold text-ink-2 hover:text-ink">
          {size === 12 ? "My phrase has 24 words" : "My phrase has 12 words"}
        </button>
      </div>
      {warning && <p className="m-0 text-[13px] leading-[19px] text-caution">{warning}</p>}
      {error && <p className="selectable m-0 text-[13px] leading-[19px] text-record">{error}</p>}
      {!isDesktop && <p className="m-0 text-[13px] leading-[19px] text-ink-2">Restoring works in the Mac app, not the browser preview.</p>}
      {page ? (
        <StepActions>
          {onCancel ? <QuietAction onClick={onCancel}>{cancelLabel}</QuietAction> : <span />}
          <Button variant="primary" size="lg" disabled={!complete} loading={busy} onClick={restore}>
            Restore key
          </Button>
        </StepActions>
      ) : (
        <div className="flex justify-end gap-2 pt-1">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              {cancelLabel}
            </Button>
          )}
          <Button variant="primary" disabled={!complete} loading={busy} onClick={restore}>
            Restore key
          </Button>
        </div>
      )}
    </div>
  );
}

/** Picks a .aftercall file and restores it with this Mac's phrase-derived key. */
export function ImportBackup({ onRestored, label = "Import backup", disabled }: { onRestored: (r: Restored) => void; label?: string; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      onRestored(await recovery.importBackup(file));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <span className="flex flex-col items-end gap-2">
      <input ref={input} type="file" accept=".aftercall" tabIndex={-1} aria-hidden="true" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <Button loading={busy} disabled={disabled || !isDesktop} onClick={() => input.current?.click()}>
        {label}
      </Button>
      {error && <p className="selectable m-0 max-w-[320px] text-right text-[13px] leading-[19px] text-record">{error}</p>}
    </span>
  );
}

/** Settings: where this Mac's key comes from, the phrase, and encrypted backups. */
export function RecoverySettings({
  status,
  onKeyChanged,
  onCreatePhrase,
}: {
  status: RecoveryStatus | null;
  onKeyChanged: () => void;
  onCreatePhrase: () => void;
}) {
  const [restoring, setRestoring] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const confirm = useConfirm();
  const startCreate = async () => {
    const ok =
      !status?.hasKey ||
      (await confirm({
        title: "Make a new key for this Mac?",
        body: "Payments and proofs stop until you authorise the new key once, in Set up payments.",
        confirmLabel: "Make a new key",
        tone: "danger",
      }));
    if (ok) onCreatePhrase();
  };

  const exportBackup = async () => {
    setError(null);
    setExporting(true);
    try {
      setSaved(await recovery.exportBackup());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setExporting(false);
    }
  };

  const restored = (r: Restored) => {
    setMessage(`${restoredSummary(r)} Reloading…`);
    setTimeout(() => window.location.reload(), 1500);
  };

  const fromPhrase = Boolean(status?.fromPhrase);
  const legacy = Boolean(status?.hasKey && !status.fromPhrase);

  return (
    <section aria-labelledby="h-key" className="flex flex-col gap-3">
      <SectionTitle id="h-key" count="this Mac's key">
        Recovery phrase
      </SectionTitle>
      <Card pad="none">
        <CardRow
          divider={fromPhrase}
          icon={
            fromPhrase ? (
              <IconDisc tone="verdigris">
                <Check size={16} strokeWidth={2.25} />
              </IconDisc>
            ) : (
              <IconDisc tone="well">
                <KeyRound size={16} strokeWidth={1.75} />
              </IconDisc>
            )
          }
          title={fromPhrase ? "Key from your phrase" : legacy ? "Key made before recovery phrases" : "No key on this Mac yet"}
          detail={
            fromPhrase
              ? "Restore it on a new Mac from here or the first-run screen."
              : legacy
                ? "It can't be restored on another Mac. A phrase makes a new key that can."
                : "Make a recovery phrase, or restore one you already have."
          }
        >
          <span className="flex gap-1.5">
            <Button variant="quiet" onClick={() => setRestoring(true)}>
              {status?.hasKey ? "Restore a phrase" : "I have a phrase"}
            </Button>
            {!fromPhrase && (
              <Button variant="primary" onClick={startCreate}>
                Create a recovery phrase
              </Button>
            )}
          </span>
        </CardRow>
        {fromPhrase && (
          <CardRow
            icon={
              <IconDisc tone="well">
                <Archive size={16} strokeWidth={1.75} />
              </IconDisc>
            }
            title="Backup"
            detail="Notes, projects and settings, encrypted with your phrase."
          >
            <span className="flex items-start gap-1.5">
              <ImportBackup label="Import" onRestored={restored} />
              <Button variant="primary" loading={exporting} disabled={!isDesktop} onClick={exportBackup}>
                Export backup
              </Button>
            </span>
          </CardRow>
        )}
      </Card>

      <AnimatePresence initial={false}>
        {saved && (
          <m.p
            key="saved"
            className="m-0 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-2"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Check size={13} strokeWidth={2.5} aria-hidden="true" className="text-verdigris" />
            Saved to <span className="t-mono selectable break-all text-ink">{saved}</span>
            <button type="button" onClick={() => revealItemInDir(saved)} className="press rounded-sm font-semibold text-verdigris hover:text-verdigris-hover">
              Show in Finder
            </button>
          </m.p>
        )}
      </AnimatePresence>
      {message && <p className="m-0 text-verdigris">{message}</p>}
      {error && <p className="selectable m-0 text-[13px] leading-[19px] break-words text-record">{error}</p>}

      <Why>
        Aftercall keeps the key made from your words, never the words, so it can't show them again. Backups hold notes, projects, NEAR settings and autopilot
        rules. Audio and the NEAR AI key are left out.
        {legacy &&
          " A new phrase makes a new key: you authorise it once in Set up payments, and the old key stays on your account until you remove it in your wallet."}
      </Why>

      <AnimatePresence>
        {restoring && (
          <Dialog
            key="restore"
            title="Restore a recovery phrase"
            intro="Type your words in order. They stay on this Mac."
            width={600}
            onClose={() => setRestoring(false)}
          >
            <RestorePhrase
              variant="dialog"
              onCancel={() => setRestoring(false)}
              warning={
                status?.hasKey
                  ? "This replaces this Mac's current key with the one from the phrase. If that key isn't authorised yet, authorise it in Set up payments."
                  : undefined
              }
              onDone={() => {
                setRestoring(false);
                onKeyChanged();
                toast({ text: "Key restored from your phrase", tone: "verdigris" });
              }}
            />
          </Dialog>
        )}
      </AnimatePresence>
    </section>
  );
}
