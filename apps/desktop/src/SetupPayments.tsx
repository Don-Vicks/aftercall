import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { ArrowRight, Check, ExternalLink, ShieldCheck } from "lucide-react";
import { exampleAccount, formatUsdc } from "@aftercall/core";
import { near, type NearConfig, type WalletView } from "./near";
import type { NearSetup } from "./nearSetup";
import { isDesktop } from "./recorder";
import { recovery } from "./recovery";
import { CheckCircle } from "./primitives/Check";
import { Button, Dialog, Field, Input, Pill, SectionTitle, Select, Spinner, cx, toast } from "./ui";
import { Pop, Why, errorText, rise } from "./SettingsParts";
import { AmountSheet, PayeeSheet, useWalletSigning } from "./WalletScreen";
import { QuietAction, StepActions, StepHeading, StepPage, StepProgress } from "./Flow";
import { ConfirmStep, PhraseStep, useNewPhrase } from "./RecoveryPhrase";

export type SetupStep = "account" | "phrase" | "confirm" | "wallet";
const ORDER: SetupStep[] = ["account", "phrase", "confirm", "wallet"];

/**
 * Set up payments, full screen: the NEAR account, a recovery phrase for this Mac's
 * key (shown once, then three words typed back), and the two wallet signatures,
 * ending with what's still needed before Aftercall can pay (cap, deposit, payee).
 * Steps already done are skipped; the counter keeps the full four so it reads the
 * same every time. Nothing is stored until the words are confirmed. Escape and
 * "Set up later" leave without saving a half-made phrase.
 */
