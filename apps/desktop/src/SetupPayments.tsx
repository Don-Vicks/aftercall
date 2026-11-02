import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { ArrowRight, Check, ExternalLink, ShieldCheck } from "lucide-react";
import { exampleAccount, formatUsdc } from "@aftercall/core";
import { near, type NearConfig } from "./near";
import type { NearSetup } from "./nearSetup";
import { isDesktop } from "./recorder";
import { recovery } from "./recovery";
import { CheckCircle } from "./primitives/Check";
import { Button, Dialog, Field, Input, Pill, SectionTitle, Select, Spinner, cx, toast } from "./ui";
import { Pop, errorText, rise } from "./SettingsParts";
import { QuietAction, StepActions, StepHeading, StepPage, StepProgress } from "./Flow";
import { ConfirmStep, PhraseStep, useNewPhrase } from "./RecoveryPhrase";

export type SetupStep = "account" | "phrase" | "confirm" | "wallet";
const ORDER: SetupStep[] = ["account", "phrase", "confirm", "wallet"];

/**
 * Set up payments, full screen: the NEAR account, a recovery phrase for this Mac's
 * key (shown once, then three words typed back), and the two wallet signatures.
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

  const finish = (capsSet: boolean) => {
    toast({
      text: capsSet ? "This Mac can now pay within your caps" : "This Mac is authorised. Set a daily cap in Agent wallet to start paying.",
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
      <StepHeading title="Your NEAR account" intro="The account Aftercall pays from, and the agent-wallet contract it pays through." style={rise(1)} />
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

/** Account, contract and network, with a tick in each field once "Save and check" found it on NEAR. */
export function AccountFields({ n, action }: { n: NearSetup; action?: ReactNode }) {
  const { config, found } = n;
  const set = (patch: Partial<NearConfig>) => n.edit({ ...config, ...patch });
  const notFound = `Not found on ${config.network}.`;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
      <Field label="NEAR account" error={found.account === false ? notFound : undefined}>
        <FoundInput found={found.account} value={config.account} placeholder={exampleAccount(config.network)} onChange={(account) => set({ account })} />
      </Field>
      <Field label="Agent-wallet contract" error={found.contract === false ? notFound : undefined}>
        <FoundInput
          found={found.contract}
          value={config.contract}
          placeholder={exampleAccount(config.network, "aftercall-wallet")}
          onChange={(contract) => set({ contract })}
        />
      </Field>
      <Field label="Network">
        <Select value={config.network} onChange={(e) => set({ network: e.target.value as NearConfig["network"] })}>
          <option value="testnet">Testnet</option>
          <option value="mainnet">Mainnet</option>
        </Select>
      </Field>
      {action && <div className="flex items-end justify-end">{action}</div>}
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
      {n.error && n.errorFrom === "check" && <p className="selectable m-0 text-[13px] leading-[19px] break-words text-record">{n.error}</p>}
    </>
  );
}

function WalletStep({ n, onLater, onDone }: { n: NearSetup; onLater: () => void; onDone: (capsSet: boolean) => void }) {
  const registered = Boolean(n.status?.registered);
  const keyAdded = Boolean(n.status?.keyAdded);
  const next = !registered ? "register" : !keyAdded ? "authorise-key" : null;
  const [caps, setCaps] = useState<{ daily: bigint; payment: bigint } | null>(null);

  useEffect(() => {
    if (!isDesktop || !registered) return;
    near
      .wallet()
      .then((v) => v.wallet && setCaps({ daily: BigInt(v.wallet.daily_cap), payment: BigInt(v.wallet.per_payment_cap) }))
      .catch(() => {});
  }, [registered]);

  const sign = () => (next === "register" ? n.signStep("Create wallet", "register") : n.signStep("Authorise this Mac", "authorise-key"));
  // A daily cap of 0 parks every payment for your wallet; a per-payment cap of 0 means none
  // (only autopilot needs one), so the daily cap alone decides whether this Mac can pay.
  const capsSet = Boolean(caps && caps.daily > 0n);

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
        {n.status?.keyProblem && <p className="m-0 text-[13px] leading-[19px] text-caution">{n.status.keyProblem}</p>}
        {n.error && n.errorFrom === "sign" && <p className="selectable m-0 text-[13px] leading-[19px] break-words text-record">{n.error}</p>}
        {!n.ready && <p className="m-0 text-[13px] leading-[19px] text-caution">Add your NEAR account and contract first.</p>}
      </section>

      <section aria-labelledby="caps-h" className="flex flex-col gap-3" style={rise(3)}>
        <SectionTitle id="caps-h" count="this Mac can't raise them">
          Your caps
        </SectionTitle>
        <dl className="m-0 grid grid-cols-2 gap-3">
          {(
            [
              ["Daily cap", caps?.daily],
              ["Per payment", caps?.payment],
            ] as const
          ).map(([label, value]) => {
            // A per-payment cap read as 0 means there is none (lib.rs `pay`); not read yet shows 0.00 like the daily cap.
            const noCap = label === "Per payment" && value === 0n;
            return (
              <div key={label} className="flex flex-col gap-1 rounded-md px-4 py-3 shadow-[inset_0_0_0_1px_var(--hairline)]">
                <dt className="text-[13px] leading-[18px] font-semibold text-ink-2">{label}</dt>
                <dd className={cx("m-0 text-[15px] leading-[22px] text-ink", !noCap && "font-mono")}>
                  {noCap ? (
                    "No cap"
                  ) : (
                    <>
                      {formatUsdc(value ?? 0n)} <span className="text-xs text-muted">USDC</span>
                    </>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
        <p className="m-0 text-[13px] leading-[19px] text-ink-2">
          {capsSet
            ? "Change them in Agent wallet; your wallet signs each change."
            : "A new agent wallet starts with a 0.00 daily cap, so every payment waits for your wallet until you set one in Agent wallet."}
        </p>
      </section>

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
          <Button variant="primary" size="lg" onClick={() => onDone(capsSet)}>
            Done
          </Button>
        )}
      </StepActions>
    </>
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
