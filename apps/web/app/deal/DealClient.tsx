"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  NETWORK_CONFIG,
  checkDeal,
  confirmEscrowTransaction,
  decodeDeal,
  explorerTxUrl,
  formatUsdc,
  plainNearError,
  readDealOnChain,
  returnEscrowTransaction,
  type DealCheck,
  type DealTerms,
  type EscrowView,
  type WalletTransaction,
} from "@aftercall/core";
import { AppHeader, Avatar, Pill, Tick } from "../ui";
import g from "../sign/sign.module.css";
import { OTHER, WalletButton, choices, ensureConnector, type Choice, type Connector, type Wallet } from "../sign/wallets";

type Chain = { kind: "loading" } | { kind: "read"; escrow: EscrowView | null; checks: DealCheck[] } | { kind: "error"; message: string };

type Step =
  | { kind: "ready" }
  | { kind: "connecting"; via: string }
  | { kind: "wrong-account"; account: string }
  | { kind: "signing"; via: string }
  | { kind: "done"; txHash: string | null; what: "confirm" | "return" }
  | { kind: "failed"; message: string };

/**
 * The payee's side of a deal agreed on a call (Handshake). The terms come in the link's
 * #fragment, which never reaches a server. The page reads the escrow and the meeting's proof
 * from NEAR, shows the terms and every check, and only when all of them pass lets the payee
 * confirm with their own wallet, as the account the escrow pays.
 */
