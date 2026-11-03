import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, ExternalLink, Lock, RotateCcw, UserPlus, Wallet } from "lucide-react";
import { explorerAccountUrl, formatNear, newTestnetNameProblem } from "@aftercall/core";
import { METEOR_IMPORT_URL, nearAccount, type CreatedAccount } from "./nearAccount";
import { isDesktop } from "./recorder";
import type { PhraseWords } from "./RecoveryPhrase";
import { walletKit } from "./recoveryKit";
import { CheckCircle } from "./primitives/Check";
import { Button, Spinner, cx } from "./ui";
import { Pop, Why, errorText, rise } from "./SettingsParts";
import { AssistantStep, BackButton, DetailRow, GuideRow, Inset, LinkButton, openLink } from "./SetupAssistant";

/**
 * Making a NEAR testnet account inside Set up payments: pick a name (checked free on
 * NEAR), write down the new account's own 12 words, type three back, and Aftercall asks
 * NEAR's testnet helper to create it. Then Meteor imports the words, since a wallet signs
 * the two setup steps. The phrase lives only in this flow's state and is dropped when the
 * words are checked; Rust keeps nothing (recovery::new_wallet).
 */

/** About 0.35 NEAR: the two setup signatures (0.1 storage + 0.25 fee allowance). */
const SETUP_NEAR = 35n * 10n ** 22n;

/** The new account's phrase, once, and the three positions to ask back. The public key stays after the phrase is dropped. */
export function useWalletPhrase() {
  const [phrase, setPhrase] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const words = useMemo(() => phrase?.split(" ") ?? [], [phrase]);
  const ask = useMemo(() => {
    const third = Math.floor(words.length / 3);
    return [0, 1, 2].map((i) => i * third + Math.floor(Math.random() * third));
  }, [words.length]);
  const load = () => {
    setError(null);
    nearAccount
      .newWalletPhrase()
      .then((w) => {
        setPhrase(w.phrase);
        setPublicKey(w.publicKey);
      })
      .catch((e) => setError(errorText(e)));
  };
  return { phrase, words, ask, publicKey, error, load, forget: () => setPhrase(null) };
}

export type WalletPhrase = ReturnType<typeof useWalletPhrase>;

/** What the wallet's phrase screen says: whose words these are, and that Aftercall lets go of them. */
export function walletPhraseWords(account: string): PhraseWords {
  return {
    icon: <Wallet size={22} strokeWidth={1.75} />,
    title: "Your NEAR wallet's phrase",
    intro: (
      <>
        These 12 words are <span className="font-mono text-[13px] text-ink">{account}</span>: whoever has them controls the account. Write them on paper in
        order, or save a recovery kit. Aftercall forgets them when you continue.
      </>
    ),
    name: `NEAR wallet phrase for ${account}`,
    label: (
      <>
        NEAR wallet phrase <span className="text-muted">· {account}</span>
      </>
    ),
    notes: (
      <>
        <p className="m-0 flex items-start gap-2 text-[13px] leading-[19px] text-ink-2">
          <Lock size={14} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
          <span>
            Not Aftercall's recovery phrase. That one comes later, on its own screen, for this Mac's limited key. Keep the two apart.
          </span>
        </p>
        <Why label="Why offline?">
          You'll type these words into Meteor in a minute, and they bring the account back if you lose that wallet. Aftercall doesn't keep them anywhere: not in the
          Keychain, not on disk. A kit goes only where you save it. Aftercall clears a copied phrase from the clipboard after 60 seconds, or when you leave this
          step, but a clipboard app may keep its own copy. Don't photograph the words.
        </Why>
      </>
    ),
    kit: walletKit(account),
  };
}

type NameState = { kind: "idle" } | { kind: "checking" } | { kind: "free" } | { kind: "taken" } | { kind: "problem"; text: string } | { kind: "error"; text: string };

