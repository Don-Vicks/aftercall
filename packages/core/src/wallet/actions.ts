import { formatUsdc } from "../money.ts";
import { NETWORK_CONFIG, isNetwork, type Network } from "../network.ts";
import { CHAIN_NAME, isValidPayoutAddress, PAYOUT_CHAINS, type PayoutChain } from "../intents/oneclick.ts";

/**
 * Everything only the owner's own NEAR wallet may do with the agent wallet. The app
 * can't sign these (its key is limited to `APP_KEY_METHODS`), so it opens a
 * signing page with a request; the page shows exactly what will be signed and hands
 * the transactions to the user's wallet.
 */

export type { Network };

/** Circle USDC (NEP-141, 6 decimals). */
export const USDC_CONTRACT: Record<Network, string> = {
  mainnet: NETWORK_CONFIG.mainnet.usdc,
  testnet: NETWORK_CONFIG.testnet.usdc,
};

const ONE_YOCTO = "1";

/**
 * The only methods this Mac's limited key may call on the contract: paying and recording
 * proofs, and opening and releasing escrows (Handshake). Never a rule change: those need
 * 1 yoctoNEAR, which a function-call key can't attach.
 */
export const APP_KEY_METHODS = ["pay", "record_proof", "open_escrow", "release_escrow"] as const;
/** What a key added before escrows existed may call. It still pays; it can't open an escrow until the owner approves the new list once (`update-key`). */
export const OLD_APP_KEY_METHODS = ["pay", "record_proof"] as const;
const keyMethodsText = "pay, record_proof, open_escrow and release_escrow";
const TGAS = (n: number) => `${n}000000000000`;
/** NEAR in yocto, from a decimal string like "0.1". */
function near(amount: string): string {
  const [whole, frac = ""] = amount.split(".");
  return (BigInt(whole) * 10n ** 24n + BigInt((frac + "0".repeat(24)).slice(0, 24))).toString();
}

/** "50000000000000000000000" yocto -> "0.05 NEAR". */
function nearText(yocto: string): string {
  const n = BigInt(yocto);
  const frac = (n % 10n ** 24n).toString().padStart(24, "0").replace(/0+$/, "");
  return `${n / 10n ** 24n}${frac ? `.${frac}` : ""} NEAR`;
}

export type OwnerAction =
  | { kind: "register" }
  | { kind: "authorise-key"; publicKey: string }
  /**
   * Re-adds this Mac's key with today's method list, in one transaction: a key added before
   * escrows existed can't open or release one. The same key, so nothing else changes.
   */
  | { kind: "update-key"; publicKey: string }
  /**
   * First-time setup in one wallet approval: whichever of these is still missing. One
   * transaction to the contract (`register`, then `set_cap`, in order, as one receipt),
   * one AddKey on the owner's own account, and the owner's USDC registration.
   */
  | { kind: "setup"; register: boolean; dailyCap?: string; publicKey?: string; registerUsdc: boolean }
  | { kind: "set-cap"; dailyCap: string }
  | { kind: "set-payment-cap"; perPaymentCap: string }
  /** Most Aftercall may pay on Solana or Base in a day; 0 turns those payments off. */
  | { kind: "set-cross-chain-cap"; crossChainCap: string }
  /** NEAR (yocto) added to, or taken back from, the wallet's storage credit. */
  | { kind: "add-storage-credit"; yoctoNear: string }
  | { kind: "withdraw-storage-credit"; yoctoNear: string }
  | { kind: "add-payee"; account: string; label: string; registerWithUsdc: boolean; destination?: PayeeDestination }
  /** Opts a listed payee in to (or, with null, out of) payment on Solana or Base through NEAR Intents. */
  | { kind: "set-payee-destination"; account: string; label: string; destination: PayeeDestination | null }
  | { kind: "remove-payee"; account: string; label: string }
  | { kind: "deposit"; amount: string }
  | { kind: "withdraw"; amount: string }
  | { kind: "approve"; followupId: string; payee: string; amount: string; context?: PaymentContext }
  | { kind: "cancel"; followupId: string; payee: string; amount: string }
  /** Sets aside a deal the contract parked over a cap, for the payee to confirm. */
  | { kind: "approve-escrow"; escrowId: string; payee: string; amount: string; payeeName?: string }
  /** Takes an escrow back: parked, or open before the payee confirmed, or confirmed 30 days ago and not released. */
  | { kind: "cancel-escrow"; escrowId: string; payee: string; amount: string; payeeName?: string }
  | { kind: "pause"; paused: boolean };

