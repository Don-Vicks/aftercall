/**
 * Everything that differs between NEAR testnet and mainnet, in one place: the RPC
 * endpoint, Circle's USDC contract, Aftercall's agent-wallet contract, the explorer
 * and the account suffix. The app, the web pages and the signing links all read from
 * here. Mirrored in `crates/near-tx` (`Network`) for the Mac app's Rust side.
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
  /**
   * Aftercall's shared agent-wallet contract (one contract, a wallet per caller), or
   * null where none is deployed yet. Anyone may point the app at their own deployment.
   */
  agentWallet: string | null;
  explorer: string;
  /** Named accounts end with this, e.g. victor.testnet or victor.near. */
  suffix: ".testnet" | ".near";
}

export const NETWORK_CONFIG: Record<Network, NetworkConfig> = {
  testnet: {
    network: "testnet",
    rpcUrl: "https://test.rpc.fastnear.com",
    usdc: "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af",
    agentWallet: "wallet.aftercall.testnet",
    explorer: "https://testnet.nearblocks.io",
    suffix: ".testnet",
  },
  mainnet: {
    network: "mainnet",
    rpcUrl: "https://free.rpc.fastnear.com",
    usdc: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    agentWallet: null,
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

/** The contract's own refusals that a person can act on, in their words. */
const REFUSALS: Record<string, string> = {
  ALREADY_REGISTERED: "Your agent wallet already exists.",
  NOT_REGISTERED: "Create your agent wallet first.",
  LOW_BALANCE: "Not enough USDC in your agent wallet.",
  UNKNOWN_PAYEE: "That account isn't on your payee list.",
  TOO_MANY_PAYEES: "Your payee list is full. Remove one first.",
  NO_SUCH_PENDING: "That payment isn't waiting any more.",
};

/**
 * A NEAR failure in words a person can act on, for the causes that have one: no
 * contract at that id, a contract that isn't Aftercall's, this Mac's key out of
 * allowance or gone, or a known refusal from the contract. Anything else comes back
 * unchanged. Takes an Error, a wallet's Failure object or text. The Mac app's Rust
 * side says the same in `near.rs` (`plain`).
 */
export function plainNearError(error: unknown, at: { network: Network; contract: string }): string {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error);
  const { network, contract } = at;
  // RPC: "account x does not exist while viewing"; a wallet's Failure: {"AccountDoesNotExist":{"account_id":"x"}}.
  const missing = (/account ([a-z0-9._-]+) does not exist/.exec(text) ?? /AccountDoesNotExist\W+account_id\W+([a-z0-9._-]+)/.exec(text))?.[1];
  if (missing === contract || /CodeDoesNotExist|NO_CONTRACT_CODE|has not been deployed/.test(text)) return `No Aftercall contract at ${contract} on ${network} yet.`;
  if (/MethodNotFound|MethodResolveError/.test(text)) return `${contract} isn't the Aftercall contract.`;
  if (/NotEnoughAllowance/.test(text)) return "Authorise this Mac again: its key ran out of allowance.";
  if (/AccessKeyNotFound|UNKNOWN_ACCESS_KEY/.test(text)) return "This Mac's key isn't on your account any more. Authorise this Mac again.";
  if (missing) return `${missing} doesn't exist on ${network}.`;
  const panic = /Smart contract panicked: ([A-Z_]+)/.exec(text)?.[1];
  if (panic) return REFUSALS[panic] ?? `The contract refused it: ${panic}.`;
  return text;
}

/**
 * Why `<name>.testnet` can't be a new account, or null if it can: NEAR's account-id rules
 * (lowercase a–z, 0–9, `-` and `_` between them, 64 characters in all) for a name made directly
 * under `testnet`, so no dots. Mirrors `new_testnet_name_problem` in the Mac app's near.rs, which
 * checks again before anything is created.
 */
export function newTestnetNameProblem(account: string): string | null {
  if (!account.endsWith(".testnet")) return "A new testnet account ends in .testnet.";
  const name = account.slice(0, -".testnet".length);
  if (name === "") return "Type a name.";
  if (name.length < 2) return "Use at least 2 characters.";
  if (name.length > 56) return "Use at most 56 characters.";
  if (name.includes(".")) return "Use one name with no dots.";
  const bad = [...name].find((c) => !/[a-z0-9_-]/.test(c));
  if (bad) return /[A-Z]/.test(bad) ? "Use lowercase letters." : `“${bad}” can't be in a NEAR name. Use a–z, 0–9, - and _.`;
  if (/^[-_]|[-_]$|[-_]{2}/.test(name)) return "- and _ go between letters or digits, one at a time.";
  return null;
}
