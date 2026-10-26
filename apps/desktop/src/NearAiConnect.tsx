import { useEffect, useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { nearAiKey } from "./nearai";
import { isDesktop } from "./recorder";
import { Button, Spinner } from "./ui";

/**
 * Connects NEAR AI: paste a key, Aftercall checks it with NEAR AI, then keeps it in
 * the macOS Keychain. Used in onboarding, Settings and on a recording.
 */
export function NearAiConnect({ onConnected, compact }: { onConnected?: () => void; compact?: boolean }) {
  const [hint, setHint] = useState<string | null | undefined>(undefined);
  const [replacing, setReplacing] = useState(false);
  const [key, setKey] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = () => (isDesktop ? nearAiKey.hint().then(setHint).catch(() => setHint(null)) : setHint(null));
  useEffect(() => {
    refresh();
  }, []);

  const save = async () => {
    setError(null);
    setNote(null);
    setState("checking");
    try {
      const verdict = await nearAiKey.check(key);
      if (verdict === "invalid") {
        setError("NEAR AI says this key is invalid or expired. Copy it again from cloud.near.ai, or make a new one.");
        return;
      }
      setState("saving");
      await nearAiKey.set(key);
      if (verdict === "unknown") setNote("Saved, but NEAR AI couldn't be reached to check it. It will be checked when you make notes.");
      setKey("");
      setReplacing(false);
      await refresh();
      onConnected?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setState("idle");
    }
  };

  const remove = async () => {
    if (!window.confirm("Remove the NEAR AI key from this Mac? Recordings will wait for notes until you add one again.")) return;
    await nearAiKey.clear();
    setHint(null);
  };

  if (hint === undefined) return null;

  if (hint && !replacing) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 rounded-md px-5 py-4 shadow-[inset_0_0_0_1px_var(--hairline)]">
          <span className="flex items-center gap-2 font-semibold">
            <Check size={14} strokeWidth={2} className="text-verdigris" aria-hidden="true" />
            Connected <span className="font-mono text-xs font-normal text-muted">key …{hint}</span>
          </span>
          {!compact && (
            <span className="flex gap-2">
              <Button variant="ghost" onClick={remove}>Remove</Button>
              <Button onClick={() => setReplacing(true)}>Replace</Button>
            </span>
          )}
        </div>
        {note && <p className="m-0 text-caution">{note}</p>}
      </div>
    );
  }

  const busy = state !== "idle";
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex gap-2">
        <label htmlFor="nearai-key-input" className="sr-only">NEAR AI API key</label>
        <input
          id="nearai-key-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && key.trim().length >= 16 && !busy && save()}
          placeholder="Paste your NEAR AI API key"
          className="selectable h-9 flex-1 rounded-sm border border-border bg-well px-3 text-ink outline-none placeholder:text-muted"
        />
        <Button variant="primary" disabled={key.trim().length < 16 || busy || !isDesktop} onClick={save}>
          {busy && <Spinner size={12} />}
          {state === "checking" ? "Checking…" : state === "saving" ? "Saving…" : "Connect"}
        </Button>
        {replacing && <Button variant="ghost" onClick={() => setReplacing(false)}>Cancel</Button>}
      </div>
      {error && <p className="selectable m-0 text-record">{error}</p>}
      {!isDesktop && <p className="m-0 text-muted">Connecting works in the Mac app, not the browser preview.</p>}
      <button
        onClick={() => openUrl("https://cloud.near.ai").catch(() => window.open("https://cloud.near.ai", "_blank"))}
        className="inline-flex items-center gap-1.5 self-start font-semibold text-verdigris hover:text-verdigris-hover"
      >
        <ExternalLink size={13} aria-hidden="true" /> Get a key at cloud.near.ai
      </button>
      <p className="m-0 text-muted">Set a spend limit on the key there. Aftercall checks it with NEAR AI, then keeps it in your macOS Keychain.</p>
    </div>
  );
}
