import { useEffect, useState } from "react";
import { ExternalLink, KeyRound, ShieldCheck } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { nearAiKey } from "./nearai";
import { isDesktop } from "./recorder";
import { CheckCircle } from "./primitives/Check";
import { Button, Card, Field, Input, Pill, cx, useConfirm } from "./ui";
import { CardRow, IconDisc, errorText } from "./SettingsParts";

type Verdict = "valid" | "unknown" | null;

/**
 * Connects NEAR AI: paste a key, Aftercall checks it with NEAR AI, then keeps it in
 * the macOS Keychain. Used in Settings (a card with Remove and Replace), and
 * `compact` in onboarding and on a recording (the form, then a status line).
 * `onChange` hears whether a key is saved, on load and after every change.
 */
export function NearAiConnect({ onConnected, onChange, compact }: { onConnected?: () => void; onChange?: (connected: boolean) => void; compact?: boolean }) {
  const [hint, setHint] = useState<string | null | undefined>(undefined);
  const [replacing, setReplacing] = useState(false);
  const [key, setKey] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  /** What NEAR AI said about the key saved in this visit; null for one saved earlier. */
  const [verdict, setVerdict] = useState<Verdict>(null);

  const refresh = async () => {
    const h = isDesktop ? await nearAiKey.hint().catch(() => null) : null;
    setHint(h);
    onChange?.(Boolean(h));
  };
  useEffect(() => {
    refresh();
  }, []);

  const save = async () => {
    setError(null);
    setState("checking");
    try {
      const v = await nearAiKey.check(key);
      if (v === "invalid") {
        setError("NEAR AI says this key is invalid or expired. Copy it again from cloud.near.ai, or make a new one.");
        return;
      }
      setState("saving");
      await nearAiKey.set(key);
      setVerdict(v);
      setKey("");
      setReplacing(false);
      await refresh();
      onConnected?.();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setState("idle");
    }
  };

  const confirm = useConfirm();
  const remove = async () => {
    const ok = await confirm({
      title: "Remove the NEAR AI key from this Mac?",
      body: "Recordings will wait for notes until you add one again.",
      confirmLabel: "Remove key",
      tone: "danger",
    });
    if (!ok) return;
    await nearAiKey.clear();
    setVerdict(null);
    setHint(null);
    onChange?.(false);
  };

  if (hint === undefined) return null;

  const unchecked = verdict === "unknown" && (
    <p className="m-0 text-[13px] leading-[19px] text-caution">Saved, but NEAR AI couldn't be reached to check it. It will be checked when you make notes.</p>
  );

  if (hint && !replacing && compact) {
    // Onboarding and recordings: a status line, with the tick drawn when the key was just added.
    return (
      <div className="flex flex-col gap-2">
        <div role="status" className="flex flex-wrap items-center gap-3.5 rounded-md bg-raised px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--hairline)]">
          <CheckCircle size={22} play={verdict !== null} />
          <span className="flex min-w-0 flex-[1_1_200px] flex-col gap-px">
            <span className="t-section text-ink">
              {verdict === "valid" ? "Key checked with NEAR AI" : verdict === "unknown" ? "Key saved" : "Key in your Keychain"}
            </span>
            <span className="text-[13px] leading-[18px] text-ink-2">Notes start as soon as a recording stops.</span>
          </span>
          <Pill tone="verdigris" icon={<ShieldCheck size={12} strokeWidth={2} aria-hidden="true" />}>
            Connected · <span className="font-mono font-medium tracking-normal normal-case">key …{hint}</span>
          </Pill>
        </div>
        {unchecked}
      </div>
    );
  }

  if (hint && !replacing) {
    return (
      <div className="flex flex-col gap-2">
        <Card pad="none">
          <CardRow
            icon={
              <IconDisc tone="verdigris">
                <KeyRound size={16} strokeWidth={1.75} />
              </IconDisc>
            }
            title="API key"
            detail={
              <>
                <span className="font-mono">…{hint}</span> · in your Keychain
              </>
            }
          >
            <Pill tone="verdigris" icon={<ShieldCheck size={12} strokeWidth={2} aria-hidden="true" />}>
              Connected
            </Pill>
            <span className="flex gap-1.5">
              <Button variant="quiet" onClick={remove}>
                Remove
              </Button>
              <Button onClick={() => setReplacing(true)}>Replace</Button>
            </span>
          </CardRow>
        </Card>
        {unchecked}
      </div>
    );
  }

  const busy = state !== "idle";
  const valid = key.trim().length >= 16;
  const form = (
    <div className="flex flex-col gap-3">
      <Field label="NEAR AI API key" error={error} hint={compact ? undefined : "Set a spend limit on the key at cloud.near.ai."}>
        <div className="flex gap-2">
          <Input
            mono
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && valid && !busy && isDesktop && save()}
            placeholder="Paste your NEAR AI API key"
            className={cx("flex-1", compact && "h-10!")}
          />
          <Button
            variant={compact ? "secondary" : "primary"}
            loading={busy}
            disabled={!valid || !isDesktop}
            onClick={save}
            className={compact ? "h-10!" : undefined}
          >
            {state === "checking" ? "Checking…" : state === "saving" ? "Saving…" : "Connect"}
          </Button>
          {replacing && (
            <Button variant="ghost" onClick={() => setReplacing(false)}>
              Cancel
            </Button>
          )}
        </div>
      </Field>
      {!isDesktop && <p className="m-0 text-[13px] leading-[19px] text-ink-2">Connecting works in the Mac app, not the browser preview.</p>}
      <button
        type="button"
        onClick={() => openUrl("https://cloud.near.ai").catch(() => window.open("https://cloud.near.ai", "_blank"))}
        className="press inline-flex items-center gap-1.5 self-start rounded-sm font-semibold text-verdigris hover:text-verdigris-hover"
      >
        <ExternalLink size={13} strokeWidth={2} aria-hidden="true" /> Get a key at cloud.near.ai
      </button>
    </div>
  );

  return compact ? form : <Card pad="md">{form}</Card>;
}