export function SetupPayments({ near: n, start, onClose }: { near: NearSetup; start?: SetupStep; onClose: () => void }) {
  const fromPhrase = Boolean(n.recoveryStatus?.fromPhrase);
  const [step, setStep] = useState<SetupStep>(() => start ?? (!n.accountDone ? "account" : !fromPhrase ? "phrase" : "wallet"));
  const go = (s: SetupStep) => setStep(s);

  const phrase = useNewPhrase();
  const [saving, setSaving] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  useEffect(() => {
    if (step === "phrase" && !phrase.phrase && !phrase.error) phrase.load();
  }, [step]);

  // The phrase lives only in this component's state, so closing drops it. (No state
  // change here: a re-render while the dialog animates out would draw it twice.)
  const close = onClose;

  const confirmWords = async () => {
    if (!phrase.phrase) return;
    setKeyError(null);
    setSaving(true);
    try {
      await recovery.usePhrase(phrase.phrase);
      phrase.forget();
      await n.keyChanged();
      go(n.accountDone ? "wallet" : "account");
    } catch (e) {
      setKeyError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const finish = (canPay: boolean) => {
    toast({
      text: canPay ? "This Mac can now pay within your caps" : "This Mac is authorised. Finish the rest in Agent wallet to start paying.",
      tone: "verdigris",
    });
    close();
  };

  return (
    <Dialog placement="full" aria-label="Set up payments" onClose={close} dismissible={step === "account" || step === "wallet"}>
      <StepProgress step={ORDER.indexOf(step)} total={ORDER.length} label="Set up payments" />
      <AnimatePresence mode="wait" initial={false}>
        {step === "account" && (
          <StepPage key="account">
            <AccountStep n={n} onLater={close} onNext={() => go(n.recoveryStatus?.fromPhrase ? "wallet" : "phrase")} />
          </StepPage>
        )}
        {step === "phrase" && (
          <StepPage key="phrase">
            <PhraseStep words={phrase.words} error={phrase.error} onLater={close} onContinue={() => go("confirm")} />
          </StepPage>
        )}
        {step === "confirm" && (
          <StepPage key="confirm">
            <ConfirmStep words={phrase.words} ask={phrase.ask} busy={saving} error={keyError} onBack={() => go("phrase")} onConfirm={confirmWords} />
          </StepPage>
        )}
        {step === "wallet" && (
          <StepPage key="wallet">
            <WalletStep n={n} onLater={close} onDone={finish} />
          </StepPage>
        )}
      </AnimatePresence>
    </Dialog>
  );
}

function AccountStep({ n, onLater, onNext }: { n: NearSetup; onLater: () => void; onNext: () => void }) {
  const save = async () => {
    if (await n.check()) onNext();
  };
  return (
    <>
      <StepHeading title="Your NEAR account" intro="The account Aftercall pays from. Your agent wallet lives in Aftercall's contract on the network you pick." style={rise(1)} />
      <div className="flex flex-col gap-3" style={rise(2)}>
        <AccountFields n={n} />
        <AccountNotes n={n} />
      </div>
      <StepActions style={rise(3)}>
        <QuietAction onClick={onLater}>Set up later</QuietAction>
        <Button variant="primary" size="lg" loading={n.checking} disabled={!n.ready || !isDesktop} onClick={save}>
          Save and continue
          <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
        </Button>
      </StepActions>
    </>
  );
}

/**
 * Account and network, with a tick once "Save and check" found the account. The
 * contract is Aftercall's own for the network, folded under "Advanced" for anyone
 * running their own deployment; on a network with none yet (mainnet), it's open.
 */
export function AccountFields({ n, action }: { n: NearSetup; action?: ReactNode }) {
  const { config, found, builtIn } = n;
  const set = (patch: Partial<NearConfig>) => n.edit({ ...config, ...patch });
  const contractField = (
    <Field label="Agent-wallet contract">
      <FoundInput
        found={found.contract === "ok"}
        value={config.contract}
        placeholder={exampleAccount(config.network, "wallet.yourname")}
        onChange={(contract) => set({ contract })}
      />
    </Field>
  );
  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
        <Field label="NEAR account" error={found.account === false ? `Not found on ${config.network}.` : undefined}>
          <FoundInput found={found.account} value={config.account} placeholder={exampleAccount(config.network)} onChange={(account) => set({ account })} />
        </Field>
        <Field label="Network">
          <Select value={config.network} onChange={(e) => set({ network: e.target.value as NearConfig["network"] })}>
            <option value="testnet">Testnet</option>
            <option value="mainnet">Mainnet</option>
          </Select>
        </Field>
      </div>
      {builtIn ? (
        // Keyed so a saved custom contract opens it once loaded, and a network switch resets it.
        <Why key={`${config.network}-${n.loaded}`} label="Advanced: use your own deployment" defaultOpen={n.ownContract}>
          <span className="flex flex-col gap-2.5">
            <span>
              Aftercall's contract on {config.network} is <span className="font-mono text-ink">{builtIn}</span>. Change it only if you deployed{" "}
              <span className="font-mono text-ink">contracts/agent-wallet</span> yourself.
            </span>
            <span className="max-w-[calc(50%-8px)] min-w-[240px]">{contractField}</span>
            {n.ownContract && (
              <button type="button" onClick={() => set({ contract: builtIn })} className="press w-fit rounded-sm font-semibold text-verdigris hover:text-verdigris-hover">
                Use Aftercall's contract
              </button>
            )}
          </span>
        </Why>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="max-w-[calc(50%-8px)] min-w-[240px]">{contractField}</span>
          <p className="m-0 text-[13px] leading-[19px] text-ink-2">
            There's no Aftercall contract on {config.network} yet. Enter your own deployment of <span className="font-mono text-ink">contracts/agent-wallet</span>, or pick testnet.
          </p>
        </div>
      )}
      {action && <div className="flex justify-end">{action}</div>}
    </div>
  );
}

function FoundInput({ found, value, placeholder, onChange }: { found?: boolean; value: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <span className="relative flex">
      <Input
        mono
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        onChange={(e) => onChange(e.target.value.trim().toLowerCase())}
        className="pr-9!"
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
        <Pop show={found === true}>
          <Check size={14} strokeWidth={2.5} role="img" aria-label="Found on NEAR" className="text-verdigris" />
        </Pop>
      </span>
    </span>
  );
}

/** What's wrong (or worth knowing) about the account as typed. */
export function AccountNotes({ n }: { n: NearSetup }) {
  return (
    <>
      {!isDesktop && <p className="m-0 text-[13px] leading-[19px] text-ink-2">Connecting NEAR works in the Mac app, not the browser preview.</p>}
      {n.wrongNetwork && (
        <p className="m-0 text-[13px] leading-[19px] text-caution">
          <span className="t-mono">{n.wrongNetwork}</span> isn't a {n.config.network} account. Pick the network it lives on.
        </p>
      )}
      {n.contractProblem && <p className="m-0 text-[13px] leading-[19px] text-record">{n.contractProblem}</p>}
      {n.error && n.errorFrom === "check" && <p className="selectable m-0 text-[13px] leading-[19px] break-words text-record">{n.error}</p>}
    </>
  );
}

/** "Didn't see it on NEAR yet" after the two minutes, with one more look for a slow wallet. */
export function UnseenNote({ label, checking, onCheck }: { label: string | null; checking: boolean; onCheck: () => void }) {
  if (!label) return null;
  return (
    <p role="status" className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] leading-[19px] text-caution">
      Didn't see “{label}” on NEAR yet. If you signed, it may still be on its way.
      <Button size="sm" loading={checking} onClick={onCheck}>
        Check again
      </Button>
    </p>
  );
}

