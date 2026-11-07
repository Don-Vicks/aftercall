import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  APP_KEY_METHODS,
  NETWORK_CONFIG,
  createOneClickClient,
  encodeSignRequest,
  explorerTxUrl,
  type EscrowState,
  type EscrowView,
  type Network,
  type OnChainProof,
  type OwnerAction,
  type PayoutChain,
} from "@aftercall/core";
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
  /** The key may open and release escrows. False for a key added before escrows: the owner updates it once. */
  keyEscrow: boolean;
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
  /** With `meetingId` (its proof is on this contract), the payment records which proof it came from. */
  pay: (payee: string, amount: bigint, memo: string, followupId: string, meetingId?: string) =>
    invoke<PayOutcome>("near_pay", { payee, amount: amount.toString(), memo, followupId, meetingId: meetingId ?? null }),
  /** `pay` with a NEAR Intents route: the USDC goes to the quote's deposit address, under the same caps. */
  payCrossChain: (payee: string, amount: bigint, memo: string, followupId: string, depositAddress: string, quoteId: string, meetingId?: string) =>
    invoke<PayOutcome>("near_pay_cross_chain", { payee, amount: amount.toString(), memo, followupId, depositAddress, quoteId, meetingId: meetingId ?? null }),
  /** Holds a deal in escrow (Handshake): set aside within the caps, or parked for the owner's wallet. */
  openEscrow: (escrowId: string, payee: string, amount: bigint, meetingId: string, termsHash: string, hasCondition: boolean) =>
    invoke<EscrowOutcome>("near_open_escrow", { escrowId, payee, amount: amount.toString(), meetingId, termsHash, hasCondition }),
  /** Pays a confirmed escrow to its payee; the state after says whether it landed. */
  releaseEscrow: (escrowId: string) => invoke<EscrowOutcome>("near_release_escrow", { escrowId }),
  escrow: (escrowId: string) => invoke<EscrowView | null>("near_escrow", { escrowId }),
  wallet: () => invoke<WalletView>("near_wallet"),
  checkPayee: (account: string) => invoke<{ exists: boolean; usdcReady: boolean }>("near_check_payee", { account }),
  ownerUsdc: () => invoke<string>("near_owner_usdc"),
  /** `asked`: the network, contract and account that answered, read with the answer. */
  paymentState: (followupId: string) => invoke<{ paid: boolean; pending: boolean; asked: NearConfig }>("near_payment_state", { followupId }),
};

export interface EscrowOutcome {
  txHash: string;
  state: EscrowState;
  reason: "OVER_CAP" | "OVER_PAYMENT_CAP" | null;
}

export interface PayOutcome {
  txHash: string;
  status: "paid" | "failed" | "blocked";
  reason: "OVER_CAP" | "OVER_PAYMENT_CAP" | "OVER_CROSS_CHAIN_CAP" | null;
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
    /** Most the app may pay on Solana or Base a day; 0 means off. */
    cross_chain_daily_cap: string;
    cross_chain_spent_today: string;
  } | null;
  payees: { account: string; label: string }[];
  /** Payees the owner opted in to payment on Solana or Base (get_payee_destinations). */
  destinations: { payee: string; chain: PayoutChain; address: string }[];
}

/** NEAR Intents 1Click, called from the webview (it allows any origin). No API key: 1Click adds its unauthenticated fee. */
export const oneClick = createOneClickClient({ fetch: (url, init) => fetch(url, init) });

/** A follow-up's id on the contract: unique per user across meetings. */
export { contractFollowupId } from "@aftercall/core";

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
    // Settings has near-cli commands for the setup signatures only.
    const cli = action.kind === "register" || action.kind === "authorise-key" || action.kind === "setup" ? ", or use the near-cli commands in Settings" : ", then try again";
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
/** The payee's confirm page for a deal held in escrow. */
export const DEAL_URL = `${WEB_URL}/deal`;
/** The web app is the local dev server (no VITE_WEB_URL at build time). */
const LOCAL_WEB = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(WEB_URL);

export function explorerTx(network: NearConfig["network"], txHash: string): string {
  return explorerTxUrl(network, txHash);
}

/** What the setup approval attaches, as packages/core/src/wallet/actions.ts sends it. */
export const REGISTER_DEPOSIT = "0.1 NEAR";
export const KEY_ALLOWANCE = "0.25 NEAR";
/** The methods this Mac's limited key may call. */
export const KEY_METHODS = APP_KEY_METHODS;
/** "pay, record_proof, open_escrow and release_escrow". */
export const KEY_METHODS_TEXT = `${KEY_METHODS.slice(0, -1).join(", ")} and ${KEY_METHODS[KEY_METHODS.length - 1]}`;

/** The one-time near-cli commands that connect the account to the app. */
export function setupCommands(c: NearConfig, publicKey: string): { register: string; addKey: string } {
  return {
    register: `near contract call-function as-transaction ${c.contract} register json-args '{}' prepaid-gas '30 Tgas' attached-deposit '${REGISTER_DEPOSIT}' sign-as ${c.account} network-config ${c.network} sign-with-keychain send`,
    addKey: `near account add-key ${c.account} grant-function-call-access --allowance '${KEY_ALLOWANCE}' --contract-account-id ${c.contract} --function-names '${KEY_METHODS.join(", ")}' use-manually-provided-public-key ${publicKey} network-config ${c.network} sign-with-keychain send`,
  };
}
