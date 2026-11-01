"use client";

import { useEffect, useState } from "react";
import { exampleAccount, formatUsdc, parseClaimFragment, type ClaimDetails } from "@aftercall/core";
import { Avatar, Logo, Tick } from "../ui";
import k from "./claim.module.css";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
const ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** What the backend knows about the link: who pays, how much, and whether it's used. */
interface ClaimView {
  owner: string;
  amount: string;
  status: "open" | "claimed";
}

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "open"; claim: ClaimView } | { kind: "done"; claim: ClaimView; account: string };

/**
 * The payee's side of a claim link, on their phone. It only shares where to send
 * money; the payer confirms the account in their own wallet before paying.
 *
 * The link's #fragment holds the token plus the payee's name, memo and meeting
 * title. Browsers never send the fragment to a server; only the token goes to the
 * backend, and the details are shown from the link itself.
 */
export function ClaimClient() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [account, setAccount] = useState("");
  const [sending, setSending] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [details, setDetails] = useState<ClaimDetails>({});
  const [token, setToken] = useState<string | null>(null);
  const [host, setHost] = useState("");

  useEffect(() => {
    const { token, ...rest } = parseClaimFragment(window.location.hash);
    setDetails(rest);
    setToken(token);
    setHost(window.location.host);
  }, []);

  useEffect(() => {
    if (token === null) return;
    if (!token) return setState({ kind: "error", message: "This link is missing its code. Open it again from the email." });
    fetch(`${BACKEND}/claims/link/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.message === "CLAIM_EXPIRED" ? "This link has expired. Ask them to send a new one." : "This link doesn't work any more.");
        setState(body.status === "claimed" ? { kind: "error", message: "This link has already been used." } : { kind: "open", claim: body });
      })
      .catch((e) => setState({ kind: "error", message: e instanceof Error ? e.message : String(e) }));
  }, [token]);

  const share = async () => {
    if (state.kind !== "open") return;
    setSending(true);
    setShareError(null);
    try {
      const r = await fetch(`${BACKEND}/claims/link/${encodeURIComponent(token ?? "")}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account }),
      });
      if (!r.ok) throw new Error((await r.json()).message === "BAD_ACCOUNT" ? "That isn't a NEAR account name." : "Couldn't share it. Try again.");
      setState({ kind: "done", claim: state.claim, account });
    } catch (e) {
      setShareError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const header = (
    <header className={k.header}>
      <a href="/" className={k.brand} aria-label="Aftercall, home">
        <Logo size={22} />
        <span>Aftercall</span>
      </a>
      {host && <span className={k.host}>{host}</span>}
    </header>
  );

  if (state.kind === "loading") {
    return (
      <div className={k.page}>
        <div className={k.inner}>
          {header}
          <p className="ink-2" role="status">
            Opening the link…
          </p>
        </div>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className={k.page}>
        <div className={k.inner}>
          {header}
          <h1 className="serif enter" style={{ fontSize: 30, lineHeight: "36px", fontWeight: 500, letterSpacing: "-0.015em" }}>
            {state.message}
          </h1>
        </div>
      </div>
    );
  }

  const c = state.claim;
  const { payeeName, memo, meeting } = details;
  const amount = formatUsdc(BigInt(c.amount));
  const valid = ACCOUNT.test(account);
  // Claims don't carry a network; the payer's own account shows which one they use.
  const network = c.owner.endsWith(".testnet") ? "testnet" : "mainnet";
  const done = state.kind === "done";
  const steps: [string, "done" | "now" | "later"][] = [
    ["You share your NEAR account here.", done ? "done" : "now"],
    [`${c.owner} confirms in their own wallet that this account is you.`, done ? "now" : "later"],
    ["The payment is sent in USDC on NEAR, usually within seconds.", "later"],
  ];

  return (
    <div className={k.page}>
      <div className={k.inner}>
        {header}

        <section aria-labelledby="ch" className={`${k.intro} enter`}>
          <span className="t-eyebrow">A payment for you{payeeName ? `, ${payeeName}` : ""}</span>
          <div className={k.payer}>
            <Avatar name={c.owner} size={36} decorative />
            <span>
              <span className="mono" style={{ fontWeight: 500 }}>
                {c.owner}
              </span>
              <span className="ink-2" style={{ fontSize: 13, lineHeight: "18px" }}>
                on NEAR {network}
              </span>
            </span>
          </div>
          <h1 id="ch" className={k.h1}>
            <span>{c.owner} wants to pay you</span>
            <span className={k.amountClip}>
              <span className={`${k.amount} roll`} style={{ ["--d" as string]: "160ms" }}>
                {amount}
                <span>USDC</span>
              </span>
            </span>
          </h1>
          <p className="ink-2" style={{ fontSize: 15, lineHeight: "22px" }}>
            {memo && meeting ? `For: ${memo}, agreed in “${meeting}”. ` : memo ? `For: ${memo}. ` : meeting ? `Agreed in “${meeting}”. ` : ""}
            Tell them where to send it.
          </p>
        </section>

        {done ? (
          <section role="status" className={`${k.done} pop pop-spring`} style={{ ["--dur" as string]: "360ms" }}>
            <Tick size={24} d1="80ms" d2="220ms" decorative />
            <span>
              <span style={{ fontWeight: 600, color: "var(--verdigris)" }}>
                Shared{" "}
                <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>
                  {state.account}
                </span>
              </span>
              <span className="ink-2">{c.owner} confirms it in their own wallet, then the payment is sent in USDC on NEAR. You can close this page.</span>
            </span>
          </section>
        ) : (
          <section className={`${k.form} enter`} style={{ ["--d" as string]: "40ms" }}>
            <div className={k.fieldBlock}>
              <label htmlFor="acct">Your NEAR account</label>
              <input
                id="acct"
                value={account}
                onChange={(e) => {
                  setAccount(e.target.value.trim().toLowerCase());
                  setShareError(null);
                }}
                placeholder={exampleAccount(network)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={shareError ? true : undefined}
                aria-describedby="acct-hint"
                className={`field ${k.field}`}
              />
              <span id="acct-hint" className="ink-2" style={{ fontSize: 13, lineHeight: "19px" }}>
                No account yet?{" "}
                <a href="https://wallet.meteorwallet.app" target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>
                  Create one in a NEAR wallet
                </a>
                , then come back to this link.
              </span>
            </div>
            <button type="button" onClick={share} disabled={!valid || sending} className={`btn btn-primary press ${k.share}`}>
              {sending && <span aria-hidden="true" className="spinner spinner-on-accent" />}
              {sending ? "Sharing…" : `Share account with ${c.owner}`}
            </button>
            {shareError && (
              <p role="alert" style={{ color: "var(--record)" }}>
                {shareError}
              </p>
            )}
          </section>
        )}

        <section aria-labelledby="nx" className={`enter`} style={{ ["--d" as string]: "80ms", display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 id="nx" className="t-section">
            What happens next
          </h2>
          <ol className={k.next}>
            {steps.map(([label, s], i) => (
              <li key={i}>
                <span aria-hidden="true" className={`${k.stepMark} ${s === "done" ? k.markDone : s === "now" ? k.markNow : k.markLater}`}>
                  {s === "done" ? "✓" : i + 1}
                </span>
                <span className={s === "later" ? k.later : undefined}>
                  {label}
                  {s === "done" && <span className="sr-only"> Done.</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <p className={k.fine}>
          This link only shares where to send money; it can&apos;t take anything from you. It works once and expires in 7 days.
          {(payeeName || memo || meeting) && ` Your name and what this is for come from the link itself and were never stored on Aftercall's server. The amount and ${c.owner} come from the server.`}
        </p>
      </div>
    </div>
  );
}
