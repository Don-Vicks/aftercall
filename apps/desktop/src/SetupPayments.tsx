import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { ArrowRight, Check, Clock, Coins, Cpu, ExternalLink, FlaskConical, Globe, KeyRound, Laptop, Link2, Lock, ShieldCheck, UserCheck, UserPlus, UserRound, Wallet } from "lucide-react";
import { exampleAccount, explorerAccountUrl, formatUsdc } from "@aftercall/core";
import { KEY_ALLOWANCE, KEY_METHODS, REGISTER_DEPOSIT, builtInContract, near, type NearConfig, type WalletView } from "./near";
import type { NearSetup } from "./nearSetup";
import { isDesktop } from "./recorder";
import { recovery } from "./recovery";
import { CheckCircle } from "./primitives/Check";
import { Button, Card, Field, Input, Select, Spinner, cx, toast } from "./ui";
import { IconDisc, Pop, Why, errorText, rise } from "./SettingsParts";
import { AmountSheet, PayeeSheet, useWalletSigning } from "./WalletScreen";
import { AssistantSheet, AssistantStep, BackButton, DetailRow, GuideRow, Inset, LaterButton, LinkButton, openLink } from "./SetupAssistant";
import { ConfirmStep, PhraseStep, appPhraseWords, useNewPhrase } from "./RecoveryPhrase";
import { CreateNameStep, CreatingStep, ImportStep, useWalletPhrase, walletPhraseWords } from "./CreateAccount";
import { METEOR_URL, nearAccount, type CreatedAccount } from "./nearAccount";

export type SetupStep = "intro" | "account" | "phrase" | "confirm" | "register" | "authorise" | "finish";

/** The bars at the top of the sheet: the welcome step has none, the two phrase screens share one. */
const PHASES = ["NEAR account", "Recovery phrase", "Agent wallet", "This Mac", "Before paying"] as const;
const PHASE: Record<SetupStep, number | null> = { intro: null, account: 0, phrase: 1, confirm: 1, register: 2, authorise: 3, finish: 4 };

/**
 * Where the account step stands: the question, the field, making one in Aftercall
 * ("create", the default for "Create one"), or the guide to making one in Meteor ("wallet-app").
 */
type AccountMode = "ask" | "have" | "create" | "wallet-app";

/** Making an account in Aftercall: the name, its phrase, three words back, the helper at work, then Meteor. */
type CreateStep = "name" | "words" | "check" | "creating" | "import";

/** Checked against the NEAR Connect wallet list (features.testnet) and the sites themselves, 2 Nov 2026. */
const FAUCET_URL = "https://docs.near.org/getting-started/faucet";

/**
 * Set up payments, as a setup assistant: what connecting NEAR gives you, the NEAR
 * account (or a short guide to making one on testnet), a recovery phrase for this
 * Mac's key (shown once, then three words typed back), the two wallet signatures,
 * each said in full before the wallet asks, and what's still needed before
 * Aftercall can pay (cap, deposit, payee). Steps already done are skipped. Nothing
 * is stored until the words are confirmed; closing drops a half-made phrase.
 */
