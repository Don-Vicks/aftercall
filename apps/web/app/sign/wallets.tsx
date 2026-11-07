"use client";

import { NETWORK_CONFIG, type Network } from "@aftercall/core";
import g from "./sign.module.css";

/*
 * NEAR Connect for Aftercall's wallet pages: /sign (the owner's actions) and /deal (the payee
 * confirming a deal held in escrow). Each page signs only the transactions it builds itself.
 */

export type Connector = import("@hot-labs/near-connect").NearConnector;
export type Wallet = Awaited<ReturnType<Connector["connect"]>>;

/** A wallet from NEAR Connect's list, offered as a one-click choice. */
export interface Choice {
  id: string;
  name: string;
  short: string;
}

export const OTHER = "other";
/** Offered first when NEAR Connect lists them; any others fill up to four. */
const PREFERRED = [/meteor/i, /intear/i, /hot/i, /ledger/i];

/** One NEAR Connect for the page, loaded on first use (the page's first wallet list, or the first click). */
export function ensureConnector(ref: { current: Promise<Connector> | null }, network: Network): Promise<Connector> {
  ref.current ??= import("@hot-labs/near-connect").then(
    ({ NearConnector }) =>
      new NearConnector({
        network,
        providers: { mainnet: [NETWORK_CONFIG.mainnet.rpcUrl], testnet: [NETWORK_CONFIG.testnet.rpcUrl] },
      }),
  );
  return ref.current;
}

export function choices(c: Connector): Choice[] {
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

export function WalletButton({ mark, label, busy, disabled, onClick }: { mark: string; label: string; busy: boolean; disabled: boolean; onClick: () => void }) {
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

