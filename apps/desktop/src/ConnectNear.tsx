import { useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { Check, ChevronRight, ShieldCheck, Wallet } from "lucide-react";
import { AutopilotSettings } from "./AutopilotSettings";
import { RecapSettings } from "./RecapSettings";
import { CalendarSettings } from "./CalendarSettings";
import { ShortcutSettings } from "./ShortcutSettings";
import type { CalendarStatus } from "./calendar";
import { NearAiSettings } from "./NearAiSettings";
import type { Spend } from "./costs";
import { KEY_METHODS } from "./near";
import { useNearSetup, type NearSetup } from "./nearSetup";
import { CheckCircle } from "./primitives/Check";
import { isDesktop } from "./recorder";
import { RecoverySettings } from "./RecoveryPhrase";
import { SetupPayments, type SetupStep } from "./SetupPayments";
import { CardRow, IconDisc, Pop, Snippet, Why, rise } from "./SettingsParts";
import { Button, Card, Pill, SectionTitle, Spinner, cx } from "./ui";

/**
 * Settings, in the order a new user needs them: notes (NEAR AI), this Mac's key
 * (recovery phrase), where NEAR stands (changed only in Set up payments), then extras.
 * The index at the top ticks what's done and says what still needs a signature.
 * `onOpenPrivacy` shows the "Privacy and your data" row; without it the row is hidden.
 */
export function ConnectNear({ onOpenPrivacy, spend, spendIsSample }: { onOpenPrivacy?: () => void; spend?: Spend | null; spendIsSample?: boolean } = {}) {
  const n = useNearSetup();
  const [nearAi, setNearAi] = useState(false);
  const [calendar, setCalendar] = useState<CalendarStatus | null>(null);
  /** Set up payments, open at a step ("auto": the first one not done). */
  const [setup, setSetup] = useState<SetupStep | "auto" | null>(null);

  const toSign = Boolean(n.saved && n.status && !n.connected);
  const index: { id: string; label: string; done?: boolean; pill?: string }[] = [
    { id: "settings-near-ai", label: "NEAR AI", done: nearAi },
    { id: "settings-key", label: "Recovery phrase", done: Boolean(n.recoveryStatus?.fromPhrase) },
    { id: "settings-account", label: "NEAR account", done: n.connected, pill: toSign ? "To sign" : undefined },
    { id: "settings-calendar", label: "Calendar", done: calendar === "granted" },
    { id: "settings-shortcut", label: "Shortcut" },
    { id: "settings-recaps", label: "Recaps" },
    { id: "settings-autopilot", label: "Autopilot" },
  ];

  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    // Keyboard and screen-reader users land in the section too, not just the eye.
    el.focus({ preventScroll: true });
  };

  const eyebrow = n.saved?.account ? `${n.saved.account} · NEAR ${n.saved.network}` : "Not connected to NEAR yet";

  return (
    <main className="min-w-0 flex-1 overflow-y-auto border-l border-hairline bg-raised">
      <div data-tauri-drag-region className="sticky top-0 z-10 h-9 bg-raised" />
      <div className="px-12 pt-5 pb-18">
        <div className="mx-auto flex max-w-[680px] flex-col gap-8">
          <header className="flex flex-col gap-1.5" style={rise(0)}>
            <span className="t-eyebrow text-muted">{eyebrow}</span>
            <div className="flex items-end justify-between gap-4">
              <h1 className="t-display m-0">Settings</h1>
              {n.loaded && !n.connected && (
                <Button variant="primary" onClick={() => setSetup("auto")} className="mb-1">
                  Set up payments
                </Button>
              )}
            </div>
            <p className="m-0 text-ink-2">Private notes through NEAR AI, proofs and payments on NEAR, and what autopilot may do.</p>
          </header>

          <nav
            aria-label="Settings sections"
            className="flex flex-wrap items-center gap-x-[18px] gap-y-2 rounded-md px-4 py-3 shadow-[inset_0_0_0_1px_var(--hairline)]"
            style={rise(1)}
          >
            {index.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => jump(s.id)}
                className="press inline-flex items-center gap-1.5 rounded-sm text-[13px] font-semibold text-ink hover:text-verdigris"
              >
                <Pop show={Boolean(s.done)}>
                  <Check size={13} strokeWidth={2.5} aria-hidden="true" className="text-verdigris" />
                </Pop>
                {s.label}
                {s.done && <span className="sr-only">, done</span>}
                <Pop show={Boolean(s.pill)}>
                  <Pill tone="caution" className="h-5 px-2">
                    {s.pill}
                  </Pill>
                </Pop>
              </button>
            ))}
          </nav>

          <div id="settings-near-ai" tabIndex={-1} className="scroll-mt-12 outline-none" style={rise(2)}>
            <NearAiSettings onChange={setNearAi} spend={spend} sample={spendIsSample} />
          </div>

          <div id="settings-key" tabIndex={-1} className="scroll-mt-12 outline-none" style={rise(3)}>
            <RecoverySettings status={n.recoveryStatus} onKeyChanged={n.keyChanged} onCreatePhrase={() => setSetup("phrase")} />
          </div>

          <div id="settings-account" tabIndex={-1} className="scroll-mt-12 outline-none" style={rise(4)}>
            <NearStatusCard n={n} onSetup={setSetup} />
          </div>

          <div id="settings-calendar" tabIndex={-1} className="scroll-mt-12 outline-none" style={rise(5)}>
            <CalendarSettings onChange={setCalendar} />
          </div>

          <div id="settings-shortcut" tabIndex={-1} className="scroll-mt-12 outline-none" style={rise(7)}>
            <ShortcutSettings />
          </div>

          <div id="settings-recaps" tabIndex={-1} className="scroll-mt-12 outline-none" style={rise(8)}>
            <RecapSettings />
          </div>

          <div id="settings-autopilot" tabIndex={-1} className="scroll-mt-12 outline-none" style={rise(8)}>
            <AutopilotSettings />
          </div>

          {onOpenPrivacy && (
            <Card as="button" interactive pad="none" onClick={onOpenPrivacy} className="w-full" style={rise(9)}>
              <span className="flex items-center gap-3.5 px-5 py-4">
                <IconDisc tone="verdigris">
                  <ShieldCheck size={16} strokeWidth={1.75} />
                </IconDisc>
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="t-title text-ink">Privacy and your data</span>
                  <span className="text-[13px] leading-[19px] text-ink-2">What stays on this Mac, what leaves it, and what each place keeps.</span>
                </span>
                <ChevronRight size={16} strokeWidth={2} aria-hidden="true" className="shrink-0 text-muted" />
              </span>
            </Card>
          )}
        </div>
      </div>

      <AnimatePresence>
        {setup && <SetupPayments key="setup" near={n} start={setup === "auto" ? undefined : setup} onClose={() => setSetup(null)} />}
      </AnimatePresence>
    </main>
  );
}