export function SetupPayments({ near: n, start, onClose }: { near: NearSetup; start?: SetupStep; onClose: () => void }) {
  const fromPhrase = Boolean(n.recoveryStatus?.fromPhrase);
  const afterKey = (): SetupStep => (!n.status?.registered ? "register" : !n.status.keyAdded ? "authorise" : "finish");
  const [step, setStep] = useState<SetupStep>(() => start ?? (!n.accountDone ? "intro" : !fromPhrase ? "phrase" : afterKey()));
  const [mode, setMode] = useState<AccountMode>(() => (n.config.account ? "have" : "ask"));
  const go = (s: SetupStep) => setStep(s);

  const phrase = useNewPhrase();
  const [saving, setSaving] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  useEffect(() => {
    if (step === "phrase" && !phrase.phrase && !phrase.error) phrase.load();
  }, [step]);

  // A new account, made here. Its phrase is held in this component's state only, and dropped
  // as soon as three words are typed back; the public key stays for a retry with another name.
  const [createStep, setCreateStep] = useState<CreateStep>("name");
  const [newName, setNewName] = useState("");
  const wallet = useWalletPhrase();
  const [created, setCreated] = useState<CreatedAccount | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  /** An account was made in this visit, so Aftercall's own phrase screen says it's a second one. */
  const madeHere = created !== null;
  useEffect(() => {
    if (step === "account" && mode === "create" && createStep === "words" && !wallet.phrase && !wallet.error) wallet.load();
  }, [step, mode, createStep]);

  const createAccount = async () => {
    const key = wallet.publicKey;
    if (!key) return;
    // The words are on paper and checked: Aftercall lets go of them before anything is sent.
    wallet.forget();
    setCreateError(null);
    setCreateStep("creating");
    try {
      const made = await nearAccount.create(`${newName}.testnet`, key);
      setCreated(made);
      n.edit({ network: "testnet", account: made.accountId, contract: builtInContract("testnet") ?? "" });
      setCreateStep("import");
    } catch (e) {
      setCreateError(errorText(e));
    }
  };

  /** "I've imported it": the usual account check (and save), then on to Aftercall's own phrase. */
  const imported = async () => {
    if (await n.check()) go(fromPhrase ? afterKey() : "phrase");
  };

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
      go(n.accountDone ? "register" : "account");
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

  const wordsOrMaking = createStep === "words" || createStep === "check" || (createStep === "creating" && !createError);
  const phase = PHASE[step];
  return (
    <AssistantSheet
      label="Set up payments"
      phase={phase === null ? null : { index: phase, names: PHASES }}
      // Escape doesn't throw away words on screen, an account being made, or a signature you're waiting on.
      dismissible={step !== "phrase" && step !== "confirm" && !(step === "account" && mode === "create" && wordsOrMaking) && !n.waiting}
      busy={saving || (step === "account" && mode === "create" && createStep === "creating" && !createError)}
      onClose={close}
    >
      {step === "intro" && <IntroStep key="intro" n={n} onLater={close} onNext={() => go("account")} />}
      {step === "account" && mode === "ask" && <AskStep key="ask" onBack={() => go("intro")} onPick={setMode} />}
      {step === "account" && mode === "create" && createStep === "name" && (
        <CreateNameStep
          key="create-name"
          name={newName}
          onName={setNewName}
          onBack={() => setMode("ask")}
          // Words already written down and checked (a retry with another name) go straight to the helper.
          onNext={() => (wallet.publicKey && !wallet.phrase ? createAccount() : setCreateStep("words"))}
          onWalletApp={() => setMode("wallet-app")}
        />
      )}
      {step === "account" && mode === "create" && createStep === "words" && (
        <PhraseStep
          key="create-words"
          words={wallet.words}
          error={wallet.error}
          says={walletPhraseWords(`${newName}.testnet`)}
          onBack={() => {
            // Back to the name drops these words; a new set is made next time.
            wallet.forget();
            setCreateStep("name");
          }}
          onContinue={() => setCreateStep("check")}
        />
      )}
      {step === "account" && mode === "create" && createStep === "check" && (
        <ConfirmStep
          key="create-check"
          words={wallet.words}
          ask={wallet.ask}
          busy={false}
          error={null}
          intro={
            <>
              Type three of your wallet's words from your paper or kit: one from each third. Then Aftercall forgets them and creates{" "}
              <span className="font-mono text-[13px] text-ink">{newName}.testnet</span>.
            </>
          }
          icon={<Wallet size={22} strokeWidth={1.75} />}
          confirmLabel="Create account"
          onBack={() => setCreateStep("words")}
          onConfirm={createAccount}
        />
      )}
      {step === "account" && mode === "create" && createStep === "creating" && (
        <CreatingStep key="create-creating" account={`${newName}.testnet`} error={createError} onRetry={createAccount} onRename={() => setCreateStep("name")} />
      )}
      {step === "account" && mode === "create" && createStep === "import" && created && (
        <ImportStep key="create-import" created={created} checking={n.checking} error={n.error && n.errorFrom === "check" ? n.error : null} onNext={imported} />
      )}
      {step === "account" && mode === "wallet-app" && (
        <CreateGuide
          key="wallet-app"
          n={n}
          onBack={() => setMode("create")}
          onMade={() => {
            if (n.config.network !== "testnet") n.edit({ ...n.config, network: "testnet" });
            setMode("have");
          }}
        />
      )}
      {step === "account" && mode === "have" && (
        <AccountStep key="have" n={n} onBack={() => setMode("ask")} onCreate={() => setMode("create")} onNext={() => go(fromPhrase ? "register" : "phrase")} />
      )}
      {step === "phrase" && (
        <PhraseStep
          key="phrase"
          words={phrase.words}
          error={phrase.error}
          says={appPhraseWords(phrase.words.length || 12, madeHere)}
          onBack={() => go("account")}
          onContinue={() => go("confirm")}
        />
      )}
      {step === "confirm" && (
        <ConfirmStep key="confirm" words={phrase.words} ask={phrase.ask} busy={saving} error={keyError} onBack={() => go("phrase")} onConfirm={confirmWords} />
      )}
      {step === "register" && <SignStep key="register" n={n} kind="register" onBack={() => go("account")} onNext={() => go(afterKey())} />}
      {step === "authorise" && <SignStep key="authorise" n={n} kind="authorise-key" onBack={() => go("register")} onNext={() => go("finish")} />}
      {step === "finish" && <FinishStep key="finish" n={n} onDone={finish} />}
    </AssistantSheet>
  );
}

