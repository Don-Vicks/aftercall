/**
 * The NEAR network the backend checks sign-ins and reads stats on. Mirrors
 * packages/core/src/network.ts (the backend builds to CommonJS and can't import
 * core's TypeScript sources).
 */
export type Network = "testnet" | "mainnet";

/** FastNEAR's free RPC: the near.org endpoints are deprecated and rate-limited. */
export const DEFAULT_RPC: Record<Network, string> = {
  testnet: "https://test.rpc.fastnear.com",
  mainnet: "https://free.rpc.fastnear.com",
};

export interface NearEnv {
  network: Network;
  rpcUrl: string;
  /** The agent-wallet contract, if configured. */
  contract?: string;
}

/** Reads AFTERCALL_NETWORK, NEAR_RPC_URL and AFTERCALL_CONTRACT. Bad values stop the server. */
export function nearEnv(env: Record<string, string | undefined> = process.env): NearEnv {
  const name = (env.AFTERCALL_NETWORK ?? "testnet").trim().toLowerCase() || "testnet";
  if (name !== "testnet" && name !== "mainnet") throw new Error(`AFTERCALL_NETWORK must be testnet or mainnet, not "${name}"`);
  const network: Network = name;
  const contract = env.AFTERCALL_CONTRACT?.trim() || undefined;
  if (contract && network === "mainnet" && contract.endsWith(".testnet")) throw new Error(`AFTERCALL_CONTRACT ${contract} is a testnet account but AFTERCALL_NETWORK is mainnet`);
  if (contract && network === "testnet" && contract.endsWith(".near")) throw new Error(`AFTERCALL_CONTRACT ${contract} is a mainnet account but AFTERCALL_NETWORK is testnet`);
  return { network, rpcUrl: env.NEAR_RPC_URL?.trim() || DEFAULT_RPC[network], contract };
}
