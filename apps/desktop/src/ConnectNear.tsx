import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { Check, ChevronRight, ShieldCheck } from "lucide-react";
import { AutopilotSettings } from "./AutopilotSettings";
import { CalendarSettings } from "./CalendarSettings";
import { ShortcutSettings } from "./ShortcutSettings";
import type { CalendarStatus } from "./calendar";
import { NearAiSettings } from "./NearAiSettings";
import type { Spend } from "./costs";
import { useNearSetup, type NearSetup } from "./nearSetup";
import { isDesktop } from "./recorder";
import { RecoverySettings } from "./RecoveryPhrase";
import { AccountFields, AccountNotes, SetupPayments, UnseenNote, type SetupStep } from "./SetupPayments";
import { IconDisc, Pop, Snippet, Why, rise } from "./SettingsParts";
import { Button, Card, Pill, SectionTitle, Spinner, cx } from "./ui";

/**
 * Settings, in the order a new user needs them: notes (NEAR AI), this Mac's key
 * (recovery phrase), the account it pays from, the two signatures, then extras.
 * The index at the top ticks what's done and says what still needs a signature.
 * `onOpenPrivacy` shows the "Privacy and your data" row; without it the row is hidden.
 */
export function ConnectNear({ onOpenPrivacy, spend, spendIsSample }: { onOpenPrivacy?: () => void; spend?: Spend | null; spendIsSample?: boolean } = {}) {
  const n = useNearSetup();
  const [nearAi, setNearAi] = useState(false);
  const [calendar, setCalendar] = useState<CalendarStatus | null>(null);
  /** Set up payments, open at a step ("auto": the first one not done). */
  const [setup, setSetup] = useState<SetupStep | "auto" | null>(null);

  const toSign = n.saved && n.status && !n.connected ? 2 - n.signed : 0;
  const index: { id: string; label: string; done?: boolean; pill?: string }[] = [
    { id: "settings-near-ai", label: "NEAR AI", done: nearAi },
    { id: "settings-key", label: "Recovery phrase", done: Boolean(n.recoveryStatus?.fromPhrase) },
    { id: "settings-account", label: "NEAR account", done: n.accountDone },
    { id: "settings-authorise", label: "Authorise", done: n.connected, pill: toSign ? `${toSign} to sign` : undefined },
    { id: "settings-calendar", label: "Calendar", done: calendar === "granted" },
    { id: "settings-shortcut", label: "Shortcut" },
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

          <section id="settings-account" tabIndex={-1} aria-labelledby="h-account" className="flex scroll-mt-12 flex-col gap-3 outline-none" style={rise(4)}>
            <SectionTitle id="h-account" count="proofs and payments">
              NEAR account
            </SectionTitle>
            <Card pad="none">
              <div className="p-5">
                <AccountFields
                  n={n}
                  action={
                    <Button variant="primary" loading={n.checking} disabled={!n.ready || !isDesktop} onClick={n.check}>
                      Save and check
                    </Button>
                  }
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-hairline px-5 py-3.5 text-[13px] leading-[19px]">
                <span className="text-ink-2">
                  {n.config.network === "mainnet" ? "Mainnet moves real USDC. Keep the caps small." : "Testnet moves test USDC, not real money."}
                </span>
                <Pop show={n.found.account === true && n.found.contract === "ok"}>
                  <span className="inline-flex items-center gap-1.5 font-medium text-verdigris">
                    <Check size={13} strokeWidth={2.5} aria-hidden="true" />
                    Account and Aftercall contract found
                  </span>
                </Pop>
              </div>
            </Card>
            <AccountNotes n={n} />
            <Why>
              Your agent wallet lives in this contract, and each meeting's proof is recorded there. A proof holds a hash and the model name, never what was
              said.
            </Why>
          </section>

          <Authorise n={n} />

          <div id="settings-calendar" tabIndex={-1} className="scroll-mt-12 outline-none" style={rise(6)}>
            <CalendarSettings onChange={setCalendar} />
          </div>

          <div id="settings-shortcut" tabIndex={-1} className="scroll-mt-12 outline-none" style={rise(7)}>
            <ShortcutSettings />
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

function Authorise({ n }: { n: NearSetup }) {
  const registered = Boolean(n.status?.registered);
  const keyAdded = Boolean(n.status?.keyAdded);
  const busy = !n.ready || Boolean(n.waiting) || !isDesktop;
  return (
    <section id="settings-authorise" tabIndex={-1} aria-labelledby="h-authorise" className="flex scroll-mt-12 flex-col gap-3 outline-none" style={rise(5)}>
      <div className="flex flex-col gap-1">
        <SectionTitle id="h-authorise" count="once, two signatures">
          Authorise this Mac
        </SectionTitle>
        <p className="m-0 text-ink-2">Both are signed in your own NEAR wallet.</p>
      </div>
      <Card as="ol" pad="none" className="m-0 list-none p-0">
        <AuthRow n={1} title="Create your agent wallet" done={registered} disabled={busy} onSign={() => n.signStep("Create wallet", "register")} />
        <AuthRow
          n={2}
          title="Authorise this Mac's key"
          detail={n.publicKey || (n.recoveryStatus && !n.recoveryStatus.hasKey ? "No key yet: create or restore a recovery phrase above." : "…")}
          mono={Boolean(n.publicKey)}
          done={keyAdded}
          disabled={busy || !n.publicKey}
          onSign={() => n.signStep("Authorise this Mac", "authorise-key")}
          last
        />
      </Card>
      {n.waiting && (
        <p aria-live="polite" className="m-0 flex items-center gap-2 text-[13px] text-ink-2">
          <Spinner size={12} /> Waiting for you to sign “{n.waiting}” in your browser…
        </p>
      )}
      <UnseenNote label={n.unseen?.label ?? null} checking={n.rechecking} onCheck={n.checkAgain} />
      {n.status?.keyProblem && <p className="m-0 text-[13px] leading-[19px] text-caution">{n.status.keyProblem}</p>}
      {n.error && n.errorFrom === "sign" && <p className="selectable m-0 text-[13px] leading-[19px] break-words text-record">{n.error}</p>}
      {!n.ready && !registered && <p className="m-0 text-[13px] leading-[19px] text-ink-2">Save your NEAR account above, then sign both.</p>}
      <Why defaultOpen>
        The first signature creates your agent wallet. The second lets this Mac's key call only <span className="font-mono text-ink">pay</span> and{" "}
        <span className="font-mono text-ink">record_proof</span>, within your caps. Raising a cap, adding a payee or withdrawing still needs your wallet.
      </Why>
      <Why label="Prefer near-cli?">
        {n.commands ? (
          <span className="flex flex-col gap-3">
            <span>Copy the two commands and run them in Terminal instead.</span>
            <Snippet text={n.commands.register} label="Copy the command that creates your agent wallet" />
            <Snippet text={n.commands.addKey} label="Copy the command that authorises this Mac's key" />
          </span>
        ) : (
          "Save your NEAR account above, and make this Mac's key; the two commands then appear here."
        )}
      </Why>
    </section>
  );
}

function AuthRow({
  n,
  title,
  detail,
  mono,
  done,
  disabled,
  onSign,
  last,
}: {
  n: number;
  title: string;
  detail?: string;
  mono?: boolean;
  done: boolean;
  disabled: boolean;
  onSign: () => void;
  last?: boolean;
}) {
  return (
    <li className={cx("flex items-center gap-4 px-5 py-4", !last && "border-b border-hairline")}>
      <span className="w-5 font-mono text-[13px] text-muted">0{n}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cx("t-title", done ? "text-ink-2" : "text-ink")}>{title}</span>
        {detail && <span className={cx("truncate text-ink-2", mono ? "selectable font-mono text-[12px] text-muted" : "text-[13px]")}>{detail}</span>}
      </span>
      <Pop show={done}>
        <Pill tone="verdigris" icon={<Check size={12} strokeWidth={2.5} aria-hidden="true" />}>
          Done
        </Pill>
      </Pop>
      {!done && (
        <Button variant="primary" disabled={disabled} onClick={onSign}>
          Sign in wallet
        </Button>
      )}
    </li>
  );
}
