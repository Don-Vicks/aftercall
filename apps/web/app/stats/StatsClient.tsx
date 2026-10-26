"use client";

import { useEffect, useState } from "react";
import { Page } from "../ui";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

/** The backend's GET /stats: counts only, null when a source isn't available. */
interface Stats {
  network: string;
  meetingsVerified: number | null;
  walletsRegistered: number | null;
  paymentsSent: number | null;
  paymentsParked: number | null;
  claimLinksCreated: number | null;
  claimLinksClaimed: number | null;
  emailsSent: number | null;
  updatedAt: string;
}

const ROWS: [keyof Stats, string][] = [
  ["meetingsVerified", "Meetings with a proof on NEAR"],
  ["walletsRegistered", "Agent wallets"],
  ["paymentsSent", "USDC payments sent"],
  ["paymentsParked", "Payments held for a wallet signature"],
  ["claimLinksCreated", "Claim links sent"],
  ["claimLinksClaimed", "Claim links answered"],
  ["emailsSent", "Recap emails sent"],
];

/** Public usage counts. No names, accounts, amounts or meeting content. */
export function StatsClient() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BACKEND}/stats`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`The stats service answered ${r.status}.`);
        setStats(await r.json());
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <Page tag={stats?.network}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h1 className="serif" style={{ margin: 0, fontSize: 34, lineHeight: "40px", fontWeight: 500, letterSpacing: "-0.015em" }}>Aftercall in numbers</h1>
        <p className="serif muted" style={{ margin: 0, fontSize: 18, lineHeight: "29px" }}>
          Counts only. Proofs and payments are read from the agent-wallet contract on NEAR; the rest from Aftercall's server.
        </p>
      </div>
      {error && <p style={{ margin: 0, color: "var(--caution)" }}>{error}</p>}
      {stats && (
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "14px 20px", padding: "22px 24px", borderRadius: 10, background: "var(--raised)", boxShadow: "inset 0 0 0 1px var(--hairline)" }}>
          {ROWS.map(([key, label]) => (
            <div key={key} style={{ display: "contents" }}>
              <dt>{label}</dt>
              <dd className="mono" style={{ margin: 0, fontSize: 15, textAlign: "right" }}>
                {stats[key] === null ? <span className="muted">not available</span> : Number(stats[key]).toLocaleString("en-US")}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {stats && <span className="muted" style={{ fontSize: 13 }}>Updated {new Date(stats.updatedAt).toUTCString()}. Refreshes at most once a minute.</span>}
    </Page>
  );
}
