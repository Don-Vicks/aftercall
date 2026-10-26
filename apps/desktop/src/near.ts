import { invoke } from "@tauri-apps/api/core";
import type { OnChainProof } from "@aftercall/core";

export interface NearConfig {
  network: "testnet" | "mainnet";
  account: string;
  contract: string;
}

export interface NearStatus {
  publicKey: string;
  keyAdded: boolean;
  keyProblem: string | null;
  registered: boolean;
}

/** Where a proof was recorded; saved in notes.json. */
export interface ProofOnChain {
  network: NearConfig["network"];
  contract: string;
  owner: string;
  txHash: string;
  proofHash: string;
}

export const near = {
  getConfig: () => invoke<NearConfig | null>("near_get_config"),
  saveConfig: (config: NearConfig) => invoke<void>("near_save_config", { config }),
  publicKey: () => invoke<string>("near_public_key"),
  status: () => invoke<NearStatus>("near_status"),
  recordProof: (meetingId: string, proofHash: string, model: string) => invoke<string>("near_record_proof", { meetingId, proofHash, model }),
  getProof: (owner: string, meetingId: string) => invoke<OnChainProof | null>("near_get_proof", { owner, meetingId }),
};

/** Base of the public Verify page (apps/web). */
export const VERIFY_URL = import.meta.env.VITE_VERIFY_URL ?? "http://localhost:3000/verify";

export function explorerTx(network: NearConfig["network"], txHash: string): string {
  return network === "mainnet" ? `https://nearblocks.io/txns/${txHash}` : `https://testnet.nearblocks.io/txns/${txHash}`;
}

/** The one-time near-cli commands that connect the account to the app. */
export function setupCommands(c: NearConfig, publicKey: string): { register: string; addKey: string } {
  return {
    register: `near contract call-function as-transaction ${c.contract} register json-args '{}' prepaid-gas '30 Tgas' attached-deposit '0.1 NEAR' sign-as ${c.account} network-config ${c.network} sign-with-keychain send`,
    addKey: `near account add-key ${c.account} grant-function-call-access --allowance '0.25 NEAR' --contract-account-id ${c.contract} --function-names 'pay, record_proof' use-manually-provided-public-key ${publicKey} network-config ${c.network} sign-with-keychain send`,
  };
}