function WalletStep({ n, onLater, onDone }: { n: NearSetup; onLater: () => void; onDone: (canPay: boolean) => void }) {
  const registered = Boolean(n.status?.registered);
  const keyAdded = Boolean(n.status?.keyAdded);
  const next = !registered ? "register" : !keyAdded ? "authorise-key" : null;
  const [view, setView] = useState<WalletView | null>(null);
  const signing = useWalletSigning(setView);

  useEffect(() => {
    if (!isDesktop || !registered) return;
    near
      .wallet()
      .then(setView)
      .catch(() => {});
  }, [registered, keyAdded]);

  const sign = () => (next === "register" ? n.signStep("Create wallet", "register") : n.signStep("Authorise this Mac", "authorise-key"));
  const w = view?.wallet ?? null;
  const caps = w ? { daily: BigInt(w.daily_cap), payment: BigInt(w.per_payment_cap) } : null;
  // A daily cap of 0 parks every payment for your wallet; a per-payment cap of 0 means none
  // (only autopilot needs one), so the daily cap alone decides whether this Mac can pay.
  const capsSet = Boolean(caps && caps.daily > 0n);
  const canPay = capsSet && Boolean(w && BigInt(w.balance) > 0n) && Boolean(view && view.payees.length > 0);

  return (
    <>
      <StepHeading title="Set up your agent wallet" intro="Two signatures in your NEAR wallet, then Aftercall pays within your caps." style={rise(1)} />
      <section aria-labelledby="sign-h" className="flex flex-col gap-3" style={rise(2)}>
        <SectionTitle id="sign-h" count={`${n.signed} of 2 done`}>
          Sign in your wallet
        </SectionTitle>
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          <SignRow
            n={1}
            title="Create your agent wallet"
            done={registered}
            current={next === "register"}
            detail={
              registered ? (
                <span className="font-mono text-muted">signed by {n.saved?.account ?? n.config.account}</span>
              ) : (
                "Holds the USDC Aftercall pays from. Only your wallet can withdraw."
              )
            }
          />
          <SignRow
            n={2}
            title="Authorise this Mac's key"
            done={keyAdded}
            current={next === "authorise-key"}
            detail={
              <>
                It can call only <span className="font-mono text-ink">pay</span> and <span className="font-mono text-ink">record_proof</span>, nothing else.
              </>
            }
          />
        </ol>
        {n.waiting && (
          <p aria-live="polite" className="m-0 flex items-center gap-2 text-[13px] text-ink-2">
            <Spinner size={12} /> Waiting for you to sign “{n.waiting}” in your browser…
          </p>
        )}
        <UnseenNote label={n.unseen?.label ?? null} checking={n.rechecking} onCheck={n.checkAgain} />
        {n.status?.keyProblem && <p className="m-0 text-[13px] leading-[19px] text-caution">{n.status.keyProblem}</p>}
        {n.error && n.errorFrom === "sign" && <p className="selectable m-0 text-[13px] leading-[19px] break-words text-record">{n.error}</p>}
        {!n.ready && <p className="m-0 text-[13px] leading-[19px] text-caution">Add your NEAR account first.</p>}
      </section>

      {next ? (
        <section aria-labelledby="caps-h" className="flex flex-col gap-3" style={rise(3)}>
          <SectionTitle id="caps-h" count="this Mac can't raise them">
            Your caps
          </SectionTitle>
          <p className="m-0 text-[13px] leading-[19px] text-ink-2">
            A new agent wallet starts with a 0.00 daily cap, so every payment waits for your wallet until you set one. You can set it right after these two
            signatures.
          </p>
        </section>
      ) : (
        <PayChecklist view={view} network={n.config.network} signing={signing} />
      )}

      <p className="-mt-1.5 flex items-center gap-2 text-[13px] leading-[18px] text-ink-2" style={rise(4)}>
        <ShieldCheck size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-muted" />
        Your wallet signs any change, so only you can change what this Mac may spend.
      </p>

      <StepActions style={rise(5)}>
        <QuietAction onClick={onLater}>Set up later</QuietAction>
        {next ? (
          <Button
            variant="primary"
            size="lg"
            loading={Boolean(n.waiting)}
            disabled={!n.ready || !isDesktop || (next === "authorise-key" && !n.publicKey)}
            onClick={sign}
          >
            Sign in wallet
            <ExternalLink size={15} strokeWidth={2} aria-hidden="true" />
          </Button>
        ) : (
          <Button variant="primary" size="lg" disabled={Boolean(signing.waiting)} onClick={() => onDone(canPay)}>
            Done
          </Button>
        )}
      </StepActions>
    </>
  );
}

