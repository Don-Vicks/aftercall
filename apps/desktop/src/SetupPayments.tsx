import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { ArrowRight, Check, Clock, Coins, ExternalLink, FlaskConical, KeyRound, Link2, ShieldCheck, UserCheck, UserPlus, Wallet } from "lucide-react";
import { exampleAccount, formatUsdc } from "@aftercall/core";
import { KEY_ALLOWANCE, KEY_METHODS_TEXT, REGISTER_DEPOSIT, builtInContract, near, type NearConfig, type WalletView } from "./near";
import type { NearSetup, SetupAction } from "./nearSetup";
import { isDesktop } from "./recorder";
import { recovery } from "./recovery";
import { CheckCircle } from "./primitives/Check";
import { Button, Field, Input, Select, Spinner, cx, toast } from "./ui";
import { IconDisc, Pop, Why, errorText, rise } from "./SettingsParts";
import { AmountSheet, PayeeSheet, parseUsdcInput, useWalletSigning } from "./WalletScreen";
import { AssistantSheet, AssistantStep, BackButton, DetailRow, GuideRow, Inset, LaterButton, LinkButton, openLink } from "./SetupAssistant";
import { ConfirmStep, PhraseStep, TwoPhrases, appPhraseWords, useNewPhrase } from "./RecoveryPhrase";
import { CreateNameStep, CreatingStep, MeteorImport, suggestedName, useWalletPhrase, walletPhraseWords } from "./CreateAccount";
import { METEOR_URL, nearAccount, type CreatedAccount } from "./nearAccount";

export type SetupStep = "intro" | "account" | "phrase" | "confirm" | "sign" | "ready";

/** The rail at the top of the sheet: three stages, always in view. */
const STAGES = ["Your account", "This Mac's key", "Sign in your wallet"] as const;
const STAGE: Record<SetupStep, number> = { intro: -1, account: 0, phrase: 1, confirm: 1, sign: 2, ready: 3 };

/**
 * Where the account step stands: making one in Aftercall ("create", the default), the
 * account field for one you have ("have"), or the guide to making one in Meteor ("wallet-app").
 */
type AccountMode = "have" | "create" | "wallet-app";

/** Making an account in Aftercall: the name, its phrase, three words back, then the helper at work. */
type CreateStep = "name" | "words" | "check" | "creating";

/** Checked against the NEAR Connect wallet list (features.testnet) and the sites themselves, 2 Nov 2026. */
const FAUCET_URL = "https://docs.near.org/getting-started/faucet";
/** Circle's USDC faucet: pick Near Testnet; 20 USDC per address every 2 hours (checked 3 Nov 2026). */
const USDC_FAUCET_URL = "https://faucet.circle.com";

/** The daily cap the setup approval sets, in USDC: small, and editable before you sign. */
const DEFAULT_CAP: Record<NearConfig["network"], string> = { testnet: "25", mainnet: "10" };

/**
 * Set up payments, as a setup assistant in three stages: your NEAR account (made here
 * on testnet by default, with its 12 words saved and three typed back, or one you
 * have), this Mac's key (Aftercall's own recovery phrase, the same way), and one
 * approval in your own wallet that creates the agent wallet, sets its daily cap and
 * authorises this Mac's limited key. Then a short "Ready to pay" card. Stages already
 * done are skipped. Nothing is stored until the words are confirmed; closing drops a
 * half-made phrase.
 */