/** Where a payee is paid outside NEAR; the contract's `Destination`. */
export interface PayeeDestination {
  chain: PayoutChain;
  address: string;
}

/** Shown on the approve page so the person sees why the payment exists. */
export interface PaymentContext {
  payeeName: string;
  meeting: string;
  heard: string;
  leftToday: string;
  /**
   * Set when a coding agent proposed the payment rather than the call: the agent and its
   * reason. Shown in place of the words heard, which such a payment has none of.
   */
  proposedBy?: string;
}

export interface SignRequest {
  network: Network;
  contract: string;
  owner: string;
  action: OwnerAction;
}

/** One transaction in the format the wallet connector expects. */
export interface WalletTransaction {
  receiverId: string;
  actions: (
    | { type: "FunctionCall"; params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string } }
    | { type: "AddKey"; params: { publicKey: string; accessKey: { permission: { receiverId: string; allowance: string; methodNames: string[] } } } }
    | { type: "DeleteKey"; params: { publicKey: string } }
  )[];
}

/** Registers an account with USDC (NEP-145), so it can hold USDC. A no-op refund if it already is. */
const USDC_STORAGE = "1250000000000000000000";

/** The limited key: only `APP_KEY_METHODS` on the contract, with 0.25 NEAR for fees. */
const addKeyAction = (r: SignRequest, publicKey: string): WalletTransaction["actions"][number] => ({
  type: "AddKey",
  params: { publicKey, accessKey: { permission: { receiverId: r.contract, allowance: near("0.25"), methodNames: [...APP_KEY_METHODS] } } },
});
const addKey = (r: SignRequest, publicKey: string): WalletTransaction => ({ receiverId: r.owner, actions: [addKeyAction(r, publicKey)] });

const call = (receiverId: string, methodName: string, args: Record<string, unknown>, deposit = ONE_YOCTO, gas = TGAS(30)): WalletTransaction => ({
  receiverId,
  actions: [{ type: "FunctionCall", params: { methodName, args, gas, deposit } }],
});

/** USDC amounts travel as integer base-unit strings. */
const usdc = (base: string) => `${formatUsdc(BigInt(base))} USDC`;

export function toTransactions(r: SignRequest): WalletTransaction[] {
  const a = r.action;
  const token = USDC_CONTRACT[r.network];
  switch (a.kind) {
    case "register":
      return [call(r.contract, "register", {}, near("0.1"))];
    case "authorise-key":
      return [addKey(r, a.publicKey)];
    case "update-key":
      // NEAR can't change a key's permission in place: delete and add it back, in one transaction.
      return [{ receiverId: r.owner, actions: [{ type: "DeleteKey", params: { publicKey: a.publicKey } }, addKeyAction(r, a.publicKey)] }];
    case "setup": {
      const txs: WalletTransaction[] = [];
      // The owner's own USDC registration first: the faucet's USDC would bounce without it.
      if (a.registerUsdc) txs.push(call(token, "storage_deposit", { account_id: r.owner, registration_only: true }, USDC_STORAGE));
      // register then set_cap as two actions of one transaction: NEAR runs them in order, and
      // if either fails neither sticks. set_cap needs the wallet register makes.
      const wallet = [
        ...(a.register ? call(r.contract, "register", {}, near("0.1")).actions : []),
        ...(a.dailyCap !== undefined ? call(r.contract, "set_cap", { daily_cap: a.dailyCap }).actions : []),
      ];
      if (wallet.length) txs.push({ receiverId: r.contract, actions: wallet });
      if (a.publicKey) txs.push(addKey(r, a.publicKey));
      if (!txs.length) throw new Error("NOTHING_TO_SIGN");
      return txs;
    }
    case "set-cap":
      return [call(r.contract, "set_cap", { daily_cap: a.dailyCap })];
    case "set-payment-cap":
      return [call(r.contract, "set_payment_cap", { per_payment_cap: a.perPaymentCap })];
    case "set-cross-chain-cap":
      return [call(r.contract, "set_cross_chain_cap", { cross_chain_daily_cap: a.crossChainCap })];
    case "add-storage-credit":
      return [call(r.contract, "add_storage_credit", {}, a.yoctoNear)];
    case "withdraw-storage-credit":
      return [call(r.contract, "withdraw_storage_credit", { amount: a.yoctoNear })];
    case "add-payee":
      return [
        // The payee must be able to hold USDC, or every payment to them would bounce.
        ...(a.registerWithUsdc ? [call(token, "storage_deposit", { account_id: a.account, registration_only: true }, USDC_STORAGE)] : []),
        call(r.contract, "add_payee", { payee: a.account, label: a.label }),
        ...(a.destination ? [call(r.contract, "set_payee_destination", { payee: a.account, destination: a.destination })] : []),
      ];
    case "set-payee-destination":
      return [call(r.contract, "set_payee_destination", { payee: a.account, destination: a.destination })];
    case "remove-payee":
      return [call(r.contract, "remove_payee", { payee: a.account })];
    case "deposit":
      return [call(token, "ft_transfer_call", { receiver_id: r.contract, amount: a.amount, msg: "" }, ONE_YOCTO, TGAS(100))];
    case "withdraw":
      return [call(r.contract, "withdraw", { amount: a.amount }, ONE_YOCTO, TGAS(60))];
    case "approve":
      return [call(r.contract, "approve_pending", { followup_id: a.followupId }, ONE_YOCTO, TGAS(60))];
    case "cancel":
      return [call(r.contract, "cancel_pending", { followup_id: a.followupId })];
    case "approve-escrow":
      return [call(r.contract, "approve_escrow", { escrow_id: a.escrowId })];
    case "cancel-escrow":
      return [call(r.contract, "cancel_escrow", { escrow_id: a.escrowId })];
    case "pause":
      return [call(r.contract, "set_paused", { paused: a.paused })];
  }
}

