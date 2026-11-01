import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { recovery, restoredSummary, type RecoveryStatus, type Restored } from "./recovery";
import { isDesktop } from "./recorder";
import { Button, SectionLabel, Spinner, cx, useConfirm } from "./ui";

/**
 * Shows a new phrase once, asks for three of its words back, then derives this Mac's
 * key from it. Nothing is stored until the words are confirmed, and the phrase itself
 * is never stored.
 */
export function CreatePhrase({ onDone, onCancel }: { onDone: (publicKey: string) => void; onCancel?: () => void }) {
  const [phrase, setPhrase] = useState<string | null>(null);
  const [stage, setStage] = useState<"show" | "confirm">("show");
  const [wroteDown, setWroteDown] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    recovery.newPhrase().then(setPhrase).catch((e) => setError(String(e)));
  }, []);

  const words = phrase?.split(" ") ?? [];
  // Three positions to ask back, one from each third of the phrase.
  const ask = useMemo(() => {
    const third = Math.floor(words.length / 3);
    return [0, 1, 2].map((i) => i * third + Math.floor(Math.random() * third));
  }, [words.length]);

  const confirm = async () => {
    setError(null);
    const wrong = ask.find((i) => (answers[i] ?? "").trim().toLowerCase() !== words[i]);
    if (wrong !== undefined) return setError(`Word ${wrong + 1} doesn't match. Check what you wrote down.`);
    setBusy(true);
    try {
      const publicKey = await recovery.usePhrase(phrase!);
      setPhrase(null);
      onDone(publicKey);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!phrase) return error ? <p className="selectable m-0 text-record">{error}</p> : <Spinner />;

  if (stage === "show") {
    return (
      <div className="flex flex-col gap-3">
        <p className="m-0">
          Write these {words.length} words on paper, in order. They restore this Mac's NEAR key and open your backups on another Mac.
        </p>
        <ol className="m-0 grid list-none grid-cols-3 gap-px overflow-hidden rounded-md bg-hairline p-0 shadow-[inset_0_0_0_1px_var(--hairline)]">
          {words.map((w, i) => (
            <li key={i} className="flex items-baseline gap-2 bg-well px-3 py-2">
              <span className="w-5 text-right font-mono text-xs text-muted">{i + 1}</span>
              <span className="selectable font-mono">{w}</span>
            </li>
          ))}
        </ol>
        <p className="m-0 text-muted">
          Aftercall doesn't keep the phrase, only the key made from it, so it can't show these words again. Anyone with them can use this Mac's key, within your
          contract's limits. Don't photograph them or paste them anywhere.
        </p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={wroteDown} onChange={(e) => setWroteDown(e.target.checked)} className="accent-[var(--verdigris)]" />
          I've written all {words.length} words down
        </label>
        <div className="flex justify-end gap-2">
          {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
          <Button variant="primary" disabled={!wroteDown} onClick={() => setStage("confirm")}>Next</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0">Type these words from your paper to check it.</p>
      <div className="flex flex-col gap-2">
        {ask.map((i) => (
          <label key={i} className="flex items-center justify-between gap-4">
            <span className="text-muted">Word {i + 1}</span>
            <input
              value={answers[i] ?? ""}
              onChange={(e) => setAnswers({ ...answers, [i]: e.target.value })}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="selectable h-8 w-[200px] rounded-sm border border-border bg-well px-2.5 font-mono text-xs text-ink outline-none"
            />
          </label>
        ))}
      </div>
      {error && <p className="selectable m-0 text-record">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setStage("show")}>Show the words again</Button>
        <Button variant="primary" disabled={busy || ask.some((i) => !answers[i]?.trim())} onClick={confirm}>
          {busy && <Spinner size={12} />}
          Confirm
        </Button>
      </div>
    </div>
  );
}

/** Enter a phrase to bring back the key it made. */
export function RestorePhrase({ onDone, onCancel, warning }: { onDone: (publicKey: string) => void; onCancel?: () => void; warning?: string }) {
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = phrase.trim() ? phrase.trim().split(/\s+/).length : 0;

  const restore = async () => {
    setError(null);
    setBusy(true);
    try {
      const publicKey = await recovery.usePhrase(phrase);
      setPhrase("");
      onDone(publicKey);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0">Type your 12 or 24 words in order, with spaces between them. They stay on this Mac.</p>
      <textarea
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        rows={3}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="Recovery phrase"
        className="selectable rounded-sm border border-border bg-well px-3 py-2 font-mono text-xs leading-5 text-ink outline-none"
      />
      {warning && <p className="m-0 text-caution">{warning}</p>}
      {error && <p className="selectable m-0 text-record">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted">{count} {count === 1 ? "word" : "words"}</span>
        <span className="flex gap-2">
          {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
          <Button variant="primary" disabled={busy || (count !== 12 && count !== 24)} onClick={restore}>
            {busy && <Spinner size={12} />}
            Restore key
          </Button>
        </span>
      </div>
    </div>
  );
}

/** Picks a .aftercall file and restores it with this Mac's phrase-derived key. */
export function ImportBackup({ onRestored, label = "Import backup" }: { onRestored: (r: Restored) => void; label?: string }) {
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
      setError(String(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <span className="flex flex-col items-end gap-2">
      <input ref={input} type="file" accept=".aftercall" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <Button disabled={busy || !isDesktop} onClick={() => input.current?.click()}>
        {busy && <Spinner size={12} />}
        {label}
      </Button>
      {error && <p className="selectable m-0 text-right text-record">{error}</p>}
    </span>
  );
}

/** Settings: where this Mac's key comes from, the phrase, and encrypted backups. */
export function RecoverySettings({ status, onKeyChanged }: { status: RecoveryStatus | null; onKeyChanged: () => void }) {
  const [mode, setMode] = useState<"idle" | "create" | "restore">("idle");
  const [saved, setSaved] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const done = () => {
    setMode("idle");
    onKeyChanged();
  };

  const confirm = useConfirm();
  const startCreate = async () => {
    const ok =
      !status?.hasKey ||
      (await confirm({
        title: "Make a new key for this Mac?",
        body: "Payments and proofs stop until you authorise the new key once (step 02 below).",
        confirmLabel: "Make a new key",
        tone: "danger",
      }));
    if (ok) setMode("create");
  };

  const exportBackup = async () => {
    setError(null);
    setExporting(true);
    try {
      setSaved(await recovery.exportBackup());
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  };

  const restored = (r: Restored) => {
    setMessage(`${restoredSummary(r)} Reloading…`);
    setTimeout(() => window.location.reload(), 1500);
  };

  const intro = !status?.hasKey
    ? "This Mac needs its own NEAR key before you authorise it. The key comes from a recovery phrase, so you can bring it back on a new Mac."
    : status.fromPhrase
      ? "This Mac's key comes from your recovery phrase. Aftercall keeps the key in your Keychain; it never stores the phrase."
      : "This Mac's key was made before recovery phrases, so it can't be restored on another Mac. Create a phrase to make a new key you can restore. You'll authorise the new key once, in step 02 below; the old one stays on your account until you remove it in your wallet.";

  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>Recovery phrase</SectionLabel>
      <p className="m-0 text-muted">{intro}</p>

      {mode === "create" && (
        <div className="rounded-md p-5 shadow-[inset_0_0_0_1px_var(--hairline)]">
          <CreatePhrase onDone={done} onCancel={() => setMode("idle")} />
        </div>
      )}
      {mode === "restore" && (
        <div className="rounded-md p-5 shadow-[inset_0_0_0_1px_var(--hairline)]">
          <RestorePhrase
            onDone={done}
            onCancel={() => setMode("idle")}
            warning={status?.hasKey ? "This replaces this Mac's current key with the one from the phrase. If that key isn't authorised yet, do step 02 below." : undefined}
          />
        </div>
      )}

      {mode === "idle" && (
        <div className="flex flex-col overflow-hidden rounded-md shadow-[inset_0_0_0_1px_var(--hairline)]">
          <div className={cx("flex items-center gap-4 px-5 py-4", status?.fromPhrase && "border-b border-hairline")}>
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="t-title flex items-center gap-2">
                {status?.fromPhrase && <Check size={14} strokeWidth={2} className="text-verdigris" aria-hidden="true" />}
                {status?.fromPhrase ? "Key from your phrase" : "Recovery phrase"}
              </span>
              <span className="text-muted">{status?.fromPhrase ? "Restore it on a new Mac from Settings or the first-run screen." : "12 words you write on paper."}</span>
            </span>
            <span className="flex gap-2">
              <Button variant="ghost" onClick={() => setMode("restore")}>{status?.hasKey ? "Restore a phrase" : "I have a phrase"}</Button>
              {!status?.fromPhrase && (
                <Button variant="primary" onClick={startCreate}>
                  Create a recovery phrase
                </Button>
              )}
            </span>
          </div>
          {status?.fromPhrase && (
            <div className="flex items-start gap-4 px-5 py-4">
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="t-title">Backup</span>
                <span className="text-muted">Notes, projects, NEAR settings and autopilot rules, encrypted with your phrase. Audio and the NEAR AI key aren't included.</span>
              </span>
              <span className="flex shrink-0 items-start gap-2">
                <ImportBackup onRestored={restored} />
                <Button variant="primary" onClick={exportBackup} disabled={exporting}>
                  {exporting && <Spinner size={12} />}
                  Export backup
                </Button>
              </span>
            </div>
          )}
        </div>
      )}

      {saved && (
        <p className="m-0 flex flex-wrap items-center gap-x-2 text-muted">
          Saved to <span className="t-mono selectable break-all text-ink">{saved}</span>
          <button onClick={() => revealItemInDir(saved)} className="font-semibold text-verdigris hover:text-verdigris-hover">
            Show in Finder
          </button>
        </p>
      )}
      {message && <p className="m-0 text-verdigris">{message}</p>}
      {error && <p className="selectable m-0 break-words text-record">{error}</p>}
    </section>
  );
}
