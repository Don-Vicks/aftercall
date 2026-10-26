"use client";

import { useEffect, useState } from "react";
import { formatUsdc } from "@aftercall/core";
import { Page, button } from "../ui";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
const ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

interface ClaimView {
  owner: string;
  payeeName: string;
  amount: string;
  memo?: string;
  meeting: string;
  status: "open" | "claimed";
}

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "open"; claim: ClaimView } | { kind: "done"; claim: ClaimView; account: string };

/**
 * The payee's side of a claim link, on their phone. It only shares where to send
 * money; the payer confirms the account in their own wallet before paying.
 */
export function ClaimClient() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [account, setAccount] = useState("");
  const [sending, setSending] = useState(false);
  const token = typeof window === "undefined" ? "" : window.location.hash.slice(1);

  useEffect(() => {
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
    try {
      const r = await fetch(`${BACKEND}/claims/link/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account }),
      });
      if (!r.ok) throw new Error((await r.json()).message === "BAD_ACCOUNT" ? "That isn't a NEAR account name." : "Couldn't share it. Try again.");
      setState({ kind: "done", claim: state.claim, account });
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  if (state.kind === "loading") return <Page width={480}>{null}</Page>;
  if (state.kind === "error") {
    return (
      <Page width={480}>
        <h1 className="serif" style={{ margin: 0, fontSize: 30, lineHeight: "36px", fontWeight: 500 }}>{state.message}</h1>
      </Page>
    );
  }

  const c = state.claim;
  const amount = formatUsdc(BigInt(c.amount));
  const valid = ACCOUNT.test(account);

  return (
    <Page width={480}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span className="label">A payment for you</span>
        <h1 className="serif" style={{ margin: 0, fontSize: 30, lineHeight: "36px", fontWeight: 500, letterSpacing: "-0.015em" }}>
          {c.owner} wants to pay you <span className="mono" style={{ fontSize: 26 }}>{amount} USDC</span>
        </h1>
        <p className="muted" style={{ margin: 0 }}>
          {c.memo ? `For: ${c.memo}, agreed in “${c.meeting}”.` : `Agreed in “${c.meeting}”.`} Tell them where to send it.
        </p>
      </div>

      {state.kind === "done" ? (
        <div style={{ padding: "18px 20px", borderRadius: 10, background: "var(--verdigris-tint)", display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontWeight: 600, color: "var(--verdigris)" }}>Shared {state.account}</span>
          <span className="muted">{c.owner} confirms it in their own wallet, then the payment is sent in USDC on NEAR.</span>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label htmlFor="acct" className="label">Your NEAR account</label>
            <input
              id="acct"
              value={account}
              onChange={(e) => setAccount(e.target.value.trim().toLowerCase())}
              placeholder="yourname.near"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="mono"
              style={{ height: 48, padding: "0 14px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--well)", color: "var(--ink)", fontSize: 15 }}
            />
            <span className="muted" style={{ fontSize: 13 }}>
              No account yet? <a href="https://wallet.meteorwallet.app" target="_blank" rel="noreferrer">Create one in a NEAR wallet</a>, then come back to this link.
            </span>
          </div>
          <button onClick={share} disabled={!valid || sending} style={{ ...button("primary"), height: 48, opacity: !valid || sending ? 0.5 : 1 }}>
            Share account with {c.owner}
          </button>
        </>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, borderRadius: 10, background: "var(--raised)", boxShadow: "inset 0 0 0 1px var(--hairline)" }}>
        <span className="label">What happens next</span>
        <ol className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: "20px" }}>
          <li>{c.owner} confirms in their own wallet that this account is you.</li>
          <li>The payment is sent in USDC on NEAR, usually within seconds.</li>
        </ol>
      </div>

      <p className="muted" style={{ margin: 0, fontSize: 13 }}>This link only shares where to send money; it can't take anything from you. It works once and expires in 7 days.</p>
    </Page>
  );
}