export interface Description {
  title: string;
  intro: string;
  rows: { label: string; value: string; mono?: boolean }[];
  /** What the wallet will show, in plain words. */
  walletNote: string;
  confirm: string;
}

export function describe(r: SignRequest): Description {
  const a = r.action;
  const note = (method: string, deposit = "1 yoctoNEAR") =>
    `Your wallet will ask you to call ${method} on ${r.contract} with ${deposit} attached. That's normal: it proves the signature came from you, not from Aftercall.`;
  switch (a.kind) {
    case "register":
      return {
        title: "Create your agent wallet",
        intro: "A wallet on the Aftercall contract that only you control.",
        rows: [{ label: "Storage", value: "0.1 NEAR: a little pays for the wallet's own record, the rest is your storage credit for proofs, payments and payees" }],
        walletNote: note("register", "0.1 NEAR"),
        confirm: "Create wallet",
      };
    case "authorise-key":
      return {
        title: "Authorise this Mac",
        intro: "Adds Aftercall's key to your account, limited to four methods on one contract. It can never move funds outside your rules.",
        rows: [
          { label: "Key", value: a.publicKey, mono: true },
          { label: "May call", value: `${keyMethodsText} on ${r.contract}`, mono: true },
          { label: "Gas allowance", value: "0.25 NEAR" },
        ],
        walletNote: "Your wallet will ask you to add a limited access key to your account.",
        confirm: "Authorise",
      };
    case "setup": {
      const parts = [
        ...(a.register || a.dailyCap !== undefined ? [`${[a.register && "register", a.dailyCap !== undefined && "set_cap"].filter(Boolean).join(" and ")} on ${r.contract}`] : []),
        ...(a.publicKey ? [`a limited key on ${r.owner}`] : []),
        ...(a.registerUsdc ? ["storage_deposit on the USDC contract"] : []),
      ];
      const n = toTransactions(r).length;
      return {
        title: a.register ? "Set up your agent wallet" : a.publicKey ? "Authorise this Mac" : "Register with USDC",
        intro: "One approval does all of it. Only your wallet can change these later.",
        rows: [
          ...(a.register ? [{ label: "Agent wallet", value: `Created on ${r.contract}, with 0.1 NEAR kept as your storage credit` }] : []),
          ...(a.dailyCap !== undefined ? [{ label: "Daily cap", value: `${usdc(a.dailyCap)} a day, all payments together` }] : []),
          ...(a.publicKey
            ? [
                { label: "This Mac's key", value: a.publicKey, mono: true },
                { label: "May call", value: `${keyMethodsText} on ${r.contract}`, mono: true },
                { label: "Fee allowance", value: "0.25 NEAR" },
              ]
            : []),
          ...(a.registerUsdc ? [{ label: "USDC", value: "Registers your account with USDC, so it can hold some: 0.00125 NEAR, once" }] : []),
        ],
        walletNote: `Your wallet will ask you to approve ${n === 1 ? "one transaction" : `${n} transactions at once`}: ${listText(parts)}. That's everything; Aftercall's own key could do none of it.`,
        confirm: "Approve in wallet",
      };
    }
    case "update-key":
      return {
        title: "Let this Mac hold deals in escrow",
        intro:
          "This Mac's key was added before escrows existed, so it can pay but can't hold a deal for the payee to confirm. This adds the same key back with two more methods. Escrows count against the same caps, and the key still can't change a rule or take money back.",
        rows: [
          { label: "Key", value: a.publicKey, mono: true },
          { label: "May call", value: `${keyMethodsText} on ${r.contract}`, mono: true },
          { label: "Fee allowance", value: "0.25 NEAR, fresh" },
        ],
        walletNote: "Your wallet will ask you to delete this Mac's key and add it back, in one transaction. That's how NEAR changes what a key may call.",
        confirm: "Update key",
      };
    case "set-cap":
      return { title: "Change your daily cap", intro: "The most Aftercall can pay in one day without your wallet.", rows: [{ label: "New daily cap", value: usdc(a.dailyCap), mono: true }], walletNote: note("set_cap"), confirm: "Set cap" };
    case "set-payment-cap":
      return {
        title: "Change your per-payment cap",
        intro:
          "The biggest single payment Aftercall can send without your wallet, whether you approve it in the app or autopilot does. Bigger ones wait for your wallet, or are refused if paid on Solana or Base. 0 means no per-payment cap, and autopilot then pays nothing.",
        rows: [{ label: "New per-payment cap", value: usdc(a.perPaymentCap), mono: true }],
        walletNote: note("set_payment_cap"),
        confirm: "Set cap",
      };
    case "set-cross-chain-cap":
      return {
        title: "Change your cap for other chains",
        intro:
          "The most Aftercall can pay on Solana or Base in one day, through NEAR Intents. Those payments count towards your daily cap too, and over either cap they're refused, not held for your wallet. Keep it small: the contract can't check where NEAR Intents sends the money. 0 turns payments on other chains off.",
        rows: [{ label: "New cap for other chains", value: usdc(a.crossChainCap), mono: true }],
        walletNote: note("set_cross_chain_cap"),
        confirm: "Set cap",
      };
    case "add-storage-credit":
      return {
        title: "Top up storage credit",
        intro: "Adds NEAR to your agent wallet's storage credit, which pays for the proofs, payments and payees it keeps on NEAR.",
        rows: [{ label: "Amount", value: nearText(a.yoctoNear), mono: true }],
        walletNote: note("add_storage_credit", nearText(a.yoctoNear)),
        confirm: "Top up",
      };
    case "withdraw-storage-credit":
      return {
        title: "Take back storage credit",
        intro: "Sends unused storage credit back to your NEAR account. Records already stored stay paid for. With too little credit left, new proofs and payments are refused until you top up.",
        rows: [{ label: "Amount", value: nearText(a.yoctoNear), mono: true }, { label: "To", value: r.owner, mono: true }],
        walletNote: note("withdraw_storage_credit"),
        confirm: "Take back",
      };
    case "add-payee":
      return {
        title: "Add a payee",
        intro: "Aftercall can only pay people on this list.",
        rows: [
          { label: "Account", value: a.account, mono: true },
          { label: "Label", value: a.label },
          ...(a.registerWithUsdc ? [{ label: "USDC", value: "Registers the account with USDC: 0.00125 NEAR, once" }] : []),
          ...(a.destination ? destinationRows(a.destination) : []),
        ],
        walletNote: a.destination ? note("add_payee and set_payee_destination") : note("add_payee"),
        confirm: a.registerWithUsdc ? "Add and register" : "Add payee",
      };
    case "set-payee-destination":
      return a.destination
        ? {
            title: `Pay ${a.label} on ${CHAIN_NAME[a.destination.chain]}`,
            intro:
              "Lets Aftercall pay this payee outside NEAR through NEAR Intents, within the same caps and your cap for other chains (0 until you set one in Agent wallet). A payment over a cap is refused, not held for your wallet, because the quote would expire.",
            rows: [{ label: "Payee", value: `${a.label} · ${a.account}` }, ...destinationRows(a.destination)],
            walletNote: note("set_payee_destination"),
            confirm: "Allow in wallet",
          }
        : {
            title: `Pay ${a.label} on NEAR only`,
            intro: "Aftercall will no longer pay this payee on another chain.",
            rows: [{ label: "Payee", value: `${a.label} · ${a.account}` }],
            walletNote: note("set_payee_destination"),
            confirm: "Turn off",
          };
    case "remove-payee":
      return { title: "Remove a payee", intro: "Aftercall won't be able to pay them any more.", rows: [{ label: "Payee", value: `${a.label} · ${a.account}` }], walletNote: note("remove_payee"), confirm: "Remove" };
    case "deposit":
      return {
        title: "Deposit USDC",
        intro: "Moves USDC from your account into your agent wallet, where Aftercall can pay it out within your caps.",
        rows: [{ label: "Amount", value: usdc(a.amount), mono: true }, { label: "From", value: r.owner, mono: true }],
        walletNote: `Your wallet will ask you to call ft_transfer_call on the USDC contract with 1 yoctoNEAR attached.`,
        confirm: "Deposit",
      };
    case "withdraw":
      return { title: "Withdraw USDC", intro: "Moves USDC from your agent wallet back to your account.", rows: [{ label: "Amount", value: usdc(a.amount), mono: true }, { label: "To", value: r.owner, mono: true }], walletNote: note("withdraw"), confirm: "Withdraw" };
    case "approve":
      return {
        title: "Approve a payment your agent wallet blocked",
        // Parked over the daily cap or over the per-payment cap: the intro is true for either.
        intro: "Aftercall's key can't pay this; only your wallet can. Approving pays it once over your caps, and it counts towards today's spending. Check every line, then sign.",
        rows: [
          { label: "Amount", value: usdc(a.amount), mono: true },
          { label: "To", value: a.context ? `${a.context.payeeName} · ${a.payee}` : a.payee },
          ...(a.context
            ? [
                { label: "From", value: a.context.meeting },
                a.context.proposedBy ? { label: "Proposed by", value: a.context.proposedBy } : { label: "Heard", value: `“${a.context.heard}”` },
                { label: "Left today", value: `${a.context.leftToday} USDC`, mono: true },
              ]
            : []),
        ],
        walletNote: note("approve_pending"),
        confirm: "Approve in wallet",
      };
    case "approve-escrow":
      return {
        title: "Hold a deal over your caps",
        intro:
          "The call agreed a payment that both sides confirm before it's paid. It's over your caps, so only your wallet can set the money aside. Approving moves it from your balance into escrow and counts towards today's spending; the payee then confirms, and it's paid when you release it.",
        rows: [
          { label: "Amount", value: usdc(a.amount), mono: true },
          { label: "For", value: a.payeeName ? `${a.payeeName} · ${a.payee}` : a.payee },
        ],
        walletNote: note("approve_escrow"),
        confirm: "Approve in wallet",
      };
    case "cancel-escrow":
      return {
        title: "Take back a deal held in escrow",
        intro:
          "The money goes back on your balance. You can do this before the payee confirms, or once 30 days have passed since they confirmed without it being released. In between, only they can give it back.",
        rows: [
          { label: "Amount", value: usdc(a.amount), mono: true },
          { label: "For", value: a.payeeName ? `${a.payeeName} · ${a.payee}` : a.payee },
        ],
        walletNote: note("cancel_escrow"),
        confirm: "Take back",
      };
    case "cancel":
      return { title: "Decline a blocked payment", intro: "Nothing is paid, and the storage it used comes back to you.", rows: [{ label: "Payment", value: `${usdc(a.amount)} to ${a.payee}` }], walletNote: note("cancel_pending"), confirm: "Decline" };
    case "pause":
      return {
        title: a.paused ? "Pause all payments" : "Resume payments",
        intro: a.paused ? "Aftercall won't be able to pay anyone until you resume." : "Aftercall can pay again, within your caps.",
        rows: [],
        walletNote: note("set_paused"),
        confirm: a.paused ? "Pause" : "Resume",
      };
  }
}