/**
 * Where NEAR stands, at a glance: the account, the agent wallet and this Mac's key,
 * each ticked from NEAR. Every change happens in Set up payments, which this opens
 * at the first step not done; this card never asks for the same things twice.
 */
function NearStatusCard({ n, onSetup }: { n: NearSetup; onSetup: (step: SetupStep | "auto") => void }) {
  const registered = Boolean(n.status?.registered);
  const keyAdded = Boolean(n.status?.keyAdded);
  const account = n.saved?.account ?? null;
  const started = Boolean(account);
  const rows: { label: string; value: ReactNode; done: boolean; mono?: boolean }[] = [
    { label: "NEAR account", value: account ?? "Not added", done: n.accountDone, mono: Boolean(account) },
    { label: "Agent wallet", value: registered ? `On ${n.saved?.contract ?? n.config.contract}` : "Not created", done: registered, mono: registered },
    { label: "This Mac's key", value: keyAdded ? `May call ${KEY_METHODS.join(" and ")}` : n.publicKey ? "Not authorised" : "No key yet", done: keyAdded },
  ];
  const network = n.saved?.network ?? n.config.network;

  return (
    <section aria-labelledby="h-account" className="flex flex-col gap-3">
      <SectionTitle id="h-account" count="proofs and payments">
        NEAR account
      </SectionTitle>
      <Card pad="none">
        <CardRow
          divider
          icon={
            <IconDisc tone={n.connected ? "verdigris" : "well"}>
              {n.connected ? <Check size={16} strokeWidth={2.25} /> : <Wallet size={16} strokeWidth={1.75} />}
            </IconDisc>
          }
          title={n.connected ? "Connected" : started ? "Setup not finished" : "Not connected"}
          detail={
            n.connected
              ? "Each meeting's proof goes on NEAR, and Aftercall can pay within your caps."
              : started
                ? "One approval in your wallet left before this Mac can record proofs and pay."
                : "Optional. Adds a public proof for each meeting and an agent wallet that pays within your caps."
          }
        >
          {!n.loaded ? (
            <Spinner size={14} label="Checking NEAR" />
          ) : n.connected ? (
            <Button variant="quiet" onClick={() => onSetup("account")}>
              Change account
            </Button>
          ) : (
            <Button variant={started ? "primary" : "secondary"} disabled={!isDesktop} onClick={() => onSetup("auto")}>
              {started ? "Continue setup" : "Set up payments"}
            </Button>
          )}
        </CardRow>
        <dl className="m-0 flex flex-col px-5 py-2">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center gap-3 py-2">
              <span aria-hidden="true" className="inline-flex size-[18px] shrink-0 items-center justify-center">
                {r.done ? (
                  <CheckCircle size={18} play={false} />
                ) : (
                  <span className="inline-flex size-4 rounded-full shadow-[inset_0_0_0_1.5px_var(--border)]" />
                )}
              </span>
              <dt className="w-[124px] shrink-0 text-[13px] leading-[19px] font-semibold text-ink">{r.label}</dt>
              <dd className={cx("m-0 min-w-0 flex-1 truncate", r.mono ? "t-mono selectable text-ink-2" : "text-[13px] leading-[19px] text-ink-2")}>
                {r.value}
                <span className="sr-only">{r.done ? ", done" : ", not done"}</span>
              </dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-hairline px-5 py-3 text-[13px] leading-[19px] text-ink-2">
          {network === "mainnet" ? "Mainnet moves real USDC. Keep the caps small." : "Testnet moves test USDC, not real money."}
        </div>
      </Card>
      {n.status?.keyProblem && <p className="m-0 text-[13px] leading-[19px] text-caution">{n.status.keyProblem}</p>}
      {n.error && n.errorFrom !== "sign" && <p className="selectable m-0 text-[13px] leading-[19px] break-words text-record">{n.error}</p>}
      <Why>
        Your agent wallet lives in Aftercall's contract, and each meeting's proof is recorded there. A proof holds a hash and the model name, never what was said.
        This Mac's key can call only <span className="font-mono text-ink">pay</span> and <span className="font-mono text-ink">record_proof</span>; raising a cap,
        adding a payee or withdrawing still needs your wallet.
      </Why>
      <Why label="Prefer near-cli?">
        {n.commands ? (
          <span className="flex flex-col gap-3">
            <span>Instead of the signing page, run the two setup commands in Terminal.</span>
            <Snippet text={n.commands.register} label="Copy the command that creates your agent wallet" />
            <Snippet text={n.commands.addKey} label="Copy the command that authorises this Mac's key" />
          </span>
        ) : (
          "Add your NEAR account and make this Mac's key in Set up payments; the two commands then appear here."
        )}
      </Why>
    </section>
  );
}
