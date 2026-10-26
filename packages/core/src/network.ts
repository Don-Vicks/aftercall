/**
 * Everything that differs between NEAR testnet and mainnet, in one place: the RPC
 * endpoint, Circle's USDC contract, the explorer and the account suffix. The app,
 * the web pages and the signing links all read from here.
 */

export type Network = "testnet" | "mainnet";
export const NETWORKS: readonly Network[] = ["testnet", "mainnet"];

export interface NetworkConfig {
  network: Network;
  /**
   * Public JSON-RPC. FastNEAR's free endpoints: the near.org ones are deprecated
   * and rate-limited (https://docs.near.org/api/rpc/providers).
   */
  rpcUrl: string;
  /** Circle USDC (NEP-141, 6 decimals). */
  usdc: string;
  explorer: string;
  /** Named accounts end with this, e.g. victor.testnet or victor.near. */
  suffix: ".testnet" | ".near";
}

export const NETWORK_CONFIG: Record<Network, NetworkConfig> = {
  testnet: {
    network: "testnet",
    rpcUrl: "https://test.rpc.fastnear.com",
    usdc: "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af",
    explorer: "https://testnet.nearblocks.io",
    suffix: ".testnet",
  },
  mainnet: {
    network: "mainnet",
    rpcUrl: "https://free.rpc.fastnear.com",
    usdc: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    explorer: "https://nearblocks.io",
    suffix: ".near",
  },
};

export function isNetwork(value: unknown): value is Network {
  return value === "testnet" || value === "mainnet";
}

/** Parses a network name, e.g. from an env var. Anything else is refused. */
export function parseNetwork(value: string | undefined, fallback: Network = "testnet"): Network {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "") return fallback;
  if (!isNetwork(v)) throw new Error(`BAD_NETWORK: ${value}`);
  return v;
}

export const explorerTxUrl = (network: Network, txHash: string) => `${NETWORK_CONFIG[network].explorer}/txns/${txHash}`;
export const explorerAccountUrl = (network: Network, account: string) => `${NETWORK_CONFIG[network].explorer}/address/${account}`;

/** An example account id for placeholders: "yourname.testnet" or "yourname.near". */
export const exampleAccount = (network: Network, name = "yourname") => `${name}${NETWORK_CONFIG[network].suffix}`;

/**
 * Could this account exist on this network? Named accounts carry the network's
 * suffix (top-level names like `aurora` exist only on mainnet); implicit accounts
 * (64 hex characters, or 0x + 40 hex) exist on both. Catches a testnet account
 * typed into a mainnet setup before anything is signed.
 */
export function accountFitsNetwork(account: string, network: Network): boolean {
  if (/^[0-9a-f]{64}$/.test(account) || /^0x[0-9a-f]{40}$/.test(account)) return true;
  if (network === "testnet") return account.endsWith(".testnet");
  return !account.endsWith(".testnet");
}