/** Step: the name, checked against NEAR's rules as you type and against testnet once you pause. */
export function CreateNameStep({
  name,
  onName,
  onBack,
  onNext,
  onWalletApp,
}: {
  /** The part before .testnet. */
  name: string;
  onName: (name: string) => void;
  onBack: () => void;
  onNext: () => void;
  /** "Use a wallet app instead": the Meteor guide. */
  onWalletApp: () => void;
}) {
  const account = `${name}.testnet`;
  const [state, setState] = useState<NameState>({ kind: "idle" });
  useEffect(() => {
    if (!name) return setState({ kind: "idle" });
    const problem = newTestnetNameProblem(account);
    if (problem) return setState({ kind: "problem", text: problem });
    setState({ kind: "checking" });
    let stale = false;
    const t = setTimeout(() => {
      nearAccount
        .nameFree(account)
        .then((free) => !stale && setState({ kind: free ? "free" : "taken" }))
        .catch((e) => !stale && setState({ kind: "error", text: errorText(e) }));
    }, 450);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [account]);

  const free = state.kind === "free";
  const message =
    state.kind === "problem"
      ? state.text
      : state.kind === "taken"
        ? `${account} is taken. Try another.`
        : state.kind === "error"
          ? `Couldn't ask NEAR: ${state.text}`
          : null;

  return (
    <AssistantStep
      icon={<UserPlus size={22} strokeWidth={1.75} />}
      title="Pick your account name"
      intro="Aftercall asks NEAR's testnet helper to create it for you, with free test NEAR for setup. Testnet is NEAR's practice network: nothing there is worth money."
      back={<BackButton onClick={onBack} />}
      primary={
        <Button variant="primary" disabled={!free || !isDesktop} onClick={onNext}>
          Continue
          <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
        </Button>
      }
    >
      <form
        className="flex flex-col gap-1.5"
        style={rise(1)}
        onSubmit={(e) => {
          e.preventDefault();
          if (free && isDesktop) onNext();
        }}
      >
        <label htmlFor="new-account" className="text-[13px] leading-[18px] font-semibold text-ink">
          Account name
        </label>
        <span
          className={cx(
            "flex h-11 items-center rounded-sm border bg-well pr-3 pl-3.5",
            message && state.kind !== "error"
              ? "border-record focus-within:shadow-[0_0_0_1px_var(--record)]"
              : "border-border focus-within:border-verdigris focus-within:shadow-[0_0_0_1px_var(--verdigris)]",
          )}
        >
          <input
            id="new-account"
            value={name}
            autoFocus
            placeholder="yourname"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            aria-invalid={Boolean(message) || undefined}
            aria-describedby="new-account-state"
            onChange={(e) => onName(e.target.value.trim().toLowerCase().replace(/\.testnet$/, ""))}
            // border-0: the frame around it shows focus, not the field itself (styles.css).
            className="selectable w-0 min-w-0 flex-1 border-0 bg-transparent font-mono text-[15px] text-ink outline-none placeholder:text-muted"
          />
          <span className="font-mono text-[15px] text-muted">.testnet</span>
          <span className="ml-2.5 inline-flex w-4 justify-center">
            {state.kind === "checking" ? (
              <Spinner size={13} />
            ) : (
              <Pop show={free}>
                <Check size={15} strokeWidth={2.5} aria-hidden="true" className="text-verdigris" />
              </Pop>
            )}
          </span>
        </span>
        <span id="new-account-state" aria-live="polite" className={cx("min-h-[19px] text-[13px] leading-[19px]", message ? "text-record" : "text-ink-2")}>
          {message ??
            (free ? (
              <span className="text-verdigris">{account} is free.</span>
            ) : state.kind === "checking" ? (
              "Checking NEAR…"
            ) : (
              "Lowercase letters, digits, - and _. At least 2 characters."
            ))}
        </span>
      </form>

      <Inset as="dl" style={rise(2)}>
        <DetailRow label="Network">Testnet only. On mainnet, create your account in a wallet app.</DetailRow>
        <DetailRow label="You get">An account with its own 12-word phrase, which you write down and import into Meteor.</DetailRow>
        <DetailRow label="Aftercall keeps">Only the name. It shows the phrase once and forgets it.</DetailRow>
      </Inset>

      {!isDesktop && (
        <p className="m-0 text-[13px] leading-[19px] text-ink-2" style={rise(3)}>
          Creating an account works in the Mac app, not the browser preview.
        </p>
      )}
      <p className="m-0 text-[13px] leading-[19px] text-ink-2" style={rise(3)}>
        Rather use a wallet app?{" "}
        <button type="button" onClick={onWalletApp} className="press rounded-sm font-semibold text-verdigris hover:text-verdigris-hover">
          Create one in Meteor instead
        </button>
      </p>
    </AssistantStep>
  );
}

/** Step: NEAR's testnet helper at work, then what went wrong if it did. The phrase is already gone. */
export function CreatingStep({
  account,
  error,
  onRetry,
  onRename,
}: {
  account: string;
  error: string | null;
  onRetry: () => void;
  onRename: () => void;
}) {
  return (
    <AssistantStep
      icon={<UserPlus size={22} strokeWidth={1.75} />}
      title={error ? `${account} wasn't created` : `Creating ${account}`}
      intro={
        error
          ? "Your 12 words still work: the key they make doesn't depend on the name. Try again, or pick another name for the same words."
          : "NEAR's testnet helper is creating the account with your new key and adding test NEAR. This takes a few seconds."
      }
      back={error ? <BackButton onClick={onRename}>Pick another name</BackButton> : <span />}
      primary={
        error ? (
          <Button variant="primary" onClick={onRetry} icon={<RotateCcw size={14} strokeWidth={2} aria-hidden="true" />}>
            Try again
          </Button>
        ) : (
          <Button variant="primary" loading disabled>
            Creating
          </Button>
        )
      }
    >
      <div role="status" aria-live="polite" className="flex flex-col gap-2.5" style={rise(1)}>
        {error ? (
          <p className="selectable m-0 rounded-md bg-record-tint px-4 py-3.5 text-[13px] leading-[19px] break-words text-record">{error}</p>
        ) : (
          <div className="flex items-center gap-3.5 rounded-md px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--hairline)]">
            <Spinner size={18} tone="verdigris" />
            <span className="flex flex-col gap-0.5">
              <span className="text-[14px] leading-5 font-semibold text-ink">Asking NEAR testnet</span>
              <span className="text-[13px] leading-[19px] text-ink-2">Nothing is signed by you yet, and nothing costs anything.</span>
            </span>
          </div>
        )}
      </div>
    </AssistantStep>
  );
}

/** Step: the account exists. Meteor imports the words, with the exact clicks, because the wallet signs the next two steps. */
export function ImportStep({ created, checking, error, onNext }: { created: CreatedAccount; checking: boolean; error: string | null; onNext: () => void }) {
  const account = created.accountId;
  const balance = created.balance ? BigInt(created.balance) : null;
  const low = balance !== null && balance < SETUP_NEAR;
  return (
    <AssistantStep
      icon={<CheckCircle size={30} play />}
      title={`${account} is yours`}
      intro="Your wallet signs the two setup steps next, so put the account in one: import the 12 words you wrote down or saved."
      back={<span />}
      primary={
        <Button variant="primary" loading={checking} onClick={onNext}>
          I've imported it
          <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
        </Button>
      }
    >
      <p className="m-0 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[13px] leading-[19px] text-ink-2" style={rise(1)}>
        <span>
          {balance === null ? (
            "Balance not read yet"
          ) : (
            <>
              Balance <span className="font-mono text-ink">{formatNear(balance)}</span> test NEAR, worth nothing
            </>
          )}
        </span>
        <span aria-hidden="true" className="text-faint">
          ·
        </span>
        <button
          type="button"
          onClick={() => openLink(explorerAccountUrl("testnet", account))}
          className="press inline-flex items-center gap-1 rounded-sm font-semibold text-verdigris hover:text-verdigris-hover"
        >
          See it on NearBlocks <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
        </button>
      </p>
      {low && (
        <p className="m-0 text-[13px] leading-[19px] text-caution" style={rise(1)}>
          Setup needs about 0.35 NEAR. Get more free test NEAR from NEAR's faucet before the two signatures.
        </p>
      )}

      <section aria-labelledby="import-h" className="-mt-1 flex flex-col gap-2" style={rise(2)}>
        <h2 id="import-h" className="t-eyebrow m-0 text-muted">
          Import it into Meteor
        </h2>
        <Inset as="ol">
          <GuideRow dense n={1} title="Open Meteor's import page" action={<LinkButton href={METEOR_IMPORT_URL}>Open Meteor</LinkButton>}>
            Meteor Wallet runs in your browser. Keep this window open.
          </GuideRow>
          <GuideRow dense n={2} title="Switch to Testnet">
            Click the network button at the top of Meteor's page and pick <b className="font-semibold text-ink">Testnet</b>.
          </GuideRow>
          <GuideRow dense n={3} title="Set a Meteor password">
            New to Meteor? It asks for one first: type it twice, tick the terms, press <b className="font-semibold text-ink">Continue</b>. It's Meteor's,
            not Aftercall's.
          </GuideRow>
          <GuideRow dense n={4} title="Type your 12 words">
            Pick the recovery phrase option, type the words from your paper or kit in order, and continue. Meteor finds{" "}
            <span className="font-mono text-ink">{account}</span> from them.
          </GuideRow>
        </Inset>
      </section>
      <div className="flex flex-col gap-2" style={rise(3)}>
        {error && <p className="selectable m-0 text-[13px] leading-[19px] break-words text-record">{error}</p>}
        <Why label="Another wallet?">Any NEAR wallet that imports a 12-word phrase can hold this account. Import the same words there instead.</Why>
      </div>
    </AssistantStep>
  );
}
