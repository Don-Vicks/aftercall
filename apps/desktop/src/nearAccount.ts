import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "./recorder";

/**
 * A new NEAR testnet account, made inside Aftercall: a phrase for it (the standard wallet
 * path, m/44'/397'/0', so Meteor can import it), a check that the name is free, and the
 * call to NEAR's testnet helper that creates it. Rust holds none of it afterwards; the
 * interface keeps the phrase in component state only, until the words are checked.
 */

/** The new account's phrase and the public key a wallet will derive from it. Never stored. */
export interface NewWallet {
  phrase: string;
  publicKey: string;
}

export interface CreatedAccount {
  accountId: string;
  /** The helper's create_account transaction, when its reply named it. */
  txHash: string | null;
  /** yoctoNEAR, read back from NEAR once the account exists. */
  balance: string | null;
}

/** The browser preview has no Rust side: a fixed sample, so the screens can be looked at. */
const PREVIEW: NewWallet = {
  phrase: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  publicKey: "ed25519:6j4b6zUaty6fD1awqcGCCU9JYGCWYUgdJhQrzfZhqE25",
};
const macOnly = () => Promise.reject(new Error("Creating an account works in the Mac app, not the browser preview."));

export const nearAccount = {
  newWalletPhrase: () => (isDesktop ? invoke<NewWallet>("near_new_wallet_phrase") : Promise.resolve({ ...PREVIEW })),
  /** Read-only (view_account on testnet). Rejects with what's wrong with the name. */
  nameFree: (accountId: string) => (isDesktop ? invoke<boolean>("near_testnet_name_free", { accountId }) : macOnly()),
  /** Asks NEAR's testnet helper to create the account with this public key as its full-access key. */
  create: (accountId: string, publicKey: string) => (isDesktop ? invoke<CreatedAccount>("near_create_testnet_account", { accountId, publicKey }) : macOnly()),
};

/** Checked in a browser, 2 Nov 2026: Meteor's import route, which asks for a password first on a new browser. */
export const METEOR_URL = "https://wallet.meteorwallet.app";
export const METEOR_IMPORT_URL = "https://wallet.meteorwallet.app/add_wallet/import_wallet";