export function SetupPayments({ near: n, start, onClose }: { near: NearSetup; start?: SetupStep; onClose: () => void }) {
  const fromPhrase = Boolean(n.recoveryStatus?.fromPhrase);
  const afterKey = (): SetupStep => (n.connected ? "ready" : "sign");
  const [step, setStep] = useState<SetupStep>(() => start ?? (!n.accountDone ? "intro" : !fromPhrase ? "phrase" : afterKey()));
  const [mode, setMode] = useState<AccountMode>(() => (n.config.account ? "have" : "create"));
  const go = (s: SetupStep) => setStep(s);

  const phrase = useNewPhrase();
  /** Where each recovery kit was saved, for the check screen after it. */
  const [kitAt, setKitAt] = useState<{ wallet?: string; app?: string }>({});
  const [saving, setSaving] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  useEffect(() => {
    if (step === "phrase" && !phrase.phrase && !phrase.error) phrase.load();
  }, [step]);

  // A new account, made here. Its phrase is held in this component's state only, and dropped
  // as soon as three words are typed back; the public key stays for a retry with another name.
  const [createStep, setCreateStep] = useState<CreateStep>("name");
  const [newName, setNewName] = useState(suggestedName);
  const wallet = useWalletPhrase();
  const [created, setCreated] = useState<CreatedAccount | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  useEffect(() => {
    if (step === "account" && mode === "create" && createStep === "words" && !wallet.phrase && !wallet.error) wallet.load();
  }, [step, mode, createStep]);

  const createAccount = async () => {
    const key = wallet.publicKey;
    if (!key) return;
    // The words are saved and checked: Aftercall lets go of them before anything is sent.
    wallet.forget();
    setCreateError(null);
    setCreateStep("creating");
    try {
      const made = await nearAccount.create(`${newName}.testnet`, key);
      n.edit({ network: "testnet", account: made.accountId, contract: builtInContract("testnet") ?? "" });
      // Back on the account step later, it's the field with this name in it.
      setMode("have");
      setCreated(made);
    } catch (e) {
      setCreateError(errorText(e));
    }
  };

  // Once the new name is in the setup: the usual account check (and save), then this Mac's key.
  useEffect(() => {
    if (!created || n.config.account !== created.accountId) return;
    n.check().finally(() => go(fromPhrase ? afterKey() : "phrase"));
  }, [created, n.config.account]);

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
      go(n.accountDone ? "sign" : "account");
    } catch (e) {
      setKeyError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const wordsOrMaking = createStep === "words" || createStep === "check" || (createStep === "creating" && !createError);
  const account = `${newName}.testnet`;
  return (
    <AssistantSheet
      label="Set up payments"
      phase={{ index: STAGE[step], names: STAGES }}
      // Escape doesn't throw away words on screen, an account being made, or a signature you're waiting on.
      dismissible={step !== "phrase" && step !== "confirm" && !(step === "account" && mode === "create" && wordsOrMaking) && !n.waiting}
      busy={saving || (step === "account" && mode === "create" && createStep === "creating" && !createError)}
      onClose={close}
    >
      {step === "intro" && <IntroStep key="intro" n={n} onLater={close} onNext={() => go("account")} />}
      {step === "account" && mode === "create" && createStep === "name" && (
        <CreateNameStep
          key="create-name"
          name={newName}
          onName={setNewName}
          onBack={() => go("intro")}
          // Words already saved and checked (a retry with another name) go straight to the helper.
          onNext={() => (wallet.publicKey && !wallet.phrase ? createAccount() : setCreateStep("words"))}
          onHave={() => setMode("have")}
          onWalletApp={() => setMode("wallet-app")}
        />
      )}
      {step === "account" && mode === "create" && createStep === "words" && (
        <PhraseStep
          key="create-words"
          words={wallet.words}
          error={wallet.error}
          says={walletPhraseWords(account)}
          aside={<TwoPhrases current="wallet" made />}
          onBack={() => {
            // Back to the name drops these words; a new set is made next time.
            wallet.forget();
            setCreateStep("name");
          }}
          onContinue={(at) => {
            setKitAt((k) => ({ ...k, wallet: at }));
            setCreateStep("check");
          }}
        />
      )}
      {step === "account" && mode === "create" && createStep === "check" && (
        <ConfirmStep
          key="create-check"
          words={wallet.words}
          ask={wallet.ask}
          busy={false}
          error={null}
          icon={<Wallet size={22} strokeWidth={1.75} />}
          confirmLabel="Create account"
          savedTo={kitAt.wallet}
          onBack={() => setCreateStep("words")}
          onConfirm={createAccount}
        />
      )}
      {step === "account" && mode === "create" && createStep === "creating" && (
        <CreatingStep key="create-creating" account={account} error={createError} onRetry={createAccount} onRename={() => setCreateStep("name")} />
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
        <AccountStep key="have" n={n} onBack={() => go("intro")} onCreate={() => setMode("create")} onNext={() => go(fromPhrase ? afterKey() : "phrase")} />
      )}
      {step === "phrase" && (
        <PhraseStep
          key="phrase"
          words={phrase.words}
          error={phrase.error}
          says={appPhraseWords(phrase.words.length || 12)}
          aside={<TwoPhrases current="app" made={created !== null} />}
          onBack={() => go("account")}
          onContinue={(at) => {
            setKitAt((k) => ({ ...k, app: at }));
            go("confirm");
          }}
        />
      )}
      {step === "confirm" && (
        <ConfirmStep key="confirm" words={phrase.words} ask={phrase.ask} busy={saving} error={keyError} savedTo={kitAt.app} onBack={() => go("phrase")} onConfirm={confirmWords} />
      )}
      {step === "sign" && <SignStep key="sign" n={n} created={created} onBack={() => go(created ? "phrase" : "account")} onNext={() => go("ready")} />}
      {step === "ready" && <ReadyStep key="ready" n={n} onDone={close} />}
    </AssistantSheet>
  );
}