/* ——— Welcome ——— */

function IntroStep({ n, onLater, onNext }: { n: NearSetup; onLater: () => void; onNext: () => void }) {
  const testnet = n.config.network === "testnet";
  return (
    <AssistantStep
      icon={<Link2 size={22} strokeWidth={1.75} />}
      title="Proofs and payments on NEAR"
      intro="Optional: your notes work without it. A NEAR account adds two things."
      back={<LaterButton onClick={onLater}>Not now</LaterButton>}
      primary={
        <Button variant="primary" onClick={onNext}>
          Get started
          <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
        </Button>
      }
    >
      <WhatIsNear style={rise(1)} />

      <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0" style={rise(2)}>
        <Benefit icon={<ShieldCheck size={16} strokeWidth={1.75} />} title="A proof for each meeting">
          A public record anyone can check: a hash of the notes and the model's name. Never what was said.
        </Benefit>
        <Benefit icon={<Wallet size={16} strokeWidth={1.75} />} title="An agent wallet">
          It pays amounts agreed in meetings to people on your list, within caps only your wallet can change.
        </Benefit>
      </ul>

      <dl className="m-0 grid grid-cols-3 gap-2" style={rise(3)}>
        <Fact icon={<Clock size={14} strokeWidth={1.75} />} label="Time" value="About 5 min" note="Two signatures" />
        <Fact icon={<Coins size={14} strokeWidth={1.75} />} label="Cost" value="0.35 NEAR" mono note={`${REGISTER_DEPOSIT.replace(" NEAR", "")} storage + ${KEY_ALLOWANCE.replace(" NEAR", "")} fees`} />
        <Fact
          icon={<FlaskConical size={14} strokeWidth={1.75} />}
          label="Network"
          value={testnet ? "Testnet" : "Mainnet"}
          note={testnet ? "Test NEAR is free" : "Real NEAR and USDC"}
        />
      </dl>

      <section aria-labelledby="ahead-h" className="flex flex-col gap-2.5" style={rise(4)}>
        <h2 id="ahead-h" className="t-section m-0 text-ink">
          What you'll do
        </h2>
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
          {[
            ["Add your NEAR account", "or make one, free on testnet"],
            ["Write down a recovery phrase", "for this Mac's own key"],
            ["Create your agent wallet", "one signature"],
            ["Authorise this Mac", "one signature"],
            ["Set a cap, deposit and add a payee", "now or later"],
          ].map(([what, how], i) => (
            <li key={what} className="flex items-baseline gap-3 text-[14px] leading-[20px]">
              <span className="w-4 shrink-0 text-right font-mono text-[12px] text-muted">{i + 1}</span>
              <span className="text-ink">{what}</span>
              <span className="text-[13px] text-muted">{how}</span>
            </li>
          ))}
        </ol>
      </section>
    </AssistantStep>
  );
}

