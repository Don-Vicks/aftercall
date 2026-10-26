import { formatUsdc } from "../money.ts";
import { NETWORK_CONFIG, isNetwork, type Network } from "../network.ts";
import { CHAIN_NAME, isValidPayoutAddress, PAYOUT_CHAINS, type PayoutChain } from "../intents/oneclick.ts";

/**
 * Everything only the owner's own NEAR wallet may do with the agent wallet. The app
 * can't sign these (its key is limited to `pay` and `record_proof`), so it opens a
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
const TGAS = (n: number) => `${n}000000000000`;
/** NEAR in yocto, from a decimal string like "0.1". */
function near(amount: string): string {
  const [whole, frac = ""] = amount.split(".");
  return (BigInt(whole) * 10n ** 24n + BigInt((frac + "0".repeat(24)).slice(0, 24))).toString();
}

export type OwnerAction =
  | { kind: "register" }
  | { kind: "authorise-key"; publicKey: string }
  | { kind: "set-cap"; dailyCap: string }
  | { kind: "set-payment-cap"; perPaymentCap: string }
  | { kind: "add-payee"; account: string; label: string; registerWithUsdc: boolean; destination?: PayeeDestination }
  /** Opts a listed payee in to (or, with null, out of) payment on Solana or Base through NEAR Intents. */
  | { kind: "set-payee-destination"; account: string; label: string; destination: PayeeDestination | null }
  | { kind: "remove-payee"; account: string; label: string }
  | { kind: "deposit"; amount: string }
  | { kind: "withdraw"; amount: string }
  | { kind: "approve"; followupId: string; payee: string; amount: string; context?: PaymentContext }
  | { kind: "cancel"; followupId: string; payee: string; amount: string }
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
  )[];
}

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
      return [
        {
          receiverId: r.owner,
          actions: [
            {
              type: "AddKey",
              params: {
                publicKey: a.publicKey,
                accessKey: { permission: { receiverId: r.contract, allowance: near("0.25"), methodNames: ["pay", "record_proof"] } },
              },
            },
          ],
        },
      ];
    case "set-cap":
      return [call(r.contract, "set_cap", { daily_cap: a.dailyCap })];
    case "set-payment-cap":
      return [call(r.contract, "set_payment_cap", { per_payment_cap: a.perPaymentCap })];
    case "add-payee":
      return [
        // The payee must be able to hold USDC, or every payment to them would bounce.
        ...(a.registerWithUsdc ? [call(token, "storage_deposit", { account_id: a.account, registration_only: true }, "1250000000000000000000")] : []),
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
      return { title: "Create your agent wallet", intro: "A wallet on the Aftercall contract that only you control.", rows: [{ label: "Storage", value: "0.1 NEAR, kept as your storage credit" }], walletNote: note("register", "0.1 NEAR"), confirm: "Create wallet" };
    case "authorise-key":
      return {
        title: "Authorise this Mac",
        intro: "Adds Aftercall's key to your account, limited to two methods on one contract. It can never move funds outside your rules.",
        rows: [
          { label: "Key", value: a.publicKey, mono: true },
          { label: "May call", value: `pay and record_proof on ${r.contract}`, mono: true },
          { label: "Gas allowance", value: "0.25 NEAR" },
        ],
        walletNote: "Your wallet will ask you to add a limited access key to your account.",
        confirm: "Authorise",
      };
    case "set-cap":
      return { title: "Change your daily cap", intro: "The most Aftercall can pay in one day without your wallet.", rows: [{ label: "New daily cap", value: usdc(a.dailyCap), mono: true }], walletNote: note("set_cap"), confirm: "Set cap" };
    case "set-payment-cap":
      return {
        title: "Change your per-payment limit",
        intro: "The largest single payment Aftercall can send without your wallet. 0 turns the limit off.",
        rows: [{ label: "New limit", value: usdc(a.perPaymentCap), mono: true }],
        walletNote: note("set_payment_cap"),
        confirm: "Set limit",
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
            intro: "Lets Aftercall pay this payee outside NEAR through NEAR Intents, within the same caps.",
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
        intro: "Aftercall's key can't pay this; only your wallet can. Check every line, then sign.",
        rows: [
          { label: "Amount", value: usdc(a.amount), mono: true },
          { label: "To", value: a.context ? `${a.context.payeeName} · ${a.payee}` : a.payee },
          ...(a.context
            ? [
                { label: "From", value: a.context.meeting },
                { label: "Heard", value: `“${a.context.heard}”` },
                { label: "Cap today", value: `${a.context.leftToday} left; this goes past it once` },
              ]
            : []),
        ],
        walletNote: note("approve_pending"),
        confirm: "Approve in wallet",
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
  const amounts = ["dailyCap", "perPaymentCap", "amount"] as const;
  for (const k of amounts) if (k in a && !DIGITS.test((a as Record<string, string>)[k])) throw new Error("BAD_AMOUNT");
  if ("account" in a && !ACCOUNT.test(a.account)) throw new Error("BAD_ACCOUNT");
  if ("payee" in a && !ACCOUNT.test(a.payee)) throw new Error("BAD_ACCOUNT");
  if ("destination" in a && a.destination != null) {
    const d = a.destination as PayeeDestination;
    if (!PAYOUT_CHAINS.includes(d.chain) || !isValidPayoutAddress(d.chain, d.address)) throw new Error("BAD_DESTINATION");
  }
  if (a.kind === "authorise-key" && !/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.publicKey)) throw new Error("BAD_KEY");
  toTransactions(r); // throws on an unknown kind
  if (!describe(r)) throw new Error("BAD_ACTION");
  return r;
}