/* ——— Welcome ——— */

/** One short screen: what this adds, the three stages, and what it costs. The rest is behind "Why?". */
function IntroStep({ n, onLater, onNext }: { n: NearSetup; onLater: () => void; onNext: () => void }) {
  const testnet = n.config.network === "testnet";
  const stages: [ReactNode, string, string][] = [
    [<UserPlus size={16} strokeWidth={1.75} />, "Your account", testnet ? "Made for you, free" : "From your wallet"],
    [<KeyRound size={16} strokeWidth={1.75} />, "This Mac's key", "Save 12 words"],
    [<Wallet size={16} strokeWidth={1.75} />, "Sign in your wallet", "Once"],
  ];
  return (
    <AssistantStep
      icon={<Link2 size={22} strokeWidth={1.75} />}
      title="Proofs and payments on NEAR"
      intro="Optional. Aftercall records a proof of each meeting's notes and pays people you list, within a cap only you can change."
      back={<LaterButton onClick={onLater}>Not now</LaterButton>}
      primary={
        <Button variant="primary" onClick={onNext}>
          Get started
          <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
        </Button>
      }
    >
      <ol aria-label="Three stages" className="m-0 grid list-none grid-cols-3 gap-2 p-0" style={rise(1)}>
        {stages.map(([icon, title, detail], i) => (
          <li key={title} className="flex flex-col items-start gap-2.5 rounded-md bg-elevated px-4 pt-3.5 pb-3.5 shadow-1">
            <span className="flex w-full items-center justify-between">
              <IconDisc tone="verdigris" size={28}>
                {icon}
              </IconDisc>
              <span className="font-mono text-[12px] text-muted">{i + 1}</span>
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-[14px] leading-5 font-semibold text-ink">{title}</span>
              <span className="text-[13px] leading-[18px] text-ink-2">{detail}</span>
            </span>
          </li>
        ))}
      </ol>

      <p className="m-0 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[13px] leading-[19px] text-ink-2" style={rise(2)}>
        <span className="inline-flex items-center gap-1.5">
          <Clock size={14} strokeWidth={1.75} aria-hidden="true" className="text-muted" /> About 3 min
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Coins size={14} strokeWidth={1.75} aria-hidden="true" className="text-muted" />
          {testnet ? (
            <>
              <span className="font-mono text-ink">0.35</span> test NEAR, free
            </>
          ) : (
            <span className="font-mono text-ink">0.35 NEAR</span>
          )}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <FlaskConical size={14} strokeWidth={1.75} aria-hidden="true" className="text-muted" /> {testnet ? "Testnet: nothing is real money" : "Mainnet: real NEAR and USDC"}
        </span>
      </p>

      <div style={rise(3)}>
        <Why>
          <span className="flex flex-col gap-2">
            <span>
              NEAR is a public network with names you can read, like <span className="font-mono text-ink">{exampleAccount("testnet")}</span>. Your wallet app holds
              your account's keys, not Aftercall.
            </span>
            <span>
              A proof is a public record anyone can check: a hash of the notes and the model's name, never what was said. The agent wallet pays amounts agreed in
              meetings to people on your list, within caps only your wallet can change.
            </span>
            <span>
              The 0.35 NEAR is {REGISTER_DEPOSIT} for your agent wallet's storage and up to {KEY_ALLOWANCE} for this Mac's fees.
            </span>
          </span>
        </Why>
      </div>
    </AssistantStep>
  );
}

/* ——— NEAR account ——— */

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
          NEAR's docs have a faucet: paste your account name and press Request Tokens. Setup needs about 0.35 NEAR.
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
      intro="Type it as your wallet shows it. Aftercall checks it on NEAR and keeps only the name."
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
      <p className="m-0 text-center text-[14px] leading-5" style={rise(2)}>
        <button type="button" onClick={onCreate} className="press rounded-sm font-semibold text-verdigris hover:text-verdigris-hover">
          Create one instead
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

/* ——— Signing ——— */

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


/* ——— One approval in your wallet ——— */

