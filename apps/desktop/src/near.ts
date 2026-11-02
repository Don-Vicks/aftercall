import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { NETWORK_CONFIG, createOneClickClient, encodeSignRequest, explorerTxUrl, type Network, type OnChainProof, type OwnerAction, type PayoutChain } from "@aftercall/core";
import { isDesktop } from "./recorder";

export interface NearConfig {
  network: Network;
  account: string;
  contract: string;
}

/** What the account check ("Check and continue") found: the account exists, and the contract is Aftercall's ("ok"), absent ("missing") or another contract ("wrong"). */
export interface SetupCheck {
  account: boolean;
  contract: "ok" | "missing" | "wrong";
}

/** Aftercall's own agent-wallet contract on this network, or null where none is deployed yet (mainnet today). */
export const builtInContract = (network: Network): string | null => NETWORK_CONFIG[network].agentWallet;

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
  /** What the transaction cost in yoctoNEAR (gas burnt), paid from this Mac's key allowance. Absent on older notes, or if NEAR didn't say. */
  fee?: string;
}

export const near = {
  getConfig: () => invoke<NearConfig | null>("near_get_config"),
  saveConfig: (config: NearConfig) => invoke<void>("near_save_config", { config }),
  /** Read-only: checks the account and that the contract is Aftercall's. Saves nothing. */
  checkSetup: (config: NearConfig) => invoke<SetupCheck>("near_check_setup", { config }),
  publicKey: () => invoke<string>("near_public_key"),
  status: () => invoke<NearStatus>("near_status"),
  recordProof: (meetingId: string, proofHash: string, model: string) => invoke<{ txHash: string; fee: string | null }>("near_record_proof", { meetingId, proofHash, model }),
  getProof: (owner: string, meetingId: string) => invoke<OnChainProof | null>("near_get_proof", { owner, meetingId }),
  pay: (payee: string, amount: bigint, memo: string, followupId: string) =>
    invoke<PayOutcome>("near_pay", { payee, amount: amount.toString(), memo, followupId }),
  /** `pay` with a NEAR Intents route: the USDC goes to the quote's deposit address, under the same caps. */
  payCrossChain: (payee: string, amount: bigint, memo: string, followupId: string, depositAddress: string, quoteId: string) =>
    invoke<PayOutcome>("near_pay_cross_chain", { payee, amount: amount.toString(), memo, followupId, depositAddress, quoteId }),
  wallet: () => invoke<WalletView>("near_wallet"),
  checkPayee: (account: string) => invoke<{ exists: boolean; usdcReady: boolean }>("near_check_payee", { account }),
  ownerUsdc: () => invoke<string>("near_owner_usdc"),
  paymentState: (followupId: string) => invoke<{ paid: boolean; pending: boolean }>("near_payment_state", { followupId }),
};

export interface PayOutcome {
  txHash: string;
  status: "paid" | "failed" | "blocked";
  reason: "OVER_CAP" | "OVER_PAYMENT_CAP" | null;
  leftToday: string | null;
}

/** get_wallet and get_payees, as the contract returns them (amounts are base-unit strings). */
export interface WalletView {
  wallet: {
    balance: string;
    daily_cap: string;
    spent_today: string;
    day: number;
    paused: boolean;
    pending_count: number;
    storage_credit: string;
    per_payment_cap: string;
  } | null;
  payees: { account: string; label: string }[];
  /** Payees the owner opted in to payment on Solana or Base (get_payee_destinations). */
  destinations: { payee: string; chain: PayoutChain; address: string }[];
}

/** NEAR Intents 1Click, called from the webview (it allows any origin). No API key: 1Click adds its unauthenticated fee. */
export const oneClick = createOneClickClient({ fetch: (url, init) => fetch(url, init) });

/** A follow-up's id on the contract: unique per user across meetings. */
export const contractFollowupId = (meetingId: string, followupId: string) => `${meetingId}-${followupId}`;

/** The signing page didn't answer, so nothing was opened. Its message says how to start it. */
export class SignPageDown extends Error {}

/** Does the signing page answer? Asked from Rust, with a 3-second timeout. */
const signPageAnswers = () => invoke<boolean>("near_page_answers", { url: SIGN_URL }).catch(() => false);

/**
 * Opens the signing page so the owner signs this change in their own wallet. Checks the
 * page answers first, so a web app that isn't running never opens a dead tab.
 */
export async function signInWallet(action: OwnerAction): Promise<void> {
  const config = await near.getConfig();
  if (!config) throw new Error("Connect your NEAR account first.");
  if (isDesktop && !(await signPageAnswers())) {
    // Settings has near-cli commands for the two setup signatures only.
    const cli = action.kind === "register" || action.kind === "authorise-key" ? ", or use the near-cli commands in Settings" : ", then try again";
    throw new SignPageDown(
      LOCAL_WEB
        ? `The signing page isn't running. Start it with pnpm --filter @aftercall/web dev${cli}.`
        : `The signing page at ${SIGN_URL} isn't answering. Check your connection${cli}.`,
    );
  }
  await openUrl(`${SIGN_URL}#${encodeSignRequest({ network: config.network, contract: config.contract, owner: config.account, action })}`);
}

/** Calls `check` every 3 seconds until it returns true or two minutes pass. On false, offer "Check again". */
export async function waitFor(check: () => Promise<boolean>, timeoutMs = 120_000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

/** The web app (apps/web): public Verify page, wallet signing page, claim page. */
export const WEB_URL = import.meta.env.VITE_WEB_URL ?? "http://localhost:3000";
export const VERIFY_URL = `${WEB_URL}/verify`;
export const SIGN_URL = `${WEB_URL}/sign`;
/** The web app is the local dev server (no VITE_WEB_URL at build time). */
const LOCAL_WEB = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(WEB_URL);

export function explorerTx(network: NearConfig["network"], txHash: string): string {
  return explorerTxUrl(network, txHash);
}

/** What the two setup signatures attach, as packages/core/src/wallet/actions.ts sends them. */
export const REGISTER_DEPOSIT = "0.1 NEAR";
export const KEY_ALLOWANCE = "0.25 NEAR";
/** The two methods this Mac's limited key may call. */
export const KEY_METHODS = ["pay", "record_proof"] as const;

/** The one-time near-cli commands that connect the account to the app. */
export function setupCommands(c: NearConfig, publicKey: string): { register: string; addKey: string } {
  return {
    register: `near contract call-function as-transaction ${c.contract} register json-args '{}' prepaid-gas '30 Tgas' attached-deposit '${REGISTER_DEPOSIT}' sign-as ${c.account} network-config ${c.network} sign-with-keychain send`,
    addKey: `near account add-key ${c.account} grant-function-call-access --allowance '${KEY_ALLOWANCE}' --contract-account-id ${c.contract} --function-names '${KEY_METHODS.join(", ")}' use-manually-provided-public-key ${publicKey} network-config ${c.network} sign-with-keychain send`,
  };
}
