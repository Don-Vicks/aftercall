"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { NETWORK_CONFIG, decodeSignRequest, describe, explorerTxUrl, toTransactions, type Network, type SignRequest } from "@aftercall/core";
import { AppHeader, Avatar, Pill, Tick } from "../ui";
import g from "./sign.module.css";

type Connector = import("@hot-labs/near-connect").NearConnector;
type Wallet = Awaited<ReturnType<Connector["connect"]>>;

type Step =
  | { kind: "ready" }
  | { kind: "connecting"; via: string }
  | { kind: "wrong-account"; account: string }
  | { kind: "signing"; account: string; via: string }
  | { kind: "done"; txHashes: string[] }
  | { kind: "failed"; message: string };

/** A wallet from NEAR Connect's list, offered as a one-click choice. */
interface Choice {
  id: string;
  name: string;
  short: string;
}

const OTHER = "other";
/** Offered first when NEAR Connect lists them; any others fill up to four. */
const PREFERRED = [/meteor/i, /intear/i, /hot/i, /ledger/i];

/** One NEAR Connect for the page, loaded on first use (the page's first wallet list, or the first click). */
function ensureConnector(ref: { current: Promise<Connector> | null }, network: Network): Promise<Connector> {
  ref.current ??= import("@hot-labs/near-connect").then(
    ({ NearConnector }) =>
      new NearConnector({
        network,
        providers: { mainnet: [NETWORK_CONFIG.mainnet.rpcUrl], testnet: [NETWORK_CONFIG.testnet.rpcUrl] },
      }),
  );
  return ref.current;
}

function choices(c: Connector): Choice[] {
  const usable = c.availableWallets.filter((w) => w.manifest.features?.signAndSendTransactions);
  const picked: typeof usable = [];
  for (const re of PREFERRED) {
    const w = usable.find((x) => re.test(x.manifest.name) && !picked.includes(x));
    if (w) picked.push(w);
  }
  for (const w of usable) if (picked.length < 4 && !picked.includes(w)) picked.push(w);
  return picked.slice(0, 4).map((w) => ({ id: w.manifest.id, name: w.manifest.name, short: shortName(w.manifest.name) }));
}

/** "Meteor Wallet" reads as "Meteor"; "HOT Wallet" keeps its word. */
function shortName(name: string): string {
  const s = name.replace(/\s+wallet$/i, "");
  return s.length > 3 ? s : name;
}

/**
 * Signs one owner action from the Aftercall app with the user's own NEAR wallet.
 * The request comes in the link; this page only ever builds transactions for the
 * agent-wallet contract, USDC, or a limited key on the owner's own account.
 */