/**
 * The one signature: everything setup still needs, in one signing request (register and
 * the daily cap, this Mac's limited key, and the account's USDC registration when it
 * has none), so the wallet asks once. Said line by line before the wallet asks, with the
 * exact contract and key behind "Why?". A new account goes into Meteor first.
 */
function SignStep({ n, created, onBack, onNext }: { n: NearSetup; created: CreatedAccount | null; onBack: () => void; onNext: () => void }) {
  const registered = Boolean(n.status?.registered);
  const keyAdded = Boolean(n.status?.keyAdded);
  const done = registered && keyAdded;
  const account = n.saved?.account ?? n.config.account;
  const contract = n.config.contract;
  const [cap, setCap] = useState(DEFAULT_CAP[n.config.network]);
  const capBase = parseUsdcInput(cap);
  /** The account can already hold USDC; null until NEAR says (read-only). Unknown counts as no: registering twice only refunds. */
  const [usdcReady, setUsdcReady] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isDesktop || !n.saved) return;
    near
      .checkPayee(n.saved.account)
      .then((r) => setUsdcReady(r.usdcReady))
      .catch(() => setUsdcReady(false));
  }, [n.saved?.account]);

  // Seen on NEAR: on to "Ready to pay" without another click.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(onNext, 900);
    return () => clearTimeout(t);
  }, [done]);

  const action: SetupAction = {
    kind: "setup",
    register: !registered,
    ...(!registered && capBase !== null ? { dailyCap: capBase.toString() } : {}),
    ...(!keyAdded && n.publicKey ? { publicKey: n.publicKey } : {}),
    registerUsdc: usdcReady !== true,
  };
  const label = "Set up payments";
  const waiting = n.waiting === label;
  const unseen = Boolean(n.unseen);
  const error = n.error && n.errorFrom === "sign" ? n.error : null;
  const noKey = !keyAdded && !n.publicKey;
  const blocked = !n.ready || !isDesktop || noKey || Boolean(n.waiting) || (!registered && capBase === null);
  const sign = () => n.signSetup(label, action);
  const mono = (s: string) => <span className="font-mono text-ink">{s}</span>;

  const lines: { icon: ReactNode; title: string; detail: ReactNode; extra?: ReactNode }[] = [
    ...(!registered
      ? [
          { icon: <Wallet size={16} strokeWidth={1.75} />, title: "Create your agent wallet", detail: <>{mono(REGISTER_DEPOSIT)}, kept as its storage credit</> },
          {
            icon: <ShieldCheck size={16} strokeWidth={1.75} />,
            title: "Set a daily cap",
            detail: "Payments over it wait for your wallet.",
            extra: (
              <span className="flex items-center gap-2">
                <Input
                  mono
                  aria-label="Daily cap in USDC"
                  value={cap}
                  inputMode="decimal"
                  invalid={capBase === null}
                  disabled={Boolean(n.waiting)}
                  onChange={(e) => setCap(e.target.value)}
                  className="h-8! w-[76px]! text-right"
                />
                <span className="text-[13px] text-ink-2">USDC a day</span>
              </span>
            ),
          },
        ]
      : []),
    ...(!keyAdded
      ? [{ icon: <KeyRound size={16} strokeWidth={1.75} />, title: "Let this Mac pay and record proofs", detail: <>A limited key: {mono(KEY_METHODS_TEXT)} only</> }]
      : []),
    ...(action.registerUsdc
      ? [{ icon: <Coins size={16} strokeWidth={1.75} />, title: "Register with USDC", detail: <>{mono("0.00125 NEAR")}, so your account can hold USDC</> }]
      : []),
  ];
  const count = (action.registerUsdc ? 1 : 0) + (!registered ? 1 : 0) + (!keyAdded ? 1 : 0);

  return (
    <AssistantStep
      icon={<Wallet size={22} strokeWidth={1.75} />}
      title="Approve once in your wallet"
      intro={`One signing page, one approval for ${account}.`}
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
      {created && !done && (
        <div style={rise(1)}>
          <MeteorImport created={created} />
        </div>
      )}

      {!done && (
        <section aria-labelledby="approve-h" className="flex flex-col gap-2" style={rise(2)}>
          <h2 id="approve-h" className="t-eyebrow m-0 text-muted">
            {created ? "Then approve" : "What you'll approve"}
          </h2>
          <Inset as="ul">
            {lines.map((l) => (
              <li key={l.title} className="flex items-center gap-3 px-4 py-3">
                <span aria-hidden="true" className="shrink-0 text-muted">
                  {l.icon}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[14px] leading-5 font-semibold text-ink">{l.title}</span>
                  <span className="text-[13px] leading-[18px] text-ink-2">{l.detail}</span>
                </span>
                {l.extra}
              </li>
            ))}
          </Inset>
          {!registered && capBase === null && <p className="m-0 text-[13px] leading-[19px] text-record">Type the cap as a number, like 25.</p>}
          <Why>
            <span className="flex flex-col gap-2.5">
              <span>
                Your wallet shows {count === 1 ? "one transaction" : `${count} transactions in one approval`}. Only your wallet can change any of this later: this
                Mac's key can't change caps, add payees or withdraw.
              </span>
              <Inset as="dl">
                <DetailRow label="Contract" mono>
                  {contract}
                </DetailRow>
                {!registered && (
                  <DetailRow label="Calls" mono>
                    register, set_cap
                  </DetailRow>
                )}
                {!keyAdded && (
                  <DetailRow label="New key" mono>
                    {n.publicKey || "None yet"}
                  </DetailRow>
                )}
                {!keyAdded && (
                  <DetailRow label="Fee allowance" mono>
                    {KEY_ALLOWANCE}
                  </DetailRow>
                )}
                <DetailRow label="Signed as" mono>
                  {account}
                </DetailRow>
              </Inset>
              {!created && (
                <span>
                  Account not in a wallet yet? Import it into{" "}
                  <button type="button" onClick={() => openLink(METEOR_URL)} className="press rounded-sm font-semibold text-verdigris hover:text-verdigris-hover">
                    Meteor
                  </button>{" "}
                  or another NEAR wallet first.
                </span>
              )}
            </span>
          </Why>
        </section>
      )}

      <div className="flex flex-col gap-2.5" style={rise(3)}>
        <SignState
          state={done ? "seen" : waiting ? "waiting" : unseen ? "unseen" : "ready"}
          seen="Your agent wallet exists, and this Mac's key is on your account."
          checking={n.rechecking}
          onCheck={n.checkAgain}
        />
        {noKey && <p className="m-0 text-[13px] leading-[19px] text-caution">This Mac has no key yet. Go back and save a recovery phrase first.</p>}
        {n.status?.keyProblem && <p className="m-0 text-[13px] leading-[19px] text-caution">{n.status.keyProblem}</p>}
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

/* ——— Ready to pay ——— */

/**
 * What's left before Aftercall can pay, ticked from the live wallet: some USDC on your
 * account (the faucet, on testnet), a deposit, a payee. Each button starts the same
 * signing as Agent wallet. Coming back to the window looks again, for USDC from the faucet.
 */
function ReadyStep({ n, onDone }: { n: NearSetup; onDone: () => void }) {
  const [view, setView] = useState<WalletView | null>(null);
  const [ownerUsdc, setOwnerUsdc] = useState<bigint | null>(null);
  const [usdcReady, setUsdcReady] = useState<boolean | null>(null);
  const signing = useWalletSigning(setView);
  const [sheet, setSheet] = useState<"cap" | "deposit" | "payee" | null>(null);
  const account = n.saved?.account ?? n.config.account;
  const testnet = n.config.network === "testnet";

  useEffect(() => {
    if (!isDesktop) return;
    const look = () => {
      near.wallet().then(setView).catch(() => {});
      near
        .ownerUsdc()
        .then((b) => setOwnerUsdc(BigInt(b)))
        .catch(() => {});
      near
        .checkPayee(account)
        .then((r) => setUsdcReady(r.usdcReady))
        .catch(() => {});
    };
    look();
    window.addEventListener("focus", look);
    return () => window.removeEventListener("focus", look);
  }, [account]);

  const w = view?.wallet ?? null;
  const cap = w ? BigInt(w.daily_cap) : 0n;
  const balance = w ? BigInt(w.balance) : 0n;
  const payees = view?.payees ?? [];
  const busy = Boolean(signing.waiting) || !view;
  // A daily cap of 0 parks every payment for your wallet; a per-payment cap of 0 means none
  // (no limit per payment), so the daily cap alone decides whether this Mac can pay.
  const canPay = cap > 0n && balance > 0n && payees.length > 0;
  const hasUsdc = (ownerUsdc ?? 0n) > 0n || balance > 0n;

  const items: { id: string; title: string; done: boolean; detail: ReactNode; action: ReactNode }[] = [
    ...(cap === 0n && view
      ? [
          {
            id: "cap",
            title: "Set a daily cap",
            done: false,
            detail: "At 0.00, every payment waits for your wallet.",
            action: (
              <Button size="sm" disabled={busy} onClick={() => setSheet("cap")}>
                Set cap
              </Button>
            ),
          },
        ]
      : []),
    ...(testnet
      ? [
          {
            id: "faucet",
            title: "Get test USDC",
            done: hasUsdc,
            detail: hasUsdc ? (
              `${formatUsdc(ownerUsdc && ownerUsdc > 0n ? ownerUsdc : balance)} USDC ${ownerUsdc && ownerUsdc > 0n ? `on ${account}` : "in your agent wallet"}`
            ) : (
              <>
                Pick <b className="font-semibold text-ink">Near Testnet</b>, paste <span className="selectable font-mono whitespace-nowrap text-ink">{account}</span>. 20 USDC every 2 hours.
              </>
            ),
            action: hasUsdc ? null : <LinkButton href={USDC_FAUCET_URL}>Open faucet</LinkButton>,
          },
        ]
      : []),
    {
      id: "deposit",
      title: "Deposit USDC",
      done: balance > 0n,
      detail: balance > 0n ? `${formatUsdc(balance)} USDC in your agent wallet` : "Aftercall pays from this balance.",
      action: (
        <Button size="sm" disabled={busy} onClick={() => setSheet("deposit")}>
          Deposit
        </Button>
      ),
    },
    {
      id: "payee",
      title: "Add a payee",
      done: payees.length > 0,
      detail: payees.length > 0 ? payees.map((p) => p.label || p.account).join(", ") : "Aftercall pays only people on your list.",
      action: (
        <Button size="sm" disabled={busy} onClick={() => setSheet("payee")}>
          Add payee
        </Button>
      ),
    },
  ];

  const finish = () => {
    toast({ text: canPay ? "This Mac can now pay within your caps" : "This Mac is connected. Add USDC and a payee in Agent wallet to start paying.", tone: "verdigris" });
    onDone();
  };

  return (
    <AssistantStep
      icon={<Check size={22} strokeWidth={2} />}
      title={canPay ? "Ready to pay" : "This Mac is connected"}
      intro={
        cap > 0n
          ? `Proofs now go on NEAR. Your daily cap is ${formatUsdc(cap)} USDC. To pay someone, add USDC and a payee, now or later.`
          : "Proofs now go on NEAR. To pay someone, add USDC and a payee, now or later."
      }
      back={<span />}
      primary={
        <Button variant="primary" disabled={Boolean(signing.waiting)} onClick={finish}>
          Done
        </Button>
      }
    >
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
                <span className="text-[13px] leading-[18px] text-ink-2">{i.detail}</span>
              </span>
              {!i.done && i.action}
            </li>
          ))}
        </Inset>
        {usdcReady === false && (
          <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] leading-[19px] text-caution">
            {account} isn't registered with USDC yet, so USDC sent to it would bounce.
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                signing.signAndWait(
                  "Register with USDC",
                  { kind: "setup", register: false, registerUsdc: true },
                  async () => (await near.checkPayee(account)).usdcReady,
                  () => `${account} can hold USDC now`,
                  () => setUsdcReady(true),
                )
              }
            >
              Register in wallet
            </Button>
          </p>
        )}
        {signing.waiting && (
          <p aria-live="polite" className="m-0 flex items-center gap-2 text-[13px] text-ink-2">
            <Spinner size={12} /> Waiting for you to sign “{signing.waiting}” in your browser…
          </p>
        )}
        <UnseenNote label={signing.unseenLabel} checking={signing.checking} onCheck={signing.checkAgain} />
      </section>
      <div style={rise(2)}>
        <Why>
          Your wallet signs every change, so this Mac can't raise what it may spend. USDC on NEAR needs a one-time registration per account; setup did yours,
          and adding a payee can do theirs. Everything here is also in Agent wallet.
        </Why>
      </div>

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
            network={n.config.network}
            onClose={() => setSheet(null)}
            onConfirm={(acct, lbl, registerWithUsdc, destination) => {
              setSheet(null);
              signing.signAndWait(
                "Add payee",
                { kind: "add-payee", account: acct, label: lbl, registerWithUsdc, destination },
                (v) => v.payees.some((p) => p.account === acct),
                () => `${lbl} can be paid now`,
              );
            }}
          />
        )}
      </AnimatePresence>
    </AssistantStep>
  );
}