/** Four plain lines for someone who has never used NEAR, two by two. */
function WhatIsNear({ style }: { style?: CSSProperties }) {
  const lines: [ReactNode, ReactNode][] = [
    [
      <Globe size={14} strokeWidth={1.75} />,
      <>
        A public network with names you can read, like <span className="font-mono text-[12px] text-ink">yourname.testnet</span>.
      </>,
    ],
    [<KeyRound size={14} strokeWidth={1.75} />, "Your account is yours: your wallet holds its keys, not Aftercall."],
    [<Link2 size={14} strokeWidth={1.75} />, "Aftercall uses it for a public proof per meeting and an agent wallet with caps."],
    [<Cpu size={14} strokeWidth={1.75} />, "NEAR AI Cloud, where your notes are made, runs on secure hardware."],
  ];
  return (
    <section aria-labelledby="what-near" className="flex flex-col gap-2.5 rounded-md px-4 pt-3 pb-3.5 shadow-[inset_0_0_0_1px_var(--hairline)]" style={style}>
      <h2 id="what-near" className="t-eyebrow m-0 text-muted">
        What is NEAR?
      </h2>
      <ul className="m-0 grid list-none grid-cols-2 gap-x-5 gap-y-2 p-0">
        {lines.map(([icon, text], i) => (
          <li key={i} className="grid grid-cols-[14px_minmax(0,1fr)] items-baseline gap-x-2.5 text-[13px] leading-[18px] text-ink-2">
            <span aria-hidden="true" className="translate-y-[2px] text-muted">
              {icon}
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Benefit({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-2 rounded-md bg-elevated px-4 pt-3.5 pb-3.5 shadow-1">
      <span className="flex items-center gap-2.5">
        <IconDisc tone="verdigris" size={28}>
          {icon}
        </IconDisc>
        <span className="text-[15px] leading-5 font-semibold text-ink">{title}</span>
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[13px] leading-[19px] text-ink-2">{children}</span>
      </span>
    </li>
  );
}

function Fact({ icon, label, value, note, mono }: { icon: ReactNode; label: string; value: string; note: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-md px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--hairline)]">
      <dt className="t-eyebrow flex items-center gap-1.5 text-muted">
        <span aria-hidden="true">{icon}</span>
        {label}
      </dt>
      <dd className="m-0 flex flex-col gap-0.5">
        <span className={cx("text-ink", mono ? "font-mono text-[15px] leading-5 tabular-nums" : "text-[15px] leading-5 font-semibold")}>{value}</span>
        <span className="text-[12px] leading-4 text-muted">{note}</span>
      </dd>
    </div>
  );
}

/** A quiet aside on the sheet: an icon, a bold lead and a line or two. */
function Note({ icon, title, style, children }: { icon: ReactNode; title: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <aside className="flex items-start gap-3 rounded-md px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--hairline)]" style={style}>
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-muted">
        {icon}
      </span>
      <p className="m-0 text-[13px] leading-[19px] text-ink-2">
        <span className="font-semibold text-ink">{title}</span> {children}
      </p>
    </aside>
  );
}

/* ——— NEAR account ——— */

function AskStep({ onBack, onPick }: { onBack: () => void; onPick: (m: AccountMode) => void }) {
  const [pick, setPick] = useState<"have" | "create" | null>(null);
  return (
    <AssistantStep
      icon={<UserRound size={22} strokeWidth={1.75} />}
      title="Do you have a NEAR account?"
      intro={
        <>
          Your agent wallet belongs to it, and proofs are recorded under it. On testnet its name ends in <span className="font-mono text-ink">.testnet</span>.
        </>
      }
      back={<BackButton onClick={onBack} />}
      primary={
        <Button variant="primary" disabled={!pick} onClick={() => pick && onPick(pick)}>
          Continue
          <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
        </Button>
      }
    >
      <div role="radiogroup" aria-label="Do you have a NEAR account?" className="grid grid-cols-2 gap-3" style={rise(1)}>
        <Choice
          icon={<UserCheck size={18} strokeWidth={1.75} />}
          title="I have one"
          detail="In Meteor, Intear, Ledger or another NEAR wallet."
          selected={pick === "have"}
          onSelect={() => setPick("have")}
          onChoose={() => onPick("have")}
        />
        <Choice
          icon={<UserPlus size={18} strokeWidth={1.75} />}
          title="Create one"
          detail="Free on testnet. Aftercall makes it with you, in about two minutes."
          selected={pick === "create"}
          onSelect={() => setPick("create")}
          onChoose={() => onPick("create")}
        />
      </div>
      <Note icon={<UserRound size={15} strokeWidth={1.75} />} title="What's a NEAR account?" style={rise(2)}>
        A name on the NEAR network, like <span className="font-mono text-ink">{exampleAccount("testnet")}</span>. A wallet app such as Meteor holds its keys and
        signs for it. Aftercall keeps only the name. If it makes the account, it shows the phrase once and forgets it.
      </Note>
    </AssistantStep>
  );
}

/** A radio drawn as a card. A double click picks it and moves on. */
function Choice({
  icon,
  title,
  detail,
  selected,
  onSelect,
  onChoose,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  selected: boolean;
  onSelect: () => void;
  onChoose: () => void;
}) {
  return (
    <Card
      as="button"
      role="radio"
      aria-checked={selected}
      interactive
      pad="none"
      onClick={onSelect}
      onDoubleClick={onChoose}
      className={cx("relative flex flex-col items-start gap-3 px-5 pt-5 pb-[18px]", selected && "shadow-[0_0_0_1.5px_var(--verdigris)]! hover:shadow-[0_0_0_1.5px_var(--verdigris)]!")}
    >
      <IconDisc tone={selected ? "verdigris" : "well"} size={36}>
        {icon}
      </IconDisc>
      <span className="flex flex-col gap-1">
        <span className="text-[15px] leading-5 font-semibold text-ink">{title}</span>
        <span className="text-[13px] leading-[19px] text-ink-2">{detail}</span>
      </span>
      <span
        aria-hidden="true"
        className={cx(
          "absolute top-4 right-4 inline-flex size-[18px] items-center justify-center rounded-full transition-colors duration-[var(--dur-1)]",
          selected ? "bg-verdigris text-on-verdigris" : "shadow-[inset_0_0_0_1.5px_var(--border)]",
        )}
      >
        {selected && <Check size={11} strokeWidth={3} />}
      </span>
    </Card>
  );
}

/** "Use a wallet app instead": the account made in Meteor, then its name typed here. */
function CreateGuide({ n, onBack, onMade }: { n: NearSetup; onBack: () => void; onMade: () => void }) {
  return (
    <AssistantStep
      icon={<Wallet size={22} strokeWidth={1.75} />}
      title="Make an account in Meteor"
      intro="Testnet is NEAR's practice network: accounts and NEAR there are free and worth nothing. Leave this open while you do it."
      back={<BackButton onClick={onBack} />}
      primary={
        <Button variant="primary" onClick={onMade}>
          I've made it
          <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
        </Button>
      }
    >
      <Inset as="ol" style={rise(1)}>
        <GuideRow n={1} title="Create a wallet in Meteor" action={<LinkButton href={METEOR_URL}>Open Meteor</LinkButton>}>
          Meteor Wallet runs in the browser and works on testnet. Switch the network at the top of its page to{" "}
          <b className="font-semibold text-ink">Testnet</b>, then create a new wallet. Its recovery phrase is Meteor's, not Aftercall's: keep both.
        </GuideRow>
        <GuideRow n={2} title="Note your account name">
          It looks like <span className="font-mono text-ink">{exampleAccount("testnet")}</span>. If the wallet gives you a long string of letters and numbers
          instead, that works too.
        </GuideRow>
        <GuideRow n={3} title="Get free test NEAR" action={<LinkButton href={FAUCET_URL}>Open the faucet</LinkButton>}>
          NEAR's docs have a faucet: paste your account name and press Request Tokens. The two signatures need about 0.35 NEAR.
        </GuideRow>
      </Inset>
      <div style={rise(2)}>
        <Why label="Prefer the terminal?">
          <span className="flex flex-col gap-2">
            <span>With near-cli-rs installed, this makes the account, funds it from the faucet and keeps its key in your macOS keychain:</span>
            <code className="t-mono selectable w-fit rounded-sm bg-well px-2.5 py-1.5 text-ink shadow-[inset_0_0_0_1px_var(--hairline)]">
              near account create-account sponsor-by-faucet-service {n.config.account.endsWith(".testnet") ? n.config.account : exampleAccount("testnet")}{" "}
              autogenerate-new-keypair save-to-keychain network-config testnet create
            </code>
            <span>Its key lives in near-cli, not in a wallet app, so sign the two steps with the near-cli commands Settings shows once setup gets there.</span>
          </span>
        </Why>
      </div>
    </AssistantStep>
  );
}

function AccountStep({ n, onBack, onCreate, onNext }: { n: NearSetup; onBack: () => void; onCreate: () => void; onNext: () => void }) {
  const save = async () => {
    if (await n.check()) onNext();
  };
  return (
    <AssistantStep
      icon={<UserCheck size={22} strokeWidth={1.75} />}
      title="Your NEAR account"
      intro="Type it as your wallet shows it. Aftercall checks it exists on NEAR before anything is signed."
      back={<BackButton onClick={onBack} />}
      primary={
        <Button variant="primary" loading={n.checking} disabled={!n.ready || !isDesktop} onClick={save}>
          Check and continue
          <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
        </Button>
      }
    >
      <form
        className="flex flex-col gap-3"
        style={rise(1)}
        onSubmit={(e) => {
          e.preventDefault();
          if (n.ready && isDesktop && !n.checking) save();
        }}
      >
        <AccountFields n={n} />
        <AccountNotes n={n} />
      </form>
      <Note icon={<Lock size={15} strokeWidth={1.75} />} title="Only the name" style={rise(2)}>
        Aftercall reads this name to find your agent wallet. Your wallet keeps its keys and signs each change on the signing page in your browser.
      </Note>
      <p className="m-0 text-[13px] leading-[19px] text-ink-2" style={rise(3)}>
        No account yet?{" "}
        <button type="button" onClick={onCreate} className="press rounded-sm font-semibold text-verdigris hover:text-verdigris-hover">
          Make one on testnet
        </button>
      </p>
    </AssistantStep>
  );
}

/**
 * Account and network, with a tick once the check found the account. The
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
      <div className="grid grid-cols-[1fr_168px] gap-x-3 gap-y-3.5">
        <Field label="NEAR account" error={found.account === false ? `Not found on ${config.network}. Check the spelling and the network.` : undefined}>
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
            <span className="max-w-[320px]">{contractField}</span>
            {n.ownContract && (
              <button type="button" onClick={() => set({ contract: builtIn })} className="press w-fit rounded-sm font-semibold text-verdigris hover:text-verdigris-hover">
                Use Aftercall's contract
              </button>
            )}
          </span>
        </Why>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="max-w-[320px]">{contractField}</span>
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

/* ——— The two signatures ——— */

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

/** One signature: exactly what the wallet will show, then the signing page's state, from opening it to seeing it on NEAR. */
function SignStep({ n, kind, onBack, onNext }: { n: NearSetup; kind: "register" | "authorise-key"; onBack: () => void; onNext: () => void }) {
  const register = kind === "register";
  const label = register ? "Create wallet" : "Authorise this Mac";
  const done = register ? Boolean(n.status?.registered) : Boolean(n.status?.keyAdded);
  const waiting = n.waiting === label;
  const unseen = n.unseen?.kind === kind;
  const error = n.error && n.errorFrom === "sign" ? n.error : null;
  const account = n.saved?.account ?? n.config.account;
  const contract = n.config.contract;
  const noKey = !register && !n.publicKey;
  const blocked = !n.ready || !isDesktop || noKey || Boolean(n.waiting);
  const sign = () => n.signStep(label, kind);

  const mono = (s: string) => <span className="font-mono text-ink">{s}</span>;
  return (
    <AssistantStep
      icon={register ? <Wallet size={22} strokeWidth={1.75} /> : <Laptop size={22} strokeWidth={1.75} />}
      title={register ? "Create your agent wallet" : "Authorise this Mac"}
      intro={
        register ? (
          <>
            Your wallet will ask you to approve one transaction: {mono("register")} on {mono(contract)}, with {REGISTER_DEPOSIT} attached. It creates your agent
            wallet; only your wallet can change its rules.
          </>
        ) : (
          <>
            Your wallet will ask you to add a limited key for this Mac. It can only call {mono("pay")} and {mono("record_proof")}, with up to {KEY_ALLOWANCE} for
            fees. It can't change caps, add payees or withdraw.
          </>
        )
      }
      back={<BackButton onClick={onBack} disabled={Boolean(n.waiting)} />}
      primary={
        done ? (
          <Button variant="primary" onClick={onNext}>
            Continue
            <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
          </Button>
        ) : (
          <Button variant="primary" loading={waiting} disabled={blocked && !waiting} onClick={sign}>
            {waiting ? "Waiting for your wallet" : unseen ? "Open signing page again" : "Open signing page"}
            {!waiting && <ExternalLink size={14} strokeWidth={2} aria-hidden="true" />}
          </Button>
        )
      }
    >
      <section aria-labelledby={`${kind}-shows`} className="flex flex-col gap-2" style={rise(1)}>
        <h2 id={`${kind}-shows`} className="t-eyebrow m-0 text-muted">
          What your wallet will show
        </h2>
        <Inset as="dl">
          {register ? (
            <>
              <DetailRow label="Contract" mono>
                {contract}
              </DetailRow>
              <DetailRow label="Method" mono>
                register
              </DetailRow>
              <DetailRow label="Attached">
                <span className="font-mono">{REGISTER_DEPOSIT}</span>
                <span className="text-ink-2">, kept as your storage credit</span>
              </DetailRow>
              <DetailRow label="Signed as" mono>
                {account}
              </DetailRow>
            </>
          ) : (
            <>
              <DetailRow label="New key" mono>
                {n.publicKey || "None yet"}
              </DetailRow>
              <DetailRow label="May call" mono>
                {KEY_METHODS.join(", ")}
              </DetailRow>
              <DetailRow label="On contract" mono>
                {contract}
              </DetailRow>
              <DetailRow label="Fee allowance" mono>
                {KEY_ALLOWANCE}
              </DetailRow>
            </>
          )}
        </Inset>
      </section>

      <div className="flex flex-col gap-2.5" style={rise(2)}>
        <SignState
          state={done ? "seen" : waiting ? "waiting" : unseen ? "unseen" : "ready"}
          seen={register ? "Your agent wallet exists. Next, authorise this Mac." : `This Mac's key is on ${account}, limited as above.`}
          checking={n.rechecking}
          onCheck={n.checkAgain}
        />
        {noKey && <p className="m-0 text-[13px] leading-[19px] text-caution">This Mac has no key yet. Go back and make a recovery phrase first.</p>}
        {!register && n.status?.keyProblem && <p className="m-0 text-[13px] leading-[19px] text-caution">{n.status.keyProblem}</p>}
        {error && <p className="selectable m-0 text-[13px] leading-[19px] break-words text-record">{error}</p>}
        {!n.ready && <p className="m-0 text-[13px] leading-[19px] text-caution">Add your NEAR account first.</p>}
      </div>
    </AssistantStep>
  );
}

/** The signing page, as this Mac sees it: not opened yet, waiting for the wallet, not seen on NEAR in time, or seen. */
function SignState({ state, seen, checking, onCheck }: { state: "ready" | "waiting" | "unseen" | "seen"; seen: string; checking: boolean; onCheck: () => void }) {
  const copy = {
    ready: ["Signing happens in your browser", "The signing page opens there. Pick your wallet, check it shows the above, then approve."],
    waiting: ["Waiting for your wallet", "Approve it on the signing page in your browser. This updates by itself once NEAR has it."],
    unseen: ["Not seen on NEAR yet", "If you approved it, it may still be on its way. If you closed the page, open it again."],
    seen: ["Seen on NEAR", seen],
  }[state];
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        "flex items-center gap-3.5 rounded-md px-4 py-3.5",
        state === "seen" ? "bg-verdigris-tint" : state === "unseen" ? "bg-caution-tint" : "shadow-[inset_0_0_0_1px_var(--hairline)]",
      )}
    >
      <span aria-hidden="true" className="inline-flex size-7 shrink-0 items-center justify-center">
        {state === "seen" ? (
          <CheckCircle size={26} play />
        ) : state === "waiting" ? (
          <Spinner size={18} tone="verdigris" />
        ) : state === "unseen" ? (
          <Clock size={20} strokeWidth={1.75} className="text-caution" />
        ) : (
          <ExternalLink size={18} strokeWidth={1.75} className="text-muted" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cx("text-[14px] leading-5 font-semibold", state === "seen" ? "text-verdigris" : state === "unseen" ? "text-caution" : "text-ink")}>{copy[0]}</span>
        <span className="text-[13px] leading-[19px] text-ink-2">{copy[1]}</span>
      </span>
      {state === "unseen" && (
        <Button size="sm" loading={checking} onClick={onCheck}>
          Check again
        </Button>
      )}
    </div>
  );
}

/* ——— Before paying ——— */

function FinishStep({ n, onDone }: { n: NearSetup; onDone: (canPay: boolean) => void }) {
  const [view, setView] = useState<WalletView | null>(null);
  const signing = useWalletSigning(setView);
  useEffect(() => {
    if (!isDesktop) return;
    near
      .wallet()
      .then(setView)
      .catch(() => {});
  }, []);
  const w = view?.wallet ?? null;
  // A daily cap of 0 parks every payment for your wallet; a per-payment cap of 0 means none
  // (only autopilot needs one), so the daily cap alone decides whether this Mac can pay.
  const canPay = Boolean(w && BigInt(w.daily_cap) > 0n && BigInt(w.balance) > 0n && view && view.payees.length > 0);
  return (
    <AssistantStep
      icon={<Check size={22} strokeWidth={2} />}
      title={canPay ? "Ready to pay" : "This Mac is connected"}
      intro="Proofs now go on NEAR when a meeting's notes are made. Three more signatures and Aftercall can pay: do them now, or later in Agent wallet."
      back={<span />}
      primary={
        <Button variant="primary" disabled={Boolean(signing.waiting)} onClick={() => onDone(canPay)}>
          Done
        </Button>
      }
    >
      <PayChecklist view={view} network={n.config.network} signing={signing} />
      <WhereNext n={n} />
    </AssistantStep>
  );
}

/** "Where to go next": your account and the agent-wallet contract on NearBlocks, and Meteor. */
function WhereNext({ n }: { n: NearSetup }) {
  const { network, contract } = n.config;
  const account = n.saved?.account ?? n.config.account;
  const links = [
    { title: "Your account", detail: `${account} on NearBlocks`, href: explorerAccountUrl(network, account) },
    { title: "Agent-wallet contract", detail: `${contract}: caps and proofs`, href: explorerAccountUrl(network, contract) },
    { title: "Meteor Wallet", detail: "Your wallet, if you use Meteor", href: METEOR_URL },
  ];
  return (
    <section aria-labelledby="next-h" className="flex flex-col gap-2" style={rise(2)}>
      <h2 id="next-h" className="t-eyebrow m-0 text-muted">
        Where to go next
      </h2>
      <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0">
        {links.map((l) => (
          <li key={l.title} className="flex">
            <button
              type="button"
              onClick={() => openLink(l.href)}
              className="press group flex w-full flex-col gap-1 rounded-md px-3.5 py-3 text-left shadow-[inset_0_0_0_1px_var(--hairline)] transition-colors duration-[var(--dur-1)] hover:bg-elevated"
            >
              <span className="flex items-center justify-between gap-2 text-[13px] leading-[18px] font-semibold text-ink">
                {l.title}
                <ExternalLink size={12} strokeWidth={2} aria-hidden="true" className="shrink-0 text-muted group-hover:text-ink-2" />
              </span>
              <span className="text-[12px] leading-4 break-words text-muted">{l.detail}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
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

  return (
    <section aria-label="Before Aftercall can pay" className="flex flex-col gap-2.5" style={rise(1)}>
      <Inset as="ol">
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-3.5 px-4 py-3.5">
            {i.done ? (
              <CheckCircle size={24} play />
            ) : (
              <span aria-hidden="true" className="inline-flex size-6 shrink-0 rounded-full shadow-[inset_0_0_0_1.5px_var(--border)]" />
            )}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={cx("text-[15px] leading-5 font-semibold", i.done ? "text-ink-2" : "text-ink")}>
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
      </Inset>
      {signing.waiting && (
        <p aria-live="polite" className="m-0 flex items-center gap-2 text-[13px] text-ink-2">
          <Spinner size={12} /> Waiting for you to sign “{signing.waiting}” in your browser…
        </p>
      )}
      <UnseenNote label={signing.unseenLabel} checking={signing.checking} onCheck={signing.checkAgain} />
      <p className="m-0 flex items-center gap-2 text-[13px] leading-[18px] text-ink-2">
        <ShieldCheck size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-muted" />
        Your wallet signs every change, so this Mac can't raise what it may spend.
      </p>

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