export function DealClient() {
  const [terms, setTerms] = useState<DealTerms | null | "bad">(null);
  const [chain, setChain] = useState<Chain>({ kind: "loading" });
  const [step, setStep] = useState<Step>({ kind: "ready" });
  const [wallets, setWallets] = useState<Choice[]>([]);
  const connector = useRef<Promise<Connector> | null>(null);

  useEffect(() => {
    try {
      setTerms(decodeDeal(window.location.hash));
    } catch {
      setTerms("bad");
    }
  }, []);

  const read = useCallback(async (t: DealTerms) => {
    try {
      const { escrow, proof } = await readDealOnChain(t, NETWORK_CONFIG[t.network].rpcUrl);
      setChain({ kind: "read", escrow, checks: checkDeal(t, escrow, proof) });
    } catch (e) {
      setChain({ kind: "error", message: plainNearError(e, { network: t.network, contract: t.contract }) });
    }
  }, []);

  useEffect(() => {
    if (terms && terms !== "bad") read(terms);
  }, [terms, read]);

  useEffect(() => {
    if (!terms || terms === "bad") return;
    let gone = false;
    let c: Connector | null = null;
    const refresh = () => {
      if (!gone && c) setWallets(choices(c));
    };
    ensureConnector(connector, terms.network)
      .then(async (conn) => {
        c = conn;
        await conn.whenManifestLoaded.catch(() => {});
        refresh();
        conn.on("selector:walletsChanged", refresh);
      })
      .catch(() => {});
    return () => {
      gone = true;
      c?.off("selector:walletsChanged", refresh);
    };
  }, [terms]);

  if (terms === null) return <AppHeader width={640} tag="deal" />;
  if (terms === "bad") {
    return (
      <>
        <AppHeader width={640} tag="deal" />
        <main className={g.main}>
          <div className={`${g.inner} ${g.message} enter`}>
            <h1 className="t-display">This link is damaged</h1>
            <p className="ink-2" style={{ fontSize: 18, lineHeight: "28px" }}>
              Ask whoever sent it for the link again. Nothing was confirmed.
            </p>
          </div>
        </main>
      </>
    );
  }

  const t = terms;
  const amount = formatUsdc(BigInt(t.amount));
  const name = t.payeeName || t.payee;
  const escrow = chain.kind === "read" ? chain.escrow : null;
  const allOk = chain.kind === "read" && chain.checks.every((c) => c.ok);
  const busy = step.kind === "connecting" || step.kind === "signing";
  const via = step.kind === "connecting" || step.kind === "signing" ? step.via : null;

  const sign = async (choice: Choice | null, tx: WalletTransaction, what: "confirm" | "return") => {
    setStep({ kind: "connecting", via: choice?.id ?? OTHER });
    try {
      const c = await ensureConnector(connector, t.network);
      const wallet: Wallet = await c.connect(choice ? { walletId: choice.id } : undefined);
      const account = (await wallet.getAccounts({ network: t.network }))[0]?.accountId;
      if (!account) throw new Error("The wallet didn't share an account.");
      // Only the account the escrow pays can confirm; the contract refuses anyone else too.
      if (account !== t.payee) return setStep({ kind: "wrong-account", account });
      setStep({ kind: "signing", via: choice?.id ?? OTHER });
      type Params = Parameters<Wallet["signAndSendTransactions"]>[0];
      const outcomes = (await wallet.signAndSendTransactions({ network: t.network, signerId: account, transactions: [tx] as Params["transactions"] })) as {
        status?: unknown;
        transaction_outcome?: { id?: string };
        transaction?: { hash?: string };
      }[];
      const failed = outcomes.find((o) => typeof o.status === "object" && o.status !== null && "Failure" in o.status);
      if (failed) throw new Error(plainNearError((failed.status as { Failure: unknown }).Failure, { network: t.network, contract: t.contract }));
      setStep({ kind: "done", txHash: outcomes[0]?.transaction_outcome?.id ?? outcomes[0]?.transaction?.hash ?? null, what });
      await read(t);
    } catch (e) {
      setStep({ kind: "failed", message: plainNearError(e, { network: t.network, contract: t.contract }) });
    }
  };

  const disconnect = async () => {
    const c = await connector.current?.catch(() => null);
    await c?.disconnect().catch(() => {});
    setStep({ kind: "ready" });
  };

  const state = escrow?.state;
  const title = state === "released" ? `${amount} USDC paid to you` : `${t.owner} agreed to pay you ${amount} USDC`;
  const intro =
    state === "released"
      ? "Released from escrow to your NEAR account."
      : state === "confirmed"
        ? `You confirmed these terms. ${t.owner} releases the money ${t.condition ? `when ${t.condition.replace(/^when\s+/i, "")}` : "now"}.`
        : state === "cancelled" || state === "returned"
          ? "This deal was called off, and the money went back to the payer."
          : state === "parked"
            ? `It's over ${t.owner}'s caps, so it waits for their wallet to set the money aside. Check back later.`
            : t.condition
              ? `On a call, with the money held in escrow on NEAR until it's released. Check the terms, then confirm them with your own wallet.`
              : "On a call, with the money held in escrow on NEAR. Check the terms; confirming them with your own wallet pays you.";

  return (
    <>
      <AppHeader width={640} tag={t.network} />
      <main className={g.main}>
        <div className={g.inner}>
          <section aria-labelledby="dh" className={`${g.intro} enter`}>
            <StatePill state={state} />
            <h1 id="dh" className="t-display">
              {title}
            </h1>
            <p className="ink-2">{intro}</p>
          </section>

          <dl className={`${g.facts} lift enter`} style={{ ["--d" as string]: "40ms" }}>
            <dt className={g.amountLabel}>Amount</dt>
            <dd className={g.amount}>
              <span>{amount}</span>
              <span>USDC</span>
            </dd>
            <dt>From</dt>
            <dd className="mono" style={{ fontSize: 13 }}>
              {t.owner}
            </dd>
            <dt>To</dt>
            <dd className={g.person}>
              <Avatar name={name} size={28} decorative />
              {t.payeeName && <span style={{ fontWeight: 600 }}>{t.payeeName}</span>}
              <span className="mono ink-2" style={{ fontSize: 13 }}>
                {t.payee}
              </span>
            </dd>
            <dt>Heard</dt>
            <dd className={g.heard}>“{t.amountQuote}”</dd>
            <dt>When</dt>
            <dd>
              {t.condition ? (
                <>
                  {t.condition}
                  <span className={g.heard} style={{ display: "block" }}>
                    “{t.conditionQuote}”
                  </span>
                </>
              ) : (
                "No condition: confirming pays you"
              )}
            </dd>
            {t.meetingTitle && (
              <>
                <dt>Meeting</dt>
                <dd>{t.meetingTitle}</dd>
              </>
            )}
          </dl>

          <section aria-labelledby="ch" className="enter" style={{ ["--d" as string]: "60ms", display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 id="ch" className="t-section">
              Checked against NEAR
            </h2>
            {chain.kind === "loading" && (
              <p role="status" className="ink-2">
                Reading the escrow from NEAR…
              </p>
            )}
            {chain.kind === "error" && (
              <p className={g.problem} role="alert">
                Couldn&apos;t read NEAR: {chain.message}
              </p>
            )}
            {chain.kind === "read" && (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {chain.checks.map((c) => (
                  <li key={c.label} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                    <Tick ok={c.ok} size={16} still label={c.ok ? "Passed" : "Failed"} />
                    <span>
                      <span style={{ fontWeight: 600 }}>{c.label}</span> <span className="ink-2">· {c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {chain.kind === "read" && !allOk && (
              <p className={g.problem} role="alert">
                This link doesn&apos;t match what&apos;s held on NEAR. Don&apos;t confirm it; ask {t.owner} for a new link.
              </p>
            )}
          </section>

          {step.kind === "done" ? (
            <section role="status" className={`${g.done} pop pop-spring`} style={{ ["--dur" as string]: "360ms" }}>
              <Tick size={24} d1="80ms" d2="220ms" decorative />
              <span>
                <span style={{ fontWeight: 600, color: "var(--verdigris)" }}>
                  {step.what === "return" ? "Given back." : state === "released" ? "Confirmed, and paid." : "Confirmed."}
                </span>
                {step.txHash && (
                  <a className="mono" style={{ fontSize: 13 }} href={explorerTxUrl(t.network, step.txHash)} target="_blank" rel="noreferrer">
                    {step.txHash.slice(0, 8)}…{step.txHash.slice(-4)} on NEAR Explorer
                  </a>
                )}
                <span className="ink-2">You can close this page.</span>
              </span>
            </section>
          ) : (
            allOk &&
            (state === "open" || state === "confirmed") && (
              <section aria-labelledby="sw" className={`${g.signSection} enter`} style={{ ["--d" as string]: "80ms" }}>
                {state === "open" ? (
                  <>
                    <h2 id="sw" className="t-section">
                      Confirm with{" "}
                      <span className="count">
                        your own wallet, as{" "}
                        <span className="mono" style={{ fontSize: 13 }}>
                          {t.payee}
                        </span>
                      </span>
                    </h2>
                    <div className={g.wallets}>
                      {wallets.map((w) => (
                        <WalletButton key={w.id} mark={w.name.slice(0, 1).toUpperCase()} label={w.short} busy={via === w.id} disabled={busy} onClick={() => sign(w, confirmEscrowTransaction(t), "confirm")} />
                      ))}
                      <WalletButton
                        mark="…"
                        label={wallets.length ? "Other wallets" : "Choose a wallet"}
                        busy={via === OTHER}
                        disabled={busy}
                        onClick={() => sign(null, confirmEscrowTransaction(t), "confirm")}
                      />
                    </div>
                  </>
                ) : (
                  <h2 id="sw" className="t-section">
                    Waiting for {t.owner} to release it
                  </h2>
                )}
                <Status step={step} payee={t.payee} onSwitch={disconnect} />
                <div className={g.walletNote}>
                  <span>
                    Your wallet will ask you to call <Mono>confirm_escrow</Mono> on <Mono>{t.contract}</Mono> with 1 yoctoNEAR attached. That proves it&apos;s you, not an app
                    acting for you.
                  </span>
                  <details className="why">
                    <summary>Call it off?</summary>
                    <span className="why-body" style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                      If you both agree the deal is off, you can give the money back to {t.owner}&apos;s agent wallet. Once you&apos;ve confirmed, they can&apos;t take it back alone
                      until 30 days have passed without releasing it.
                      <button
                        type="button"
                        className="link-button"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`Give ${amount} USDC back to ${t.owner}? This can't be undone.`)) sign(null, returnEscrowTransaction(t), "return");
                        }}
                        style={{ alignSelf: "flex-start" }}
                      >
                        Give it back
                      </button>
                    </span>
                  </details>
                </div>
              </section>
            )
          )}

          <div className={g.foot}>
            <span className="mono muted" style={{ fontSize: 12, overflowWrap: "anywhere" }}>
              {t.contract} · escrow {t.escrowId}
            </span>
            <span className="ink-2" style={{ fontSize: 13 }}>
              Aftercall never sees your wallet&apos;s keys, and can&apos;t check whether a condition was met: only {t.owner} can release the money.
            </span>
          </div>
        </div>
      </main>
    </>
  );
}

function StatePill({ state }: { state: EscrowView["state"] | undefined }) {
  if (state === "released") return <Pill tone="verdigris">Paid</Pill>;
  if (state === "confirmed") return <Pill tone="verdigris">You confirmed</Pill>;
  if (state === "parked") return <Pill tone="caution">Waiting for the payer&apos;s wallet</Pill>;
  if (state === "cancelled" || state === "returned") return <Pill tone="muted">Called off</Pill>;
  return <Pill tone="outline">Held in escrow</Pill>;
}

function Status({ step, payee, onSwitch }: { step: Step; payee: string; onSwitch: () => void }) {
  if (step.kind === "connecting" || step.kind === "signing")
    return (
      <p role="status" className="ink enter" style={{ ["--dur" as string]: "240ms" }}>
        {step.kind === "connecting" ? "Opening your wallet…" : "Waiting for your wallet… Sign there; this page updates when it’s done."}
      </p>
    );
  if (step.kind === "wrong-account")
    return (
      <p className={g.problem} role="alert">
        Your wallet is signed in as <span className="mono">{step.account}</span>, but this deal pays <span className="mono">{payee}</span>.{" "}
        <button type="button" onClick={onSwitch} className="link-button">
          Switch account
        </button>
      </p>
    );
  if (step.kind === "failed")
    return (
      <p className={g.problem} role="alert">
        {step.message}
      </p>
    );
  return null;
}

function Mono({ children }: { children: ReactNode }) {
  return (
    <span className="mono ink" style={{ fontSize: 13 }}>
      {children}
    </span>
  );
}
