//! Aftercall agent wallet.
//!
//! One shared contract holds each user's USDC with their own rules: a daily cap,
//! a per-payment cap, a cross-chain cap, a payee list and a pause switch. The
//! desktop app holds a function-call key that may only call `pay` and
//! `record_proof`. Every rule change needs exactly 1 yoctoNEAR, which a
//! function-call key cannot attach, so only the user's own wallet (a full-access
//! key) can make it.
//!
//! There is no admin method that can move user funds, and every user pays for
//! the storage their own records use, their wallet record included, from their
//! own storage credit. They can top the credit up and take back what's unused.
//!
//! Cross-chain payments (NEAR Intents 1Click): the owner may give a payee a
//! Solana or Base address with `set_payee_destination`. `pay` with a `cross_chain`
//! route then sends the USDC to a 1Click deposit address instead of the payee's
//! NEAR account, under the same caps and pause and under a separate cross-chain
//! daily cap, which is 0 (cross-chain off) until the owner sets it. The contract
//! cannot check that a deposit address really routes to the payee's address: that
//! promise comes from the 1Click quote, which the app fetched. The cross-chain cap
//! bounds what a stolen app key could send that way. See docs/near-intents-1click.md.

use near_sdk::json_types::{U128, U64};
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{
    assert_one_yocto, env, ext_contract, near, require, AccountId, BorshStorageKey, Gas,
    NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue,
};

const NANOS_PER_DAY: u64 = 86_400_000_000_000;
const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(15);
/// ft_transfer + callback, with room for the method itself: `pay`, `approve_pending`, `withdraw`.
const MIN_GAS_FOR_PAY: Gas = Gas::from_tgas(50);
/// 0.05 NEAR. It pays for the wallet record; the rest is the user's storage credit.
const MIN_REGISTRATION: NearToken = NearToken::from_millinear(50);
const MAX_PENDING: u32 = 20;
const MAX_PAYEES: usize = 50;
/// Longest memo `pay` accepts, in bytes. A parked payment stores it.
const MAX_MEMO: usize = 256;
/// Raw storage key for the public counters. Kept outside `AgentWallet` so adding
/// them doesn't change the contract's state layout; it can't clash with the
/// one-byte collection prefixes or near-sdk's `STATE` key.
const STATS_KEY: &[u8] = b"stats";

