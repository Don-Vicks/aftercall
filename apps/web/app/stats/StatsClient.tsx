"use client";

import { useEffect, useState } from "react";
import { AppHeader, vars } from "../ui";
import s from "./stats.module.css";

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
    <>
      <AppHeader width={640} tag={stats?.network ?? "stats"} />
      <main className={s.main}>
        <div className={s.inner}>
          <section aria-labelledby="sh" className={`${s.intro} enter`}>
            <h1 id="sh" className="t-display">
              Aftercall in numbers
            </h1>
            <p className="ink-2">Counts only. Proofs and payments are read from the agent-wallet contract on NEAR; the rest from Aftercall&apos;s server.</p>
          </section>

          {error && (
            <p role="alert" style={{ color: "var(--caution)" }}>
              {error}
            </p>
          )}
          {!stats && !error && (
            <p role="status" className={`${s.loading} ink-2`}>
              <span aria-hidden="true" className="spinner" />
              Reading the counts…
            </p>
          )}
          {stats && (
            <dl className={s.counts}>
              {ROWS.map(([key, label], i) => (
                <div key={key} className="enter" style={vars({ d: `${40 + i * 50}ms`, dur: "280ms" })}>
                  <dt>{label}</dt>
                  <dd>{stats[key] === null ? <span className={s.na}>not available</span> : Number(stats[key]).toLocaleString("en-US")}</dd>
                </div>
              ))}
            </dl>
          )}
          {stats && (
            <span className="muted" style={{ fontSize: 13 }}>
              Updated {new Date(stats.updatedAt).toUTCString()}. Refreshes at most once a minute.
            </span>
          )}
        </div>
      </main>
    </>
  );
}
