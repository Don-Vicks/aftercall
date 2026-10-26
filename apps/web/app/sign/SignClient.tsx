"use client";

import { useEffect, useRef, useState } from "react";
import { NETWORK_CONFIG, decodeSignRequest, describe, explorerTxUrl, toTransactions, type SignRequest } from "@aftercall/core";
import { Badge, Facts, Page, button } from "../ui";

type Connector = import("@hot-labs/near-connect").NearConnector;
type Wallet = Awaited<ReturnType<Connector["connect"]>>;

type Step =
  | { kind: "ready" }
  | { kind: "connecting" }
  | { kind: "wrong-account"; account: string }
  | { kind: "signing"; account: string }
  | { kind: "done"; txHashes: string[] }
  | { kind: "failed"; message: string };

/**
 * Signs one owner action from the Aftercall app with the user's own NEAR wallet.
 * The request comes in the link; this page only ever builds transactions for the
 * agent-wallet contract, USDC, or a limited key on the owner's own account.
 */
export function SignClient() {
  const [request, setRequest] = useState<SignRequest | null | "bad">(null);
  const [step, setStep] = useState<Step>({ kind: "ready" });
  const connector = useRef<Connector | null>(null);

  useEffect(() => {
    try {
      setRequest(decodeSignRequest(window.location.hash));
    } catch {
      setRequest("bad");
    }
  }, []);

  if (request === null) return <Page tag="sign">{null}</Page>;
  if (request === "bad") {
    return (
      <Page tag="sign">
        <h1 className="serif" style={{ margin: 0, fontSize: 34, lineHeight: "40px", fontWeight: 500 }}>This signing link is damaged</h1>
        <p className="serif muted" style={{ margin: 0, fontSize: 18, lineHeight: "29px" }}>Open it again from the Aftercall app. Nothing was signed.</p>
      </Page>
    );
  }

  const d = describe(request);
  const approving = request.action.kind === "approve";

  const sign = async () => {
    setStep({ kind: "connecting" });
    try {
      if (!connector.current) {
        const { NearConnector } = await import("@hot-labs/near-connect");
        connector.current = new NearConnector({
          network: request.network,
          providers: { mainnet: [NETWORK_CONFIG.mainnet.rpcUrl], testnet: [NETWORK_CONFIG.testnet.rpcUrl] },
        });
      }
      const wallet: Wallet = await connector.current.connect();
      const accounts = await wallet.getAccounts({ network: request.network });
      const account = accounts[0]?.accountId;
      if (!account) throw new Error("The wallet didn't share an account.");
      if (account !== request.owner) return setStep({ kind: "wrong-account", account });
      setStep({ kind: "signing", account });
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
    await connector.current?.disconnect().catch(() => {});
    setStep({ kind: "ready" });
  };

  return (
    <Page tag={request.network}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {approving && <Badge tone="caution">Over your limits</Badge>}
        <h1 className="serif" style={{ margin: 0, fontSize: 34, lineHeight: "40px", fontWeight: 500, letterSpacing: "-0.015em" }}>{d.title}</h1>
        <p className="serif muted" style={{ margin: 0, fontSize: 18, lineHeight: "29px" }}>{d.intro}</p>
      </div>

      {d.rows.length > 0 && <Facts rows={d.rows} />}

      {step.kind === "done" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "18px 20px", borderRadius: 10, background: "var(--verdigris-tint)" }}>
          <span style={{ fontWeight: 600, color: "var(--verdigris)" }}>Signed. Aftercall updates on its own.</span>
          {step.txHashes.map((h) => (
            <a key={h} className="mono" href={explorerTxUrl(request.network, h)} target="_blank" rel="noreferrer">
              {h.slice(0, 8)}…{h.slice(-6)} on NEAR Explorer
            </a>
          ))}
          <span className="muted">You can close this page.</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span className="label">Sign as {request.owner}</span>
          <p className="muted" style={{ margin: 0 }}>{d.walletNote}</p>
          {step.kind === "wrong-account" && (
            <p style={{ margin: 0, color: "var(--caution)" }}>
              Your wallet is signed in as <span className="mono">{step.account}</span>, but this needs <span className="mono">{request.owner}</span>.{" "}
              <button onClick={disconnect} style={{ border: 0, padding: 0, background: "none", color: "var(--verdigris)", fontWeight: 600 }}>
                Switch account
              </button>
            </p>
          )}
          {step.kind === "failed" && <p style={{ margin: 0, color: "var(--caution)", overflowWrap: "anywhere" }}>{step.message}</p>}
          <button
            onClick={sign}
            disabled={step.kind === "connecting" || step.kind === "signing"}
            style={{ ...button("primary"), alignSelf: "flex-start", opacity: step.kind === "connecting" || step.kind === "signing" ? 0.6 : 1 }}
          >
            {step.kind === "connecting" ? "Opening your wallet…" : step.kind === "signing" ? "Waiting for your wallet…" : `${d.confirm} with a NEAR wallet`}
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12, paddingTop: 20, borderTop: "1px solid var(--hairline)" }}>
        <span className="muted mono" style={{ fontSize: 12 }}>{request.contract}</span>
        <span className="muted">Only you can sign this. Aftercall never sees your wallet's keys.</span>
      </div>
    </Page>
  );
}