/**
 * What's still needed before Aftercall can pay, ticked from the live wallet. Each
 * button starts the same signing as Agent wallet: a cap above 0, some USDC, a payee.
 */
function PayChecklist({ view, network, signing }: { view: WalletView | null; network: NearConfig["network"]; signing: ReturnType<typeof useWalletSigning> }) {
  const [sheet, setSheet] = useState<"cap" | "deposit" | "payee" | null>(null);
  const w = view?.wallet ?? null;
  const cap = w ? BigInt(w.daily_cap) : 0n;
  const balance = w ? BigInt(w.balance) : 0n;
  const payees = view?.payees ?? [];
  const busy = Boolean(signing.waiting);
  const items = [
    { id: "cap", title: "Set a daily cap", done: cap > 0n, detail: cap > 0n ? `${formatUsdc(cap)} USDC a day` : "At 0.00, every payment waits for your wallet." },
    { id: "deposit", title: "Deposit USDC", done: balance > 0n, detail: balance > 0n ? `${formatUsdc(balance)} USDC in your agent wallet` : "Aftercall pays from this balance." },
    { id: "payee", title: "Add a payee", done: payees.length > 0, detail: payees.length > 0 ? payees.map((p) => p.label || p.account).join(", ") : "Aftercall pays only people on your list." },
  ] as const;
  const left = items.filter((i) => !i.done).length;

  return (
    <section aria-labelledby="pay-h" className="flex flex-col gap-3" style={rise(3)}>
      <SectionTitle id="pay-h" count={left ? `${left} to sign` : "ready"}>
        Before Aftercall can pay
      </SectionTitle>
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-3.5 rounded-md px-[18px] py-3">
            {i.done ? (
              <CheckCircle size={24} play />
            ) : (
              <span aria-hidden="true" className="inline-flex size-6 shrink-0 rounded-full shadow-[inset_0_0_0_1px_var(--border)]" />
            )}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={cx("t-title", i.done ? "text-ink-2" : "text-ink")}>
                {i.title}
                {i.done && <span className="sr-only">, done</span>}
              </span>
              <span className="truncate text-[13px] leading-[18px] text-ink-2">{i.detail}</span>
            </span>
            {!i.done && (
              <Button size="sm" disabled={busy || !view} onClick={() => setSheet(i.id)}>
                Sign in wallet
              </Button>
            )}
          </li>
        ))}
      </ol>
      {signing.waiting && (
        <p aria-live="polite" className="m-0 flex items-center gap-2 text-[13px] text-ink-2">
          <Spinner size={12} /> Waiting for you to sign “{signing.waiting}” in your browser…
        </p>
      )}
      <UnseenNote label={signing.unseenLabel} checking={signing.checking} onCheck={signing.checkAgain} />

      <AnimatePresence>
        {sheet === "cap" && (
          <AmountSheet
            key="cap"
            title="Set a daily cap"
            intro="The most Aftercall may pay in a day, all payments together. Your wallet signs it."
            hint={async () => "Payments over it wait for your wallet."}
            confirm="Set in wallet"
            onClose={() => setSheet(null)}
            onConfirm={(v) => {
              setSheet(null);
              signing.signAndWait("Set daily cap", { kind: "set-cap", dailyCap: v.toString() }, (x) => x.wallet?.daily_cap === v.toString(), () => `Daily cap is ${formatUsdc(v)} USDC on NEAR`);
            }}
          />
        )}
        {sheet === "deposit" && (
          <AmountSheet
            key="deposit"
            title="Deposit USDC"
            intro="Moves USDC from your NEAR account into your agent wallet. Your wallet signs it."
            hint={async () => `You have ${formatUsdc(BigInt(await near.ownerUsdc()))} USDC on ${(await near.getConfig())?.account}.`}
            confirm="Deposit in wallet"
            onClose={() => setSheet(null)}
            onConfirm={(amount) => {
              setSheet(null);
              signing.signAndWait("Deposit", { kind: "deposit", amount: amount.toString() }, (v) => BigInt(v.wallet?.balance ?? "0") > balance, () => `Deposited ${formatUsdc(amount)} USDC`);
            }}
          />
        )}
        {sheet === "payee" && (
          <PayeeSheet
            key="payee"
            network={network}
            onClose={() => setSheet(null)}
            onConfirm={(account, label, registerWithUsdc, destination) => {
              setSheet(null);
              signing.signAndWait(
                "Add payee",
                { kind: "add-payee", account, label, registerWithUsdc, destination },
                (v) => v.payees.some((p) => p.account === account),
                () => `${label} can be paid now`,
              );
            }}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

function SignRow({ n, title, detail, done, current }: { n: number; title: string; detail: ReactNode; done: boolean; current: boolean }) {
  return (
    <li
      aria-current={current ? "step" : undefined}
      className={cx("flex items-center gap-3.5 rounded-md px-[18px]", current ? "bg-elevated py-4 shadow-1" : "py-3")}
    >
      {done ? (
        <CheckCircle size={28} play />
      ) : (
        <span
          aria-hidden="true"
          className={cx(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-[13px] font-medium",
            current ? "text-verdigris shadow-[inset_0_0_0_1.5px_var(--verdigris)]" : "text-ink-2 shadow-[inset_0_0_0_1px_var(--border)]",
          )}
        >
          {n}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cx("t-title", done ? "text-ink-2" : "text-ink")}>{title}</span>
        <span className="text-[13px] leading-[18px] text-ink-2">{detail}</span>
      </span>
      {done ? (
        <Pill tone="verdigris" icon={<Check size={12} strokeWidth={2.5} aria-hidden="true" />}>
          Done
        </Pill>
      ) : current ? (
        <Pill tone="muted">Next</Pill>
      ) : null}
    </li>
  );
}