/** "a, b and c". */
function listText(parts: string[]): string {
  return parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function destinationRows(d: PayeeDestination) {
  return [
    { label: "Paid on", value: `${CHAIN_NAME[d.chain]}, through NEAR Intents` },
    { label: "Address", value: d.address, mono: true },
    { label: "Check", value: "Aftercall can't prove where NEAR Intents sends the money; it trusts the quote. Only add an address you got from the payee." },
  ];
}

// ---------- links ----------

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(s, (c) => c.charCodeAt(0)));
}

const ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
/** A NEAR account id (named or implicit), as the protocol allows it. */
export const isAccountId = (id: unknown): id is string => typeof id === "string" && ACCOUNT.test(id);
const DIGITS = /^\d{1,30}$/;

export function encodeSignRequest(r: SignRequest): string {
  return toBase64Url(JSON.stringify(r));
}

/** Parses and validates a request from a link. Anything unexpected is refused. */
export function decodeSignRequest(fragment: string): SignRequest {
  const r = JSON.parse(fromBase64Url(fragment.replace(/^#/, ""))) as SignRequest;
  if (!isNetwork(r.network)) throw new Error("BAD_NETWORK");
  if (!ACCOUNT.test(r.contract) || !ACCOUNT.test(r.owner)) throw new Error("BAD_ACCOUNT");
  const a = r.action as OwnerAction;
  const amounts = ["dailyCap", "perPaymentCap", "crossChainCap", "yoctoNear", "amount"] as const;
  for (const k of amounts) if (k in a && !DIGITS.test((a as Record<string, string>)[k])) throw new Error("BAD_AMOUNT");
  if ("account" in a && !ACCOUNT.test(a.account)) throw new Error("BAD_ACCOUNT");
  if ("payee" in a && !ACCOUNT.test(a.payee)) throw new Error("BAD_ACCOUNT");
  if ("destination" in a && a.destination != null) {
    const d = a.destination as PayeeDestination;
    if (!PAYOUT_CHAINS.includes(d.chain) || !isValidPayoutAddress(d.chain, d.address)) throw new Error("BAD_DESTINATION");
  }
  if ((a.kind === "authorise-key" || a.kind === "update-key" || (a.kind === "setup" && a.publicKey !== undefined)) && !/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.publicKey ?? "")) throw new Error("BAD_KEY");
  if ("escrowId" in a && (typeof a.escrowId !== "string" || !a.escrowId || a.escrowId.length > 64)) throw new Error("BAD_ACTION");
  if (a.kind === "setup" && (typeof a.register !== "boolean" || typeof a.registerUsdc !== "boolean")) throw new Error("BAD_ACTION");
  toTransactions(r); // throws on an unknown kind
  if (!describe(r)) throw new Error("BAD_ACTION");
  return r;
}

/**
 * `update-key` deletes a key before adding it back, so a crafted link could name another key:
 * the wallet's own full-access key, which would leave the owner locked out. Before signing,
 * /sign reads the key from NEAR and passes it here: it must be this Mac's kind of key, a
 * function-call key on this contract limited to the app's methods (the list from before
 * escrows, or today's). Returns what's wrong in plain words, or null when it may be updated.
 */
export function updateKeyProblem(permission: unknown, contract: string): string | null {
  if (permission === undefined || permission === null) return "That key isn't on your account, so there's nothing to update. Open the update again from the Aftercall app.";
  const fc = typeof permission === "object" ? (permission as { FunctionCall?: { receiver_id?: unknown; method_names?: unknown } }).FunctionCall : undefined;
  if (!fc) return "That key has full access to your account. Updating it would remove it, so Aftercall won't. Nothing was signed.";
  if (fc.receiver_id !== contract) return `That key isn't limited to ${contract}, so it isn't this Mac's key. Nothing was signed.`;
  const methods = Array.isArray(fc.method_names) ? fc.method_names.filter((m): m is string => typeof m === "string").sort() : [];
  const same = (list: readonly string[]) => methods.length === list.length && [...list].sort().every((m, i) => methods[i] === m);
  if (!same(OLD_APP_KEY_METHODS) && !same(APP_KEY_METHODS)) return "That key may call other methods than this Mac's key, so it isn't the one to update. Nothing was signed.";
  return null;
}

/** A key's permission on an account, read from NEAR at final finality, or null when the key isn't there. `fetchImpl` is swapped in tests. */
export async function readAccessKeyPermission(rpcUrl: string, account: string, publicKey: string, fetchImpl: typeof fetch = fetch): Promise<unknown | null> {
  const res = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "key", method: "query", params: { request_type: "view_access_key", finality: "final", account_id: account, public_key: publicKey } }),
  });
  const body = (await res.json()) as { error?: { cause?: { name?: string }; data?: unknown }; result?: { error?: string; permission?: unknown } };
  const missing = body.error?.cause?.name === "UNKNOWN_ACCESS_KEY" || /does not exist/i.test(body.result?.error ?? "");
  if (missing) return null;
  if (body.error || body.result?.error) throw new Error(body.result?.error ?? JSON.stringify(body.error));
  return body.result?.permission ?? null;
}