/// storage_deposit, then the callback that sends (ft_transfer + its callback).
const MIN_GAS_FOR_CROSS_CHAIN: Gas = Gas::from_tgas(70);
const GAS_FOR_STORAGE_DEPOSIT: Gas = Gas::from_tgas(10);
/// `on_deposit_address_registered`: its own work plus the ft_transfer and callback it schedules.
const GAS_FOR_REGISTERED_CALLBACK: Gas = Gas::from_tgas(35);
/// NEP-145 registration for a 1Click deposit address on the USDC contract, paid from
/// the owner's storage credit. If the registration fails, the NEAR comes back to this
/// contract and the fee goes back to the owner's credit. If the address was already
/// registered, the token returns it to this contract, not to the owner.
const DEPOSIT_ADDRESS_REGISTRATION: NearToken = NearToken::from_yoctonear(1_250_000_000_000_000_000_000);

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Wallets,
    Payees,
    Paid,
    Pending,
    Proofs,
    // Appended, so existing keys keep their prefixes. These maps are not fields of
    // the contract state, so the state layout of a deployed contract is unchanged.
    Destinations,
    CrossChainPayments,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Wallet {
    pub balance: U128,
    pub daily_cap: U128,
    pub spent_today: U128,
    /// Day number (UTC) that `spent_today` and `cross_chain_spent_today` belong to.
    pub day: u64,
    pub paused: bool,
    pub pending_count: u32,
    /// yoctoNEAR the user deposited for their own storage and hasn't used yet.
    pub storage_credit: U128,
    /// Largest single payment the limited key may send. 0 means no extra limit.
    pub per_payment_cap: U128,
    /// Most the limited key may send to other chains in a UTC day. Every cross-chain
    /// payment must fit this and the daily cap. 0 (the default) turns cross-chain off.
    pub cross_chain_daily_cap: U128,
    /// Cross-chain payments counted on `day`. They are in `spent_today` as well.
    pub cross_chain_spent_today: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Payment {
    pub payee: AccountId,
    pub amount: U128,
    pub memo: Option<String>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Proof {
    pub proof_hash: String,
    pub model: String,
    /// Block timestamp in nanoseconds, as a string in JSON (it is above 2^53).
    pub recorded_at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Payee {
    pub account: AccountId,
    pub label: String,
}

/// Public counts across every user. No accounts, amounts or meeting ids.
#[near(serializers = [borsh, json])]
#[derive(Clone, Default, Debug, PartialEq)]
pub struct Stats {
    /// Wallets registered.
    pub wallets: u64,
    /// Meeting proofs recorded.
    pub proofs: u64,
    /// Payments to payees sent and not refunded (withdrawals don't count).
    pub payments: u64,
    /// Payments parked over a cap for the owner's approval.
    pub parked: u64,
}

/// Where a payee is paid outside NEAR. Set only by the owner (1 yocto).
#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq, Debug)]
pub struct Destination {
    /// "solana" or "base".
    pub chain: String,
    /// A Solana address (base58, 32 to 44 characters) or a Base address (0x and 40 hex).
    pub address: String,
}

#[near(serializers = [json])]
pub struct PayeeDestination {
    pub payee: AccountId,
    pub chain: String,
    pub address: String,
}

/// The 1Click quote the app accepted for one cross-chain payment.
#[near(serializers = [json])]
pub struct CrossChainRoute {
    /// The quote's deposit address on NEAR: a 64-hex implicit account.
    pub deposit_address: AccountId,
    /// The quote's id (1Click `correlationId`), kept for disputes.
    pub quote_id: String,
}

/// What the contract recorded about a cross-chain payment.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct CrossChainPayment {
    pub payee: AccountId,
    pub amount: U128,
    pub chain: String,
    pub address: String,
    pub deposit_address: AccountId,
    pub quote_id: String,
    /// Block timestamp in nanoseconds, as a string in JSON.
    pub sent_at: U64,
}

#[near(serializers = [json])]
pub struct PayResult {
    /// "sending" (transfer started; the outcome lands in the callback) or "blocked".
    pub status: String,
    /// "OVER_PAYMENT_CAP", "OVER_CAP" or, for a cross-chain payment, "OVER_CROSS_CHAIN_CAP"
    /// when blocked. The first cap crossed in that order is named.
    pub reason: Option<String>,
    /// What is left of today's daily cap.
    pub left_today: U128,
    /// For a cross-chain payment: what is left of today's cross-chain cap.
    pub cross_chain_left_today: Option<U128>,
}

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
}

/// Owner and payee -> the payee's address outside NEAR.
fn destinations() -> LookupMap<(AccountId, AccountId), Destination> {
    LookupMap::new(StorageKey::Destinations)
}

/// Owner and follow-up id -> the cross-chain payment sent for it.
fn cross_chain_payments() -> LookupMap<(AccountId, String), CrossChainPayment> {
    LookupMap::new(StorageKey::CrossChainPayments)
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct AgentWallet {
    usdc: AccountId,
    wallets: LookupMap<AccountId, Wallet>,
    /// owner -> their payees (at most 50), so the app can list them.
    payees: LookupMap<AccountId, Vec<Payee>>,
    /// (owner, follow-up id) for every payment sent or in flight. Withdrawals never use it.
    paid: LookupSet<(AccountId, String)>,
    /// (owner, follow-up id) -> payment parked for the owner's approval.
    pending: LookupMap<(AccountId, String), Payment>,
    /// (owner, meeting id) -> proof
    proofs: LookupMap<(AccountId, String), Proof>,
}

#[near]
impl AgentWallet {
    /// Only the contract account itself can initialise it (the deploy transaction does).
    #[init]
    #[private]
    pub fn new(usdc: AccountId) -> Self {
        Self {
            usdc,
            wallets: LookupMap::new(StorageKey::Wallets),
            payees: LookupMap::new(StorageKey::Payees),
            paid: LookupSet::new(StorageKey::Paid),
            pending: LookupMap::new(StorageKey::Pending),
            proofs: LookupMap::new(StorageKey::Proofs),
        }
    }

    // ---------- registration, deposits and storage credit ----------

    /// Creates the caller's wallet. The attached NEAR pays for the wallet record, and
    /// the rest becomes their storage credit.
    #[payable]
    pub fn register(&mut self) {
        let owner = env::predecessor_account_id();
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit >= MIN_REGISTRATION.as_yoctonear(), "REGISTRATION_NEEDS_0.05_NEAR");
        require!(self.wallets.get(&owner).is_none(), "ALREADY_REGISTERED");
        bump(|s| s.wallets += 1);
        let before = env::storage_usage();
        self.wallets.insert(
            owner.clone(),
            Wallet {
                balance: U128(0),
                daily_cap: U128(0),
                spent_today: U128(0),
                day: today(),
                paused: false,
                pending_count: 0,
                storage_credit: U128(0),
                per_payment_cap: U128(0),
                cross_chain_daily_cap: U128(0),
                cross_chain_spent_today: U128(0),
            },
        );
        self.wallets.flush();
        // The record's size never changes after this (every field is fixed-size).
        let cost = env::storage_byte_cost().as_yoctonear() * u128::from(env::storage_usage() - before);
        require!(deposit >= cost, "REGISTRATION_TOO_SMALL");
        self.wallet_mut(&owner).storage_credit = U128(deposit - cost);
    }

    /// Adds the attached NEAR to the caller's own storage credit. A function-call key
    /// can't attach NEAR, so only the owner's wallet can top up.
    #[payable]
    pub fn add_storage_credit(&mut self) -> U128 {
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit > 0, "NEEDS_DEPOSIT");
        let w = self.wallet_mut(&env::predecessor_account_id());
        w.storage_credit = U128(w.storage_credit.0 + deposit);
        w.storage_credit
    }

    /// Sends unused storage credit back to the owner's account; `None` sends all of it.
    /// Storage already in use stays paid for, and freeing it later adds to the credit.
    #[payable]
    pub fn withdraw_storage_credit(&mut self, amount: Option<U128>) -> Promise {
        assert_one_yocto();
        let owner = env::predecessor_account_id();
        let w = self.wallet_mut(&owner);
        let amount = amount.map_or(w.storage_credit.0, |a| a.0);
        require!(amount > 0, "ZERO_AMOUNT");
        require!(amount <= w.storage_credit.0, "STORAGE_CREDIT_LOW");
        w.storage_credit = U128(w.storage_credit.0 - amount);
        Promise::new(owner).transfer(NearToken::from_yoctonear(amount))
    }

    /// NEP-141 receiver. Only the configured USDC contract may credit balances.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let _ = msg;
        require!(env::predecessor_account_id() == self.usdc, "ONLY_USDC");
        match self.wallets.get_mut(&sender_id) {
            Some(w) => {
                w.balance = U128(w.balance.0 + amount.0);
                PromiseOrValue::Value(U128(0))
            }
            // Not registered: hand every token back to the sender.
            None => PromiseOrValue::Value(amount),
        }
    }

    // ---------- owner only (full-access key, 1 yocto) ----------

    #[payable]
    pub fn set_cap(&mut self, daily_cap: U128) {
        assert_one_yocto();
        self.wallet_mut(&env::predecessor_account_id()).daily_cap = daily_cap;
    }

    /// Largest single payment the app may send without a wallet signature. 0 turns it off.
    #[payable]
    pub fn set_payment_cap(&mut self, per_payment_cap: U128) {
        assert_one_yocto();
        self.wallet_mut(&env::predecessor_account_id()).per_payment_cap = per_payment_cap;
    }

    /// Most the app may pay on other chains in a UTC day, inside the daily cap. 0 turns
    /// cross-chain payments off.
    #[payable]
    pub fn set_cross_chain_cap(&mut self, cross_chain_daily_cap: U128) {
        assert_one_yocto();
        self.wallet_mut(&env::predecessor_account_id()).cross_chain_daily_cap = cross_chain_daily_cap;
    }

    #[payable]
    pub fn set_paused(&mut self, paused: bool) {
        assert_one_yocto();
        self.wallet_mut(&env::predecessor_account_id()).paused = paused;
    }

    /// The payee must already be registered on the USDC contract (the app checks
    /// `storage_balance_of`); if not, a payment fails and is fully refunded.
    #[payable]
    pub fn add_payee(&mut self, payee: AccountId, label: String) {
        assert_one_yocto();
        let owner = env::predecessor_account_id();
        self.wallet_mut(&owner);
        require!(label.len() <= 64, "LABEL_TOO_LONG");
        self.with_storage(&owner, |this| {
            let list = this.payees.entry(owner.clone()).or_default();
            match list.iter_mut().find(|p| p.account == payee) {
                Some(existing) => existing.label = label,
                None => {
                    require!(list.len() < MAX_PAYEES, "TOO_MANY_PAYEES");
                    list.push(Payee { account: payee, label });
                }
            }
            this.payees.flush();
        });
    }

    #[payable]
    pub fn remove_payee(&mut self, payee: AccountId) {
        assert_one_yocto();
        let owner = env::predecessor_account_id();
        self.with_storage(&owner, |this| {
            if let Some(list) = this.payees.get_mut(&owner) {
                list.retain(|p| p.account != payee);
            }
            this.payees.flush();
            // A payee added again later starts without an address outside NEAR.
            let mut d = destinations();
            d.remove(&(owner.clone(), payee.clone()));
            d.flush();
        });
    }

    /// Opts a listed payee in to cross-chain payments: the app may then pay them on
    /// Solana or Base through NEAR Intents, within the same caps and the cross-chain
    /// cap. `None` opts them out.
    #[payable]
    pub fn set_payee_destination(&mut self, payee: AccountId, destination: Option<Destination>) {
        assert_one_yocto();
        let owner = env::predecessor_account_id();
        self.wallet_mut(&owner);
        require!(self.is_listed(&owner, &payee), "UNKNOWN_PAYEE");
        if let Some(d) = &destination {
            require!(valid_destination(d), "BAD_DESTINATION");
        }
        self.with_storage(&owner, |_| {
            let mut map = destinations();
            let key = (owner.clone(), payee);
            match destination {
                Some(d) => {
                    map.insert(key, d);
                }
                None => {
                    map.remove(&key);
                }
            }
            map.flush();
        });
    }

    #[payable]
    pub fn withdraw(&mut self, amount: U128) {
        assert_one_yocto();
        require!(env::prepaid_gas() >= MIN_GAS_FOR_PAY, "NEEDS_50_TGAS");
        require!(amount.0 > 0, "ZERO_AMOUNT");
        let owner = env::predecessor_account_id();
        let w = self.wallet_mut(&owner);
        require!(w.balance.0 >= amount.0, "LOW_BALANCE");
        w.balance = U128(w.balance.0 - amount.0);
        // Its own callback and no follow-up id, so a failed withdrawal can never touch a
        // payment's paid mark or cross-chain record.
        let _ = ext_ft::ext(self.usdc.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(owner.clone(), amount, None)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .on_withdraw_complete(owner, amount),
            );
    }

    /// Pays a payment that `pay` parked because it was over a cap.
    #[payable]
    pub fn approve_pending(&mut self, followup_id: String) {
        assert_one_yocto();
        require!(env::prepaid_gas() >= MIN_GAS_FOR_PAY, "NEEDS_50_TGAS");
        let owner = env::predecessor_account_id();
        let payment = self.take_pending(&owner, &followup_id);
        // The payee may have been removed since; the usual checks still apply, and the
        // balance must cover it now.
        self.check_payable(&owner, &payment.payee, &followup_id);
        let w = self.wallet_mut(&owner);
        require!(w.balance.0 >= payment.amount.0, "LOW_BALANCE");
        roll_day(w);
        w.balance = U128(w.balance.0 - payment.amount.0);
        // Approved over-cap payments still count towards today's spending.
        w.spent_today = U128(w.spent_today.0 + payment.amount.0);
        let day = w.day;
        self.mark_paid(&owner, &followup_id);
        bump(|s| s.payments += 1);
        self.transfer(owner, payment.payee, payment.amount, payment.memo, followup_id, day);
    }

    /// Declines a parked payment. Nothing is paid, and its storage goes back to the owner.
    #[payable]
    pub fn cancel_pending(&mut self, followup_id: String) {
        assert_one_yocto();
        let owner = env::predecessor_account_id();
        self.take_pending(&owner, &followup_id);
    }

    // ---------- limited key: pay and record_proof ----------

    /// Pays a listed payee within the caps, or parks the payment for the owner's approval.
    ///
    /// With `cross_chain`, the USDC goes to the 1Click deposit address instead, which
    /// pays the payee's Solana or Base address. Only payees the owner gave a destination
    /// qualify. Same caps and pause, plus the cross-chain cap; but an over-cap
    /// cross-chain payment is refused, not parked, because the quote behind it expires.
    pub fn pay(
        &mut self,
        payee: AccountId,
        amount: U128,
        memo: Option<String>,
        followup_id: String,
        cross_chain: Option<CrossChainRoute>,
    ) -> PayResult {
        require!(env::prepaid_gas() >= MIN_GAS_FOR_PAY, "NEEDS_50_TGAS");
        require!(amount.0 > 0, "ZERO_AMOUNT");
        require!(memo.as_ref().map_or(true, |m| m.len() <= MAX_MEMO), "MEMO_TOO_LONG");
        let owner = env::predecessor_account_id();
        self.check_payable(&owner, &payee, &followup_id);
        if let Some(route) = cross_chain {
            return self.pay_cross_chain(owner, payee, amount, memo, followup_id, route);
        }

        let w = self.wallet_mut(&owner);
        roll_day(w);
        let over_payment_cap = w.per_payment_cap.0 > 0 && amount.0 > w.per_payment_cap.0;
        let over_daily_cap = w.spent_today.0 + amount.0 > w.daily_cap.0;
        if over_payment_cap || over_daily_cap {
            require!(w.pending_count < MAX_PENDING, "TOO_MANY_PENDING");
            w.pending_count += 1;
            let reason = if over_payment_cap { "OVER_PAYMENT_CAP" } else { "OVER_CAP" };
            let left = U128(w.daily_cap.0.saturating_sub(w.spent_today.0));
            let key = (owner.clone(), followup_id);
            require!(self.pending.get(&key).is_none(), "ALREADY_PENDING");
            self.with_storage(&owner, |this| {
                this.pending.insert(key, Payment { payee, amount, memo });
                this.pending.flush();
            });
            bump(|s| s.parked += 1);
            return PayResult { status: "blocked".into(), reason: Some(reason.into()), left_today: left, cross_chain_left_today: None };
        }

        require!(w.balance.0 >= amount.0, "LOW_BALANCE");
        w.balance = U128(w.balance.0 - amount.0);
        w.spent_today = U128(w.spent_today.0 + amount.0);
        let left = U128(w.daily_cap.0 - w.spent_today.0);
        let day = w.day;
        self.mark_paid(&owner, &followup_id);
        bump(|s| s.payments += 1);
        self.transfer(owner, payee, amount, memo, followup_id, day);
        PayResult { status: "sending".into(), reason: None, left_today: left, cross_chain_left_today: None }
    }

    /// Records the hash of a meeting's proof bundle. A proof can never be overwritten.
    pub fn record_proof(&mut self, meeting_id: String, proof_hash: String, model: String) {
        let owner = env::predecessor_account_id();
        require!(meeting_id.len() <= 64 && proof_hash.len() <= 128 && model.len() <= 64, "TOO_LONG");
        let key = (owner.clone(), meeting_id);
        require!(self.proofs.get(&key).is_none(), "PROOF_EXISTS");
        let proof = Proof { proof_hash, model, recorded_at: U64(env::block_timestamp()) };
        self.with_storage(&owner, |this| {
            this.proofs.insert(key, proof);
            this.proofs.flush();
        });
        bump(|s| s.proofs += 1);
    }

    // ---------- callbacks ----------

    /// Runs after a payment's `ft_transfer`. On failure, undoes everything the payment
    /// did. `day` is the UTC day the payment was counted in: the refund lowers that
    /// day's spending only, never a later day's.
    #[private]
    pub fn on_pay_complete(
        &mut self,
        owner: AccountId,
        followup_id: String,
        amount: U128,
        day: u64,
        cross_chain: bool,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_ok() {
            return true;
        }
        self.refund_payment(&owner, &followup_id, amount, day, cross_chain, 0);
        false
    }

    /// Runs after `storage_deposit` registered a cross-chain payment's deposit address
    /// with USDC. Registered: sends the USDC. Not (the registration failed, and its NEAR
    /// came back to this contract): undoes the payment and returns the fee to the
    /// owner's storage credit.
    #[private]
    pub fn on_deposit_address_registered(
        &mut self,
        owner: AccountId,
        followup_id: String,
        amount: U128,
        day: u64,
        deposit_address: AccountId,
        memo: Option<String>,
    ) -> PromiseOrValue<bool> {
        // Only whether storage_deposit succeeded matters. Its return value is never read
        // or parsed, so no reply from the token can make this callback panic.
        let registered = !matches!(env::promise_result_checked(0, 0), Err(PromiseError::Failed));
        if !registered {
            self.refund_payment(&owner, &followup_id, amount, day, true, DEPOSIT_ADDRESS_REGISTRATION.as_yoctonear());
            return PromiseOrValue::Value(false);
        }
        PromiseOrValue::Promise(
            ext_ft::ext(self.usdc.clone())
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(GAS_FOR_FT_TRANSFER)
                .ft_transfer(deposit_address, amount, memo)
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(GAS_FOR_CALLBACK)
                        .on_pay_complete(owner, followup_id, amount, day, true),
                ),
        )
    }

    /// Runs after a withdrawal's `ft_transfer`. On failure, the USDC goes back on the balance.
    #[private]
    pub fn on_withdraw_complete(
        &mut self,
        owner: AccountId,
        amount: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_ok() {
            return true;
        }
        if let Some(w) = self.wallets.get_mut(&owner) {
            w.balance = U128(w.balance.0 + amount.0);
        }
        env::log_str(&format!("WITHDRAW_FAILED owner={owner} refunded={}", amount.0));
        false
    }

    // ---------- views ----------

    pub fn get_wallet(&self, owner: AccountId) -> Option<Wallet> {
        self.wallets.get(&owner).cloned()
    }

    pub fn get_payee_label(&self, owner: AccountId, payee: AccountId) -> Option<String> {
        self.payees.get(&owner)?.iter().find(|p| p.account == payee).map(|p| p.label.clone())
    }

    pub fn get_payees(&self, owner: AccountId) -> Vec<Payee> {
        self.payees.get(&owner).cloned().unwrap_or_default()
    }

    pub fn is_paid(&self, owner: AccountId, followup_id: String) -> bool {
        self.paid.contains(&(owner, followup_id))
    }

    pub fn get_pending(&self, owner: AccountId, followup_id: String) -> Option<Payment> {
        self.pending.get(&(owner, followup_id)).cloned()
    }

    pub fn get_proof(&self, owner: AccountId, meeting_id: String) -> Option<Proof> {
        self.proofs.get(&(owner, meeting_id)).cloned()
    }

    pub fn get_usdc(&self) -> AccountId {
        self.usdc.clone()
    }

    /// Counts only, for Aftercall's public stats page.
    pub fn get_stats(&self) -> Stats {
        read_stats()
    }

    /// Every listed payee who may be paid outside NEAR, with where.
    pub fn get_payee_destinations(&self, owner: AccountId) -> Vec<PayeeDestination> {
        let map = destinations();
        self.payees
            .get(&owner)
            .map(|list| {
                list.iter()
                    .filter_map(|p| {
                        map.get(&(owner.clone(), p.account.clone()))
                            .map(|d| PayeeDestination { payee: p.account.clone(), chain: d.chain.clone(), address: d.address.clone() })
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn get_cross_chain_payment(&self, owner: AccountId, followup_id: String) -> Option<CrossChainPayment> {
        cross_chain_payments().get(&(owner, followup_id)).cloned()
    }
}

impl AgentWallet {
    fn wallet_mut(&mut self, owner: &AccountId) -> &mut Wallet {
        self.wallets.get_mut(owner).unwrap_or_else(|| env::panic_str("NOT_REGISTERED"))
    }

    fn is_listed(&self, owner: &AccountId, payee: &AccountId) -> bool {
        self.payees.get(owner).is_some_and(|list| list.iter().any(|p| &p.account == payee))
    }

    /// The cross-chain half of `pay`, after the usual checks passed.
    fn pay_cross_chain(
        &mut self,
        owner: AccountId,
        payee: AccountId,
        amount: U128,
        memo: Option<String>,
        followup_id: String,
        route: CrossChainRoute,
    ) -> PayResult {
        require!(env::prepaid_gas() >= MIN_GAS_FOR_CROSS_CHAIN, "NEEDS_70_TGAS");
        require!(is_deposit_address(&route.deposit_address), "BAD_DEPOSIT_ADDRESS");
        require!(!route.quote_id.is_empty() && route.quote_id.len() <= 64, "BAD_QUOTE_ID");
        let destination = destinations()
            .get(&(owner.clone(), payee.clone()))
            .cloned()
            .unwrap_or_else(|| env::panic_str("NO_DESTINATION"));

        let w = self.wallet_mut(&owner);
        roll_day(w);
        let over_payment_cap = w.per_payment_cap.0 > 0 && amount.0 > w.per_payment_cap.0;
        let over_daily_cap = w.spent_today.0 + amount.0 > w.daily_cap.0;
        let over_cross_chain_cap = w.cross_chain_spent_today.0 + amount.0 > w.cross_chain_daily_cap.0;
        if over_payment_cap || over_daily_cap || over_cross_chain_cap {
            let reason = if over_payment_cap {
                "OVER_PAYMENT_CAP"
            } else if over_daily_cap {
                "OVER_CAP"
            } else {
                "OVER_CROSS_CHAIN_CAP"
            };
            let left = U128(w.daily_cap.0.saturating_sub(w.spent_today.0));
            let cross_left = U128(w.cross_chain_daily_cap.0.saturating_sub(w.cross_chain_spent_today.0));
            return PayResult { status: "blocked".into(), reason: Some(reason.into()), left_today: left, cross_chain_left_today: Some(cross_left) };
        }
        require!(w.balance.0 >= amount.0, "LOW_BALANCE");
        // Registering the deposit address with USDC comes out of the owner's storage credit.
        let fee = DEPOSIT_ADDRESS_REGISTRATION.as_yoctonear();
        require!(w.storage_credit.0 >= fee, "STORAGE_CREDIT_LOW");
        w.storage_credit = U128(w.storage_credit.0 - fee);
        w.balance = U128(w.balance.0 - amount.0);
        w.spent_today = U128(w.spent_today.0 + amount.0);
        w.cross_chain_spent_today = U128(w.cross_chain_spent_today.0 + amount.0);
        let left = U128(w.daily_cap.0 - w.spent_today.0);
        let cross_left = U128(w.cross_chain_daily_cap.0 - w.cross_chain_spent_today.0);
        let day = w.day;

        let record = CrossChainPayment {
            payee,
            amount,
            chain: destination.chain,
            address: destination.address,
            deposit_address: route.deposit_address.clone(),
            quote_id: route.quote_id,
            sent_at: U64(env::block_timestamp()),
        };
        let key = (owner.clone(), followup_id.clone());
        self.with_storage(&owner, |this| {
            let mut map = cross_chain_payments();
            map.insert(key.clone(), record);
            map.flush();
            this.paid.insert(key);
        });
        bump(|s| s.payments += 1);
        env::log_str(&format!("CROSS_CHAIN_PAY owner={owner} followup_id={followup_id} deposit_address={}", route.deposit_address));

        let _ = ext_ft::ext(self.usdc.clone())
            .with_attached_deposit(DEPOSIT_ADDRESS_REGISTRATION)
            .with_static_gas(GAS_FOR_STORAGE_DEPOSIT)
            .storage_deposit(Some(route.deposit_address.clone()), Some(true))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_REGISTERED_CALLBACK)
                    .on_deposit_address_registered(owner, followup_id, amount, day, route.deposit_address, memo),
            );
        PayResult { status: "sending".into(), reason: None, left_today: left, cross_chain_left_today: Some(cross_left) }
    }

    fn check_payable(&mut self, owner: &AccountId, payee: &AccountId, followup_id: &str) {
        require!(followup_id.len() <= 64, "FOLLOWUP_ID_TOO_LONG");
        require!(!self.paid.contains(&(owner.clone(), followup_id.to_string())), "ALREADY_PAID");
        require!(self.is_listed(owner, payee), "UNKNOWN_PAYEE");
        // The balance is checked where money moves (pay under the caps, approve_pending), so a
        // payment over a cap is parked for the owner even when the wallet can't cover it yet.
        require!(!self.wallet_mut(owner).paused, "PAUSED");
    }

    /// Marks a follow-up paid. The entry's storage is charged to the owner's credit.
    fn mark_paid(&mut self, owner: &AccountId, followup_id: &str) {
        let key = (owner.clone(), followup_id.to_string());
        self.with_storage(owner, |this| {
            this.paid.insert(key);
        });
    }

    /// Undoes a payment that didn't reach its receiver: the balance comes back, and the
    /// spending if it's still the day the payment was counted in; the follow-up can be
    /// paid again; the storage of its paid mark and cross-chain record goes back to the
    /// owner's credit, with `fee` (a registration fee that wasn't spent). Can't panic.
    fn refund_payment(&mut self, owner: &AccountId, followup_id: &str, amount: U128, day: u64, cross_chain: bool, fee: u128) {
        let Some(w) = self.wallets.get_mut(owner) else {
            // Wallets are never deleted, so this can't happen; nothing to give back to.
            return;
        };
        w.balance = U128(w.balance.0 + amount.0);
        if w.day == day {
            w.spent_today = U128(w.spent_today.0.saturating_sub(amount.0));
            if cross_chain {
                w.cross_chain_spent_today = U128(w.cross_chain_spent_today.0.saturating_sub(amount.0));
            }
        }
        w.storage_credit = U128(w.storage_credit.0 + fee);
        // A refunded payment was never made.
        bump(|s| s.payments = s.payments.saturating_sub(1));
        let key = (owner.clone(), followup_id.to_string());
        // Only frees bytes, so it credits the owner and never hits STORAGE_CREDIT_LOW.
        self.with_storage(owner, |this| {
            this.paid.remove(&key);
            if cross_chain {
                let mut map = cross_chain_payments();
                map.remove(&key);
                map.flush();
            }
        });
        env::log_str(&format!("PAYMENT_FAILED owner={owner} followup_id={followup_id} refunded={}", amount.0));
    }

    /// Removes a parked payment and returns its storage to the owner.
    fn take_pending(&mut self, owner: &AccountId, followup_id: &str) -> Payment {
        let key = (owner.clone(), followup_id.to_string());
        let payment = self.pending.get(&key).cloned().unwrap_or_else(|| env::panic_str("NO_SUCH_PENDING"));
        self.with_storage(owner, |this| {
            this.pending.remove(&key);
            this.pending.flush();
        });
        let w = self.wallet_mut(owner);
        w.pending_count -= 1;
        payment
    }

    /// Runs `write` and settles the storage it changed against the owner's credit:
    /// bytes added are charged, bytes freed are credited back.
    fn with_storage(&mut self, owner: &AccountId, write: impl FnOnce(&mut Self)) {
        let before = env::storage_usage();
        write(self);
        let after = env::storage_usage();
        let byte_cost = env::storage_byte_cost().as_yoctonear();
        let w = self.wallet_mut(owner);
        if after > before {
            let cost = byte_cost * u128::from(after - before);
            require!(w.storage_credit.0 >= cost, "STORAGE_CREDIT_LOW");
            w.storage_credit = U128(w.storage_credit.0 - cost);
        } else {
            w.storage_credit = U128(w.storage_credit.0 + byte_cost * u128::from(before - after));
        }
    }

    /// Sends a payment to a NEAR account (`pay` under the caps, `approve_pending`).
    fn transfer(&mut self, owner: AccountId, receiver: AccountId, amount: U128, memo: Option<String>, followup_id: String, day: u64) {
        // Dropping the promise schedules it; callers return their own values.
        let _ = ext_ft::ext(self.usdc.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(receiver, amount, memo)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .on_pay_complete(owner, followup_id, amount, day, false),
            );
    }
}

fn read_stats() -> Stats {
    env::storage_read(STATS_KEY)
        .map(|bytes| near_sdk::borsh::from_slice(&bytes).unwrap_or_else(|_| env::panic_str("BAD_STATS")))
        .unwrap_or_default()
}

/// Updates the public counters. Their few bytes are paid by the contract, not a user.
fn bump(change: impl FnOnce(&mut Stats)) {
    let mut stats = read_stats();
    change(&mut stats);
    env::storage_write(STATS_KEY, &near_sdk::borsh::to_vec(&stats).unwrap_or_else(|_| env::panic_str("BAD_STATS")));
}

/// 1Click deposit addresses on NEAR are implicit accounts: 64 lowercase hex characters.
/// Anything else (a named account, an EVM-style 0x address) is refused.
fn is_deposit_address(id: &AccountId) -> bool {
    let s = id.as_str();
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn valid_destination(d: &Destination) -> bool {
    let a = d.address.as_str();
    match d.chain.as_str() {
        "solana" => (32..=44).contains(&a.len()) && a.bytes().all(|b| b.is_ascii_alphanumeric() && !b"0OIl".contains(&b)),
        "base" => a.len() == 42 && a.starts_with("0x") && a[2..].bytes().all(|b| b.is_ascii_hexdigit()),
        _ => false,
    }
}

fn today() -> u64 {
    env::block_timestamp() / NANOS_PER_DAY
}

/// Starts a fresh day's spending when the UTC day has changed.
fn roll_day(w: &mut Wallet) {
    if w.day != today() {
        w.day = today();
        w.spent_today = U128(0);
        w.cross_chain_spent_today = U128(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const USDC: u128 = 1_000_000;

    fn ctx(predecessor: AccountId, deposit: NearToken, day: u64) -> near_sdk::VMContext {
        VMContextBuilder::new()
            .predecessor_account_id(predecessor)
            .attached_deposit(deposit)
            .block_timestamp(day * NANOS_PER_DAY + 1)
            .prepaid_gas(Gas::from_tgas(100))
            .build()
    }

    /// A registered owner with a 200 USDC cap, one payee and 1,000 USDC, on `day`.
    fn funded(day: u64) -> (AgentWallet, AccountId, AccountId) {
        let (usdc, owner, payee) = (accounts(0), accounts(1), accounts(2));
        testing_env!(ctx(owner.clone(), NearToken::from_millinear(100), day));
        let mut c = AgentWallet::new(usdc.clone());
        c.register();
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(1), day));
        c.set_cap(U128(200 * USDC));
        c.add_payee(payee.clone(), "Designer".into());
        testing_env!(ctx(usdc, NearToken::from_yoctonear(0), day));
        let _ = c.ft_on_transfer(owner.clone(), U128(1_000 * USDC), String::new());
        (c, owner, payee)
    }

    #[test]
    fn daily_cap_resets_next_day() {
        let (mut c, owner, payee) = funded(10);
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        assert_eq!(c.pay(payee.clone(), U128(150 * USDC), None, "a".into(), None).status, "sending");
        assert_eq!(c.pay(payee.clone(), U128(100 * USDC), None, "b".into(), None).status, "blocked");

        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 11));
        assert_eq!(c.pay(payee, U128(100 * USDC), None, "c".into(), None).status, "sending");
        assert_eq!(c.get_wallet(owner).unwrap().spent_today.0, 100 * USDC);
    }

    #[test]
    fn approval_on_a_new_day_counts_towards_that_day() {
        let (mut c, owner, payee) = funded(10);
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        c.pay(payee.clone(), U128(150 * USDC), None, "a".into(), None);
        assert_eq!(c.pay(payee.clone(), U128(500 * USDC), None, "big".into(), None).status, "blocked");

        // Approved the next day: yesterday's 150 no longer counts, today's 500 does.
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(1), 11));
        c.approve_pending("big".into());
        assert_eq!(c.get_wallet(owner.clone()).unwrap().spent_today.0, 500 * USDC);

        // So a small payment the same day is over the cap, not silently allowed.
        testing_env!(ctx(owner, NearToken::from_yoctonear(0), 11));
        assert_eq!(c.pay(payee, U128(10 * USDC), None, "c".into(), None).status, "blocked");
    }

    #[test]
    fn over_cap_parks_even_when_the_balance_cant_cover_it() {
        let (mut c, owner, payee) = funded(10);
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        // 5,000 is over the 200 cap and more than the 1,000 held: parked for the owner, not refused.
        let r = c.pay(payee.clone(), U128(5_000 * USDC), None, "big".into(), None);
        assert_eq!((r.status.as_str(), r.reason.as_deref()), ("blocked", Some("OVER_CAP")));
        assert_eq!(c.get_wallet(owner.clone()).unwrap().balance.0, 1_000 * USDC);
        // Under the caps, the balance still decides.
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(1), 10));
        c.set_cap(U128(10_000 * USDC));
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        let low = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.pay(payee.clone(), U128(1_001 * USDC), None, "low".into(), None)));
        let Err(why) = low else { panic!("paid more than the balance") };
        let why = why.downcast_ref::<String>().cloned().or_else(|| why.downcast_ref::<&str>().map(|x| x.to_string())).unwrap_or_default();
        assert!(why.contains("LOW_BALANCE"), "{why}");
    }

    #[test]
    #[should_panic(expected = "LOW_BALANCE")]
    fn approving_a_parked_payment_needs_the_balance() {
        let (mut c, owner, payee) = funded(10);
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        c.pay(payee, U128(5_000 * USDC), None, "big".into(), None);
        testing_env!(ctx(owner, NearToken::from_yoctonear(1), 10));
        c.approve_pending("big".into());
    }

    #[test]
    fn cancelled_pending_returns_its_storage() {
        let (mut c, owner, payee) = funded(10);
        let credit_before = c.get_wallet(owner.clone()).unwrap().storage_credit.0;
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        c.pay(payee, U128(500 * USDC), None, "big".into(), None);
        assert!(c.get_wallet(owner.clone()).unwrap().storage_credit.0 < credit_before);

        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(1), 10));
        c.cancel_pending("big".into());
        let w = c.get_wallet(owner.clone()).unwrap();
        assert_eq!(w.storage_credit.0, credit_before);
        assert_eq!(w.pending_count, 0);
        assert_eq!(w.balance.0, 1_000 * USDC);
        assert!(c.get_pending(owner, "big".into()).is_none());
    }

    #[test]
    fn payees_are_listed_relabelled_and_removed() {
        let (mut c, owner, payee) = funded(10);
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(1), 10));
        c.add_payee(accounts(3), "Legal review".into());
        c.add_payee(payee.clone(), "Designer, deck".into());
        let list = c.get_payees(owner.clone());
        assert_eq!(list.iter().map(|p| p.label.as_str()).collect::<Vec<_>>(), ["Designer, deck", "Legal review"]);
        c.remove_payee(payee.clone());
        assert_eq!(c.get_payees(owner.clone()).len(), 1);
        assert_eq!(c.get_payee_label(owner, payee), None);
    }

    const DEPOSIT: &str = "69f5eccee1e146961b47ac7cecb0f5caada2b6e1ee124e72e8b47adedd701f74";
    const SOL: &str = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

    fn route() -> Option<CrossChainRoute> {
        Some(CrossChainRoute { deposit_address: DEPOSIT.parse().unwrap(), quote_id: "ecb38db7-2b32-450a-8ef2-0efc83ec6ea7".into() })
    }

    /// `funded`, with the payee opted in to Solana payouts and cross-chain off (the default cap of 0).
    fn opted_in(day: u64) -> (AgentWallet, AccountId, AccountId) {
        let (mut c, owner, payee) = funded(day);
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(1), day));
        c.set_payee_destination(payee.clone(), Some(Destination { chain: "solana".into(), address: SOL.into() }));
        (c, owner, payee)
    }

    /// `opted_in`, with a cross-chain cap as big as the 200 USDC daily cap.
    fn funded_cross_chain(day: u64) -> (AgentWallet, AccountId, AccountId) {
        let (mut c, owner, payee) = opted_in(day);
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(1), day));
        c.set_cross_chain_cap(U128(200 * USDC));
        (c, owner, payee)
    }

    #[test]
    fn cross_chain_pay_counts_to_the_cap_and_is_recorded() {
        let (mut c, owner, payee) = funded_cross_chain(10);
        let credit_before = c.get_wallet(owner.clone()).unwrap().storage_credit.0;
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        let r = c.pay(payee.clone(), U128(150 * USDC), None, "x-1".into(), route());
        assert_eq!(r.status, "sending");
        assert_eq!(r.left_today.0, 50 * USDC);
        let w = c.get_wallet(owner.clone()).unwrap();
        assert_eq!(w.balance.0, 850 * USDC);
        assert_eq!(w.spent_today.0, 150 * USDC);
        assert!(w.storage_credit.0 <= credit_before - DEPOSIT_ADDRESS_REGISTRATION.as_yoctonear());
        let rec = c.get_cross_chain_payment(owner.clone(), "x-1".into()).unwrap();
        assert_eq!((rec.payee, rec.chain.as_str(), rec.address.as_str(), rec.deposit_address.as_str()), (payee.clone(), "solana", SOL, DEPOSIT));
        assert_eq!(rec.quote_id, "ecb38db7-2b32-450a-8ef2-0efc83ec6ea7");
        assert!(c.is_paid(owner.clone(), "x-1".into()));

        // Over what is left today: refused, nothing parked, nothing moved.
        let blocked = c.pay(payee, U128(60 * USDC), None, "x-2".into(), route());
        assert_eq!((blocked.status.as_str(), blocked.reason.as_deref()), ("blocked", Some("OVER_CAP")));
        assert!(c.get_pending(owner.clone(), "x-2".into()).is_none());
        assert_eq!(c.get_wallet(owner.clone()).unwrap().pending_count, 0);
        assert_eq!(c.get_wallet(owner).unwrap().balance.0, 850 * USDC);
    }

    #[test]
    fn cross_chain_respects_the_per_payment_cap() {
        let (mut c, owner, payee) = funded_cross_chain(10);
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(1), 10));
        c.set_payment_cap(U128(20 * USDC));
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        let r = c.pay(payee, U128(21 * USDC), None, "x".into(), route());
        assert_eq!(r.reason.as_deref(), Some("OVER_PAYMENT_CAP"));
        assert_eq!(c.get_wallet(owner).unwrap().balance.0, 1_000 * USDC);
    }

    #[test]
    #[should_panic(expected = "NO_DESTINATION")]
    fn cross_chain_needs_the_owner_opt_in() {
        let (mut c, owner, payee) = funded(10);
        testing_env!(ctx(owner, NearToken::from_yoctonear(0), 10));
        c.pay(payee, U128(USDC), None, "x".into(), route());
    }

    #[test]
    #[should_panic(expected = "UNKNOWN_PAYEE")]
    fn cross_chain_refuses_unlisted_payees() {
        let (mut c, owner, _) = funded_cross_chain(10);
        testing_env!(ctx(owner, NearToken::from_yoctonear(0), 10));
        c.pay(accounts(4), U128(USDC), None, "x".into(), route());
    }

    #[test]
    #[should_panic(expected = "PAUSED")]
    fn cross_chain_respects_pause() {
        let (mut c, owner, payee) = funded_cross_chain(10);
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(1), 10));
        c.set_paused(true);
        testing_env!(ctx(owner, NearToken::from_yoctonear(0), 10));
        c.pay(payee, U128(USDC), None, "x".into(), route());
    }

    #[test]
    #[should_panic(expected = "BAD_DEPOSIT_ADDRESS")]
    fn cross_chain_only_sends_to_implicit_deposit_addresses() {
        let (mut c, owner, payee) = funded_cross_chain(10);
        testing_env!(ctx(owner, NearToken::from_yoctonear(0), 10));
        c.pay(payee, U128(USDC), None, "x".into(), Some(CrossChainRoute { deposit_address: "attacker.near".parse().unwrap(), quote_id: "q".into() }));
    }

    #[test]
    fn destinations_are_validated_listed_and_cleared_with_the_payee() {
        let (mut c, owner, payee) = funded_cross_chain(10);
        let ok = |chain: &str, address: &str| valid_destination(&Destination { chain: chain.into(), address: address.into() });
        assert!(ok("base", "0x2527D02599Ba641c19FEa793cD0F167589a0f10D"));
        assert!(!ok("base", "0x2527D02599Ba641c19FEa793cD0F167589a0f10"));
        assert!(!ok("solana", "0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl"));
        assert!(!ok("eth", "0x2527D02599Ba641c19FEa793cD0F167589a0f10D"));
        assert_eq!(c.get_payee_destinations(owner.clone()).len(), 1);

        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(1), 10));
        c.remove_payee(payee.clone());
        c.add_payee(payee, "Designer".into());
        assert!(c.get_payee_destinations(owner).is_empty(), "re-adding a payee must not bring back an old address");
    }

    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn only_the_owner_wallet_sets_destinations() {
        let (mut c, owner, payee) = funded(10);
        testing_env!(ctx(owner, NearToken::from_yoctonear(0), 10));
        c.set_payee_destination(payee, Some(Destination { chain: "solana".into(), address: SOL.into() }));
    }

    #[test]
    fn stats_count_wallets_proofs_payments_and_parked() {
        let (mut c, owner, payee) = funded(10);
        assert_eq!(c.get_stats(), Stats { wallets: 1, ..Stats::default() });
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        c.pay(payee.clone(), U128(50 * USDC), None, "a".into(), None);
        c.pay(payee.clone(), U128(500 * USDC), None, "big".into(), None);
        c.record_proof("m-1".into(), "ab".repeat(32), "Qwen/Qwen3.8-27B".into());
        assert_eq!(c.get_stats(), Stats { wallets: 1, proofs: 1, payments: 1, parked: 1 });

        // Approving the parked payment makes it a payment; a withdrawal is not one.
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(1), 10));
        c.approve_pending("big".into());
        c.withdraw(U128(10 * USDC));
        assert_eq!(c.get_stats().payments, 2);

        // A refunded payment is taken back off the count.
        let mut cb = ctx(owner.clone(), NearToken::from_yoctonear(0), 10);
        cb.predecessor_account_id = cb.current_account_id.clone();
        testing_env!(cb);
        assert!(!c.on_pay_complete(owner.clone(), "a".into(), U128(50 * USDC), 10, false, Err(PromiseError::Failed)));
        assert!(c.on_pay_complete(owner, "big".into(), U128(500 * USDC), 10, false, Ok(())));
        assert_eq!(c.get_stats().payments, 1);
    }

    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn cancel_needs_the_owner_wallet() {
        let (mut c, owner, payee) = funded(10);
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        c.pay(payee, U128(500 * USDC), None, "big".into(), None);
        c.cancel_pending("big".into());
    }

    // ---------- audit regressions (CONTRACT-AUDIT.md, 3 Nov 2026) ----------
    // Each test asserts the fixed behaviour; the audit's PoC for the same finding showed the opposite.

    use near_sdk::mock::MockAction;
    use near_sdk::test_utils::get_created_receipts;
    use near_sdk::{PromiseResult, RuntimeFeesConfig};

    /// A callback's context: called by the contract itself, on `day`.
    fn cb_ctx(day: u64) -> near_sdk::VMContext {
        let mut cb = ctx(accounts(1), NearToken::from_yoctonear(0), day);
        cb.predecessor_account_id = cb.current_account_id.clone();
        cb
    }

    /// `cb_ctx` with the result of the promise the callback waited on.
    fn cb_with(day: u64, result: PromiseResult) {
        testing_env!(cb_ctx(day), near_sdk::test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![result]);
    }

    fn panic_text(f: impl FnOnce()) -> String {
        let Err(why) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) else { return String::new() };
        why.downcast_ref::<String>().cloned().or_else(|| why.downcast_ref::<&str>().map(|x| x.to_string())).unwrap_or_default()
    }

    fn credit(c: &AgentWallet, owner: &AccountId) -> u128 {
        c.get_wallet(owner.clone()).unwrap().storage_credit.0
    }

    fn byte_cost() -> u128 {
        env::storage_byte_cost().as_yoctonear()
    }

    /// H-1 (PoC `poc_stolen_key_cross_chain_to_any_hex_account`): a stolen app key used to send
    /// the whole daily cap to its own 64-hex account. Cross-chain is now off until the owner
    /// sets a cross-chain cap, and every cross-chain payment must fit it.
    #[test]
    fn stolen_key_cross_chain_is_bounded_by_the_cross_chain_cap() {
        let (mut c, owner, payee) = opted_in(10);
        assert_eq!(c.get_wallet(owner.clone()).unwrap().cross_chain_daily_cap.0, 0);
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        let attacker = || Some(CrossChainRoute { deposit_address: "a".repeat(64).parse().unwrap(), quote_id: "x".into() });
        let r = c.pay(payee.clone(), U128(200 * USDC), None, "steal".into(), attacker());
        assert_eq!((r.status.as_str(), r.reason.as_deref()), ("blocked", Some("OVER_CROSS_CHAIN_CAP")));
        assert_eq!(r.cross_chain_left_today.unwrap().0, 0);
        assert_eq!(c.get_wallet(owner.clone()).unwrap().balance.0, 1_000 * USDC);
        assert!(!c.is_paid(owner.clone(), "steal".into()));
        assert!(c.get_pending(owner.clone(), "steal".into()).is_none(), "refused, not parked");

        // A small cross-chain cap bounds the loss, while the daily cap still serves NEAR payments.
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(1), 10));
        c.set_cross_chain_cap(U128(20 * USDC));
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        let r = c.pay(payee.clone(), U128(20 * USDC), None, "x-1".into(), attacker());
        assert_eq!((r.status.as_str(), r.left_today.0, r.cross_chain_left_today.unwrap().0), ("sending", 180 * USDC, 0));
        // A fresh context per call: the mocked chain counts the gas the promises reserve.
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        let r = c.pay(payee.clone(), U128(1), None, "x-2".into(), attacker());
        assert_eq!(r.reason.as_deref(), Some("OVER_CROSS_CHAIN_CAP"));
        let w = c.get_wallet(owner.clone()).unwrap();
        assert_eq!((w.balance.0, w.spent_today.0, w.cross_chain_spent_today.0), (980 * USDC, 20 * USDC, 20 * USDC));
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        assert_eq!(c.pay(payee, U128(180 * USDC), None, "n-1".into(), None).status, "sending");
    }

    #[test]
    fn cross_chain_must_fit_the_daily_cap_too_and_resets_each_day() {
        let (mut c, owner, payee) = opted_in(10);
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(1), 10));
        c.set_cross_chain_cap(U128(500 * USDC));
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        // Under the cross-chain cap but over the 200 daily cap.
        assert_eq!(c.pay(payee.clone(), U128(250 * USDC), None, "x-1".into(), route()).reason.as_deref(), Some("OVER_CAP"));
        assert_eq!(c.pay(payee.clone(), U128(150 * USDC), None, "x-2".into(), route()).status, "sending");
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 11));
        assert_eq!(c.pay(payee, U128(200 * USDC), None, "x-3".into(), route()).status, "sending");
        assert_eq!(c.get_wallet(owner).unwrap().cross_chain_spent_today.0, 200 * USDC);
    }

    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn only_the_owner_wallet_sets_the_cross_chain_cap() {
        let (mut c, owner, _) = funded(10);
        testing_env!(ctx(owner, NearToken::from_yoctonear(0), 10));
        c.set_cross_chain_cap(U128(1_000 * USDC));
    }

    /// M-2 (PoC `poc_paid_entries_are_not_charged_to_owner`): a payment's paid mark is charged
    /// to the owner's credit, and a refund gives it back.
    #[test]
    fn paid_marks_are_charged_to_the_owner_and_refunded_with_the_payment() {
        let (mut c, owner, payee) = funded(10);
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        let before = credit(&c, &owner);
        let id = "f".repeat(64);
        c.pay(payee, U128(1), None, id.clone(), None);
        // (owner, 64-character id) in the paid set: 116 bytes with a 3-character owner, as the audit measured.
        let charged = before - credit(&c, &owner);
        assert_eq!(charged, 116 * byte_cost());
        cb_with(10, PromiseResult::Failed);
        c.on_pay_complete(owner.clone(), id, U128(1), 10, false, Err(PromiseError::Failed));
        assert_eq!(credit(&c, &owner), before);
    }

    /// M-2 (PoC `poc_wallet_record_bytes_uncharged`): registering pays for the wallet record and
    /// keeps the rest of the deposit as credit.
    #[test]
    fn registration_pays_for_the_wallet_record() {
        let (usdc, owner) = (accounts(0), accounts(1));
        testing_env!(ctx(owner.clone(), NearToken::from_millinear(50), 10));
        let mut c = AgentWallet::new(usdc);
        c.register();
        let before = env::storage_usage();
        let w = c.get_wallet(owner.clone()).unwrap();
        let record = NearToken::from_millinear(50).as_yoctonear() - w.storage_credit.0;
        assert!(record > 0 && record % byte_cost() == 0, "the record is charged by the byte");
        // The charge is the record's real size: removing it frees exactly that many bytes.
        c.wallets.remove(&owner);
        c.wallets.flush();
        assert_eq!(u128::from(before - env::storage_usage()) * byte_cost(), record);
    }

    #[test]
    #[should_panic(expected = "REGISTRATION_NEEDS_0.05_NEAR")]
    fn registration_needs_the_minimum() {
        testing_env!(ctx(accounts(1), NearToken::from_millinear(49), 10));
        AgentWallet::new(accounts(0)).register();
    }

    /// M-1 (PoC `poc_storage_credit_exhaustion_bricks_wallet`): a wallet whose credit ran out
    /// used to stay stuck. The owner can now top it up, and take back what isn't used.
    #[test]
    fn storage_credit_runs_out_then_is_topped_up_and_withdrawn() {
        let (mut c, owner, payee) = funded(10);
        // Take back all but 100 bytes' worth.
        let keep = 100 * byte_cost();
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(1), 10));
        let all_but = credit(&c, &owner) - keep;
        let _ = c.withdraw_storage_credit(Some(U128(all_but)));
        let sent: Vec<_> = get_created_receipts().into_iter().filter(|r| r.receiver_id == owner).flat_map(|r| r.actions).collect();
        assert!(sent.contains(&MockAction::Transfer { receipt_index: 0, deposit: NearToken::from_yoctonear(all_but) }), "{sent:?}");
        assert_eq!(credit(&c, &owner), keep);

        // Out of credit: a proof, a parked payment and a paid mark all need storage.
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        assert!(panic_text(|| c.record_proof("m-1".into(), "a".repeat(128), "m".repeat(64))).contains("STORAGE_CREDIT_LOW"));
        assert!(panic_text(|| { c.pay(payee.clone(), U128(500 * USDC), Some("x".repeat(200)), "big".into(), None); }).contains("STORAGE_CREDIT_LOW"));

        // Topped up from the owner's wallet (a function-call key can't attach NEAR): it works again.
        testing_env!(ctx(owner.clone(), NearToken::from_millinear(10), 10));
        assert_eq!(c.add_storage_credit().0, keep + NearToken::from_millinear(10).as_yoctonear());
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        c.record_proof("m-2".into(), "a".repeat(128), "m".repeat(64));
        assert!(c.get_proof(owner.clone(), "m-2".into()).is_some());

        // Withdrawing all of it leaves nothing, and more than that is refused.
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(1), 10));
        let _ = c.withdraw_storage_credit(None);
        assert_eq!(credit(&c, &owner), 0);
        assert!(panic_text(|| { let _ = c.withdraw_storage_credit(Some(U128(1))); }).contains("STORAGE_CREDIT_LOW"));
    }

    #[test]
    fn storage_credit_methods_act_only_on_the_callers_own_wallet() {
        let (mut c, owner, _) = funded(10);
        let before = credit(&c, &owner);
        // Someone without a wallet can neither top up nor withdraw: they only ever reach their own.
        testing_env!(ctx(accounts(3), NearToken::from_yoctonear(1), 10));
        assert!(panic_text(|| { let _ = c.withdraw_storage_credit(None); }).contains("NOT_REGISTERED"));
        testing_env!(ctx(accounts(3), NearToken::from_millinear(10), 10));
        assert!(panic_text(|| { c.add_storage_credit(); }).contains("NOT_REGISTERED"));
        assert_eq!(credit(&c, &owner), before);
        // Withdrawing needs the owner's wallet (1 yocto); topping up needs NEAR attached.
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        assert!(panic_text(|| { let _ = c.withdraw_storage_credit(None); }).contains("exactly 1 yoctoNEAR"));
        assert!(panic_text(|| { c.add_storage_credit(); }).contains("NEEDS_DEPOSIT"));
    }

    /// L-1 (PoC `poc_refund_across_midnight_lifts_next_days_cap`): a day-10 refund that lands on
    /// day 11 no longer lowers day 11's spending.
    #[test]
    fn a_refund_after_midnight_lowers_only_its_own_day() {
        let (mut c, owner, payee) = funded(10);
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        assert_eq!(c.pay(payee.clone(), U128(150 * USDC), None, "a".into(), None).status, "sending");
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 11));
        assert_eq!(c.pay(payee.clone(), U128(200 * USDC), None, "b".into(), None).status, "sending");
        // The day-10 payment's failure lands on day 11.
        cb_with(11, PromiseResult::Failed);
        assert!(!c.on_pay_complete(owner.clone(), "a".into(), U128(150 * USDC), 10, false, Err(PromiseError::Failed)));
        let w = c.get_wallet(owner.clone()).unwrap();
        assert_eq!((w.spent_today.0, w.balance.0), (200 * USDC, 800 * USDC), "the money is back, day 11 is still fully spent");
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 11));
        assert_eq!(c.pay(payee, U128(150 * USDC), None, "c".into(), None).status, "blocked");
    }

    #[test]
    fn a_cross_chain_refund_after_midnight_lowers_only_its_own_day() {
        let (mut c, owner, payee) = funded_cross_chain(10);
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        c.pay(payee.clone(), U128(150 * USDC), None, "x-1".into(), route());
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 11));
        c.pay(payee.clone(), U128(200 * USDC), None, "x-2".into(), route());
        cb_with(11, PromiseResult::Failed);
        c.on_pay_complete(owner.clone(), "x-1".into(), U128(150 * USDC), 10, true, Err(PromiseError::Failed));
        let w = c.get_wallet(owner.clone()).unwrap();
        assert_eq!((w.spent_today.0, w.cross_chain_spent_today.0), (200 * USDC, 200 * USDC));
        // The same day, a refund does lower both.
        cb_with(11, PromiseResult::Failed);
        c.on_pay_complete(owner.clone(), "x-2".into(), U128(200 * USDC), 11, true, Err(PromiseError::Failed));
        let w = c.get_wallet(owner).unwrap();
        assert_eq!((w.spent_today.0, w.cross_chain_spent_today.0, w.balance.0), (0, 0, 1_000 * USDC));
    }

    /// L-2 (PoC `poc_failed_withdraw_unmarks_app_followup`): a failed withdrawal used to clear the
    /// paid mark of a payment whose id was `withdraw-<height>`. Withdrawals now have their own callback.
    #[test]
    fn a_failed_withdrawal_never_unmarks_a_payment() {
        let (mut c, owner, payee) = funded(10);
        let mut cx = ctx(owner.clone(), NearToken::from_yoctonear(0), 10);
        cx.block_index = 777;
        testing_env!(cx.clone());
        c.pay(payee.clone(), U128(10 * USDC), None, "withdraw-777".into(), None);
        cx.attached_deposit = NearToken::from_yoctonear(1);
        testing_env!(cx);
        c.withdraw(U128(5 * USDC));
        assert_eq!(c.get_wallet(owner.clone()).unwrap().balance.0, 985 * USDC);
        cb_with(10, PromiseResult::Failed);
        assert!(!c.on_withdraw_complete(owner.clone(), U128(5 * USDC), Err(PromiseError::Failed)));
        assert_eq!(c.get_wallet(owner.clone()).unwrap().balance.0, 990 * USDC, "the withdrawal came back");
        assert!(c.is_paid(owner.clone(), "withdraw-777".into()), "the payment is still marked paid");
        testing_env!(ctx(owner, NearToken::from_yoctonear(0), 10));
        assert!(panic_text(|| { c.pay(payee, U128(10 * USDC), None, "withdraw-777".into(), None); }).contains("ALREADY_PAID"));
    }

    /// L-3 (PoC `poc_cross_chain_fee_not_restored_on_failure`): when the deposit address couldn't
    /// be registered, the payment is undone and the registration fee comes back to the credit.
    /// When it was registered and only the transfer failed, the fee was spent on the token.
    #[test]
    fn a_failed_registration_returns_the_fee_and_a_registered_address_sends() {
        let (mut c, owner, payee) = funded_cross_chain(10);
        let before = credit(&c, &owner);
        let fee = DEPOSIT_ADDRESS_REGISTRATION.as_yoctonear();

        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        c.pay(payee.clone(), U128(USDC), None, "x".into(), route());
        cb_with(10, PromiseResult::Failed);
        let out = c.on_deposit_address_registered(owner.clone(), "x".into(), U128(USDC), 10, DEPOSIT.parse().unwrap(), None);
        assert!(matches!(out, PromiseOrValue::Value(false)));
        let w = c.get_wallet(owner.clone()).unwrap();
        assert_eq!((w.storage_credit.0, w.balance.0, w.spent_today.0, w.cross_chain_spent_today.0), (before, 1_000 * USDC, 0, 0));
        assert!(!c.is_paid(owner.clone(), "x".into()) && c.get_cross_chain_payment(owner.clone(), "x".into()).is_none());

        // Registered (the token's reply isn't parsed, so any value works): the USDC goes out.
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        c.pay(payee, U128(USDC), None, "y".into(), route());
        cb_with(10, PromiseResult::Successful(b"{\"total\":\"1\",\"available\":\"0\"}".to_vec()));
        let out = c.on_deposit_address_registered(owner.clone(), "y".into(), U128(USDC), 10, DEPOSIT.parse().unwrap(), None);
        assert!(matches!(out, PromiseOrValue::Promise(_)));
        drop(out);
        let calls: Vec<String> = get_created_receipts()
            .into_iter()
            .flat_map(|r| r.actions)
            .filter_map(|a| match a {
                MockAction::FunctionCallWeight { method_name, .. } => Some(String::from_utf8(method_name).unwrap()),
                _ => None,
            })
            .collect();
        assert_eq!(calls, ["ft_transfer", "on_pay_complete"]);
        // The transfer then fails: everything comes back but the fee, which registered the address.
        cb_with(10, PromiseResult::Failed);
        c.on_pay_complete(owner.clone(), "y".into(), U128(USDC), 10, true, Err(PromiseError::Failed));
        let w = c.get_wallet(owner.clone()).unwrap();
        assert_eq!((w.storage_credit.0, w.balance.0, w.cross_chain_spent_today.0), (before - fee, 1_000 * USDC, 0));
        assert!(c.get_cross_chain_payment(owner, "y".into()).is_none());
    }

    /// L-4: nanosecond timestamps are above 2^53, so views give them as strings.
    #[test]
    fn views_give_timestamps_as_strings() {
        let (mut c, owner, payee) = funded_cross_chain(10);
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        c.record_proof("m-1".into(), "ab".repeat(32), "Qwen/Qwen3.8-27B".into());
        c.pay(payee, U128(USDC), None, "x".into(), route());
        let ts = (10 * NANOS_PER_DAY + 1).to_string();
        let proof = near_sdk::serde_json::to_value(c.get_proof(owner.clone(), "m-1".into()).unwrap()).unwrap();
        assert_eq!(proof["recorded_at"], ts.as_str());
        let sent = near_sdk::serde_json::to_value(c.get_cross_chain_payment(owner, "x".into()).unwrap()).unwrap();
        assert_eq!(sent["sent_at"], ts.as_str());
    }

    /// L-5: the memo is capped like every other string.
    #[test]
    fn memos_are_capped_at_256_bytes() {
        let (mut c, owner, payee) = funded(10);
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        assert!(panic_text(|| { c.pay(payee.clone(), U128(500 * USDC), Some("x".repeat(257)), "big".into(), None); }).contains("MEMO_TOO_LONG"));
        assert_eq!(c.pay(payee, U128(500 * USDC), Some("x".repeat(256)), "big".into(), None).status, "blocked");
    }

    /// Info I-5: withdraw and approve_pending refuse too little gas up front, like pay.
    #[test]
    fn withdraw_and_approve_need_50_tgas() {
        let (mut c, owner, payee) = funded(10);
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        c.pay(payee, U128(500 * USDC), None, "big".into(), None);
        let mut low = ctx(owner.clone(), NearToken::from_yoctonear(1), 10);
        low.prepaid_gas = Gas::from_tgas(30);
        testing_env!(low);
        assert!(panic_text(|| c.withdraw(U128(USDC))).contains("NEEDS_50_TGAS"));
        assert!(panic_text(|| c.approve_pending("big".into())).contains("NEEDS_50_TGAS"));
        assert_eq!(c.get_wallet(owner).unwrap().balance.0, 1_000 * USDC);
    }
}