export function SignClient() {
  const [request, setRequest] = useState<SignRequest | null | "bad">(null);
  const [step, setStep] = useState<Step>({ kind: "ready" });
  const [wallets, setWallets] = useState<Choice[]>([]);
  const connector = useRef<Promise<Connector> | null>(null);

  useEffect(() => {
    try {
      setRequest(decodeSignRequest(window.location.hash));
    } catch {
      setRequest("bad");
    }
  }, []);

  // List a few wallets by name once NEAR Connect has its manifest. Without it, the
  // "Choose a wallet" button still opens NEAR Connect's own list.
  useEffect(() => {
    if (!request || request === "bad") return;
    let gone = false;
    let c: Connector | null = null;
    const refresh = () => {
      if (!gone && c) setWallets(choices(c));
    };
    ensureConnector(connector, request.network)
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
  }, [request]);

  if (request === null) return <AppHeader width={640} tag="sign" />;
  if (request === "bad") {
    return (
      <>
        <AppHeader width={640} tag="sign" />
        <main className={g.main}>
          <div className={`${g.inner} ${g.message} enter`}>
            <h1 className="t-display">This signing link is damaged</h1>
            <p className="ink-2" style={{ fontSize: 18, lineHeight: "28px" }}>
              Open it again from the Aftercall app. Nothing was signed.
            </p>
          </div>
        </main>
      </>
    );
  }

  const d = describe(request);
  const a = request.action;
  const busy = step.kind === "connecting" || step.kind === "signing";
  const via = step.kind === "connecting" || step.kind === "signing" ? step.via : null;

  const sign = async (choice: Choice | null) => {
    const name = choice?.name ?? "your wallet";
    setStep({ kind: "connecting", via: choice?.id ?? OTHER });
    try {
      const c = await ensureConnector(connector, request.network);
      const wallet: Wallet = await c.connect(choice ? { walletId: choice.id } : undefined);
      const accounts = await wallet.getAccounts({ network: request.network });
      const account = accounts[0]?.accountId;
      if (!account) throw new Error(`${name === "your wallet" ? "The wallet" : name} didn't share an account.`);
      if (account !== request.owner) return setStep({ kind: "wrong-account", account });
      setStep({ kind: "signing", account, via: choice?.id ?? OTHER });
      type Params = Parameters<Wallet["signAndSendTransactions"]>[0];
      const outcomes = (await wallet.signAndSendTransactions({
        network: request.network,
        signerId: account,
        transactions: toTransactions(request) as Params["transactions"],
      })) as { status?: unknown; transaction_outcome?: { id?: string }; transaction?: { hash?: string } }[];
      const failed = outcomes.find((o) => typeof o.status === "object" && o.status !== null && "Failure" in o.status);
      if (failed) throw new Error(`The transaction failed: ${JSON.stringify((failed.status as { Failure: unknown }).Failure)}`);
      setStep({ kind: "done", txHashes: outcomes.map((o) => o.transaction_outcome?.id ?? o.transaction?.hash).filter((h): h is string => !!h) });
    } catch (e) {
      setStep({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const disconnect = async () => {
    const c = await connector.current?.catch(() => null);
    await c?.disconnect().catch(() => {});
    setStep({ kind: "ready" });
  };

  // "Your wallet will ask you to call X on Y with Z attached." is said; the reason is behind "Why?".
  const [ask, ...reason] = d.walletNote.split(/(?<=\.) /);
  const yocto = /1 yoctoNEAR/.test(d.walletNote);
  const why = [...reason, ...(yocto ? ["Aftercall's own key can't attach a deposit, so it can never approve a payment or change a rule."] : [])].join(" ");

  return (
    <>
      <AppHeader width={640} tag={request.network} />
      <main className={g.main}>
        <div className={g.inner}>
          <section aria-labelledby="ah" className={`${g.intro} enter`}>
            {a.kind === "approve" && <Pill tone="caution">Over your limits</Pill>}
            {a.kind === "cancel" && <Pill tone="muted">Decline</Pill>}
            <h1 id="ah" className="t-display">
              {d.title}
            </h1>
            <p className="ink-2">{d.intro}</p>
          </section>

          {d.rows.length > 0 && (
            <dl className={`${g.facts} lift enter`} style={{ ["--d" as string]: "40ms" }}>
              {d.rows.map((r) => (
                <Row key={r.label} label={r.label} value={r.value} mono={r.mono} request={request} />
              ))}
            </dl>
          )}

          {step.kind === "done" ? (
            <section role="status" className={`${g.done} pop pop-spring`} style={{ ["--dur" as string]: "360ms" }}>
              <Tick size={24} d1="80ms" d2="220ms" decorative />
              <span>
                <span style={{ fontWeight: 600, color: "var(--verdigris)" }}>Signed. Aftercall updates on its own.</span>
                {step.txHashes.map((h) => (
                  <a key={h} className="mono" style={{ fontSize: 13 }} href={explorerTxUrl(request.network, h)} target="_blank" rel="noreferrer">
                    {h.slice(0, 8)}…{h.slice(-4)} on NEAR Explorer
                  </a>
                ))}
                <span className="ink-2">You can close this page.</span>
              </span>
            </section>
          ) : (
            <section aria-labelledby="sw" className={`${g.signSection} enter`} style={{ ["--d" as string]: "80ms" }}>
              <h2 id="sw" className="t-section">
                Sign with{" "}
                <span className="count">
                  your own wallet, as{" "}
                  <span className="mono" style={{ fontSize: 13 }}>
                    {request.owner}
                  </span>
                </span>
              </h2>
              <div className={g.wallets}>
                {wallets.map((w) => (
                  <WalletButton key={w.id} mark={w.name.slice(0, 1).toUpperCase()} label={w.short} busy={via === w.id} disabled={busy} onClick={() => sign(w)} />
                ))}
                <WalletButton mark="…" label={wallets.length ? "Other wallets" : "Choose a wallet"} busy={via === OTHER} disabled={busy} onClick={() => sign(null)} />
              </div>
              {busy && (
                <p role="status" className="ink enter" style={{ ["--dur" as string]: "240ms" }}>
                  {step.kind === "connecting" ? "Opening your wallet…" : "Waiting for your wallet… Sign there; this page updates when it’s done."}
                </p>
              )}
              {step.kind === "wrong-account" && (
                <p className={g.problem} role="alert">
                  Your wallet is signed in as <span className="mono">{step.account}</span>, but this needs <span className="mono">{request.owner}</span>.{" "}
                  <button type="button" onClick={disconnect} className="link-button">
                    Switch account
                  </button>
                </p>
              )}
              {step.kind === "failed" && (
                <p className={g.problem} role="alert">
                  {step.message}
                </p>
              )}
              <div className={g.walletNote}>
                <span>
                  <Names text={ask} contract={request.contract} />
                </span>
                {why && (
                  <details className="why">
                    <summary>Why?</summary>
                    <span className="why-body" style={{ display: "block", marginTop: 6 }}>
                      {why}
                    </span>
                  </details>
                )}
              </div>
            </section>
          )}

          <div className={g.foot}>
            <span className="mono muted" style={{ fontSize: 12, overflowWrap: "anywhere" }}>
              {request.contract}
            </span>
            <span className="ink-2" style={{ fontSize: 13 }}>
              Only you can sign this. Aftercall never sees your wallet&apos;s keys.
            </span>
          </div>
        </div>
      </main>
    </>
  );
}

function WalletButton({ mark, label, busy, disabled, onClick }: { mark: string; label: string; busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-busy={busy || undefined} className={`${g.wallet}${busy ? ` ${g.walletBusy}` : ""} press`}>
      <span aria-hidden="true" className={g.mark}>
        {mark}
      </span>
      {label}
      {busy && <span aria-hidden="true" className="spinner" style={{ width: 12, height: 12 }} />}
    </button>
  );
}

/** Method names and the contract set in mono, as the wallet will show them. */
function Names({ text, contract }: { text: string; contract: string }) {
  const escaped = contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped}|\\b[a-z]+(?:_[a-z]+)+\\b)`, "g"));
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className="mono ink" style={{ fontSize: 13 }}>
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}

const USDC_AMOUNT = /^([\d,]+\.\d+) USDC$/;

/** One line of what will be signed. Amounts are large, the payee has their avatar, the heard words are a quote. */
function Row({ label, value, mono, request }: { label: string; value: string; mono?: boolean; request: SignRequest }) {
  const a = request.action;
  const amount = mono ? USDC_AMOUNT.exec(value) : null;
  let body: ReactNode = mono ? (
    <span className="mono" style={{ fontSize: 13 }}>
      {value}
    </span>
  ) : (
    value
  );
  let cls = "";
  if (amount) {
    cls = g.amount;
    body = (
      <>
        <span>{amount[1]}</span>
        <span>USDC</span>
      </>
    );
  } else if (a.kind === "approve" && label === "To") {
    cls = g.person;
    const name = a.context?.payeeName;
    body = (
      <>
        <Avatar name={name ?? a.payee} size={28} decorative />
        {name && <span style={{ fontWeight: 600 }}>{name}</span>}
        <span className="mono ink-2" style={{ fontSize: 13 }}>
          {a.payee}
        </span>
      </>
    );
  } else if (a.kind === "approve" && label === "Heard") {
    cls = g.heard;
  } else if (a.kind === "approve" && label === "Cap today" && a.context) {
    body = (
      <>
        <span className="mono" style={{ fontSize: 13 }}>
          {a.context.leftToday}
        </span>{" "}
        <span className="ink-2">left; this goes past it once</span>
      </>
    );
  }
  return (
    <>
      <dt className={amount ? g.amountLabel : undefined}>{label}</dt>
      <dd className={cls || undefined}>{body}</dd>
    </>
  );
}
