//! Aftercall agent wallet.
//!
//! One shared contract holds each user's USDC with their own rules: a daily cap,
//! a per-payment cap, a payee list and a pause switch. The desktop app holds a
//! function-call key that may only call `pay` and `record_proof`. Every rule
//! change needs exactly 1 yoctoNEAR, which a function-call key cannot attach, so
//! only the user's own wallet (a full-access key) can make it.
//!
//! There is no admin method that can move user funds, and every user pays for
//! the storage their own records use.

use near_sdk::json_types::U128;
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{
    assert_one_yocto, env, ext_contract, near, require, AccountId, BorshStorageKey, Gas,
    NearToken, PanicOnDefault, PromiseError, PromiseOrValue,
};

const NANOS_PER_DAY: u64 = 86_400_000_000_000;
const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(15);
const MIN_GAS_FOR_PAY: Gas = Gas::from_tgas(50);
/// 0.05 NEAR, kept as the user's storage credit for proofs and parked payments.
const MIN_REGISTRATION: NearToken = NearToken::from_millinear(50);
const MAX_PENDING: u32 = 20;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Wallets,
    Payees,
    Paid,
    Pending,
    Proofs,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Wallet {
    pub balance: U128,
    pub daily_cap: U128,
    pub spent_today: U128,
    /// Day number (UTC) that `spent_today` belongs to.
    pub day: u64,
    pub paused: bool,
    pub pending_count: u32,
    /// yoctoNEAR the user deposited to pay for their own storage.
    pub storage_credit: U128,
    /// Largest single payment the limited key may send. 0 means no extra limit.
    pub per_payment_cap: U128,
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
    pub recorded_at: u64,
}

#[near(serializers = [json])]
pub struct PayResult {
    /// "sending" (transfer started; the outcome lands in the callback) or "blocked".
    pub status: String,
    /// "OVER_CAP" or "OVER_PAYMENT_CAP" when blocked.
    pub reason: Option<String>,
    pub left_today: U128,
}

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct AgentWallet {
    usdc: AccountId,
    wallets: LookupMap<AccountId, Wallet>,
    /// (owner, payee) -> label
    payees: LookupMap<(AccountId, AccountId), String>,
    /// (owner, follow-up id) for every payment sent or in flight.
    paid: LookupSet<(AccountId, String)>,
    /// (owner, follow-up id) -> payment parked for the owner's approval.
    pending: LookupMap<(AccountId, String), Payment>,
    /// (owner, meeting id) -> proof
    proofs: LookupMap<(AccountId, String), Proof>,
}

#[near]
impl AgentWallet {
    #[init]
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

    // ---------- registration and deposits ----------

    /// Creates the caller's wallet. The attached NEAR becomes their storage credit.
    #[payable]
    pub fn register(&mut self) {
        let owner = env::predecessor_account_id();
        let deposit = env::attached_deposit();
        require!(deposit >= MIN_REGISTRATION, "REGISTRATION_NEEDS_0.05_NEAR");
        require!(self.wallets.get(&owner).is_none(), "ALREADY_REGISTERED");
        self.wallets.insert(
            owner,
            Wallet {
                balance: U128(0),
                daily_cap: U128(0),
                spent_today: U128(0),
                day: today(),
                paused: false,
                pending_count: 0,
                storage_credit: U128(deposit.as_yoctonear()),
                per_payment_cap: U128(0),
            },
        );
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
            this.payees.insert((owner.clone(), payee), label);
            this.payees.flush();
        });
    }

    #[payable]
    pub fn remove_payee(&mut self, payee: AccountId) {
        assert_one_yocto();
        let owner = env::predecessor_account_id();
        self.with_storage(&owner, |this| {
            this.payees.remove(&(owner.clone(), payee));
            this.payees.flush();
        });
    }

    #[payable]
    pub fn withdraw(&mut self, amount: U128) {
        assert_one_yocto();
        let owner = env::predecessor_account_id();
        let w = self.wallet_mut(&owner);
        require!(w.balance.0 >= amount.0, "LOW_BALANCE");
        w.balance = U128(w.balance.0 - amount.0);
        let followup_id = format!("withdraw-{}", env::block_height());
        self.transfer(owner.clone(), owner, amount, None, followup_id, false);
    }

    /// Pays a payment that `pay` parked because it was over a cap.
    #[payable]
    pub fn approve_pending(&mut self, followup_id: String) {
        assert_one_yocto();
        let owner = env::predecessor_account_id();
        let payment = self.take_pending(&owner, &followup_id);
        // The payee may have been removed since; the usual checks still apply.
        self.check_payable(&owner, &payment.payee, payment.amount, &followup_id);
        let w = self.wallet_mut(&owner);
        roll_day(w);
        w.balance = U128(w.balance.0 - payment.amount.0);
        // Approved over-cap payments still count towards today's spending.
        w.spent_today = U128(w.spent_today.0 + payment.amount.0);
        self.paid.insert((owner.clone(), followup_id.clone()));
        self.transfer(owner, payment.payee, payment.amount, payment.memo, followup_id, true);
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
    pub fn pay(
        &mut self,
        payee: AccountId,
        amount: U128,
        memo: Option<String>,
        followup_id: String,
    ) -> PayResult {
        require!(env::prepaid_gas() >= MIN_GAS_FOR_PAY, "NEEDS_50_TGAS");
        require!(amount.0 > 0, "ZERO_AMOUNT");
        let owner = env::predecessor_account_id();
        self.check_payable(&owner, &payee, amount, &followup_id);

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
            return PayResult { status: "blocked".into(), reason: Some(reason.into()), left_today: left };
        }

        w.balance = U128(w.balance.0 - amount.0);
        w.spent_today = U128(w.spent_today.0 + amount.0);
        let left = U128(w.daily_cap.0 - w.spent_today.0);
        self.paid.insert((owner.clone(), followup_id.clone()));
        self.transfer(owner, payee, amount, memo, followup_id, true);
        PayResult { status: "sending".into(), reason: None, left_today: left }
    }

    /// Records the hash of a meeting's proof bundle. A proof can never be overwritten.
    pub fn record_proof(&mut self, meeting_id: String, proof_hash: String, model: String) {
        let owner = env::predecessor_account_id();
        require!(meeting_id.len() <= 64 && proof_hash.len() <= 128 && model.len() <= 64, "TOO_LONG");
        let key = (owner.clone(), meeting_id);
        require!(self.proofs.get(&key).is_none(), "PROOF_EXISTS");
        let proof = Proof { proof_hash, model, recorded_at: env::block_timestamp() };
        self.with_storage(&owner, |this| {
            this.proofs.insert(key, proof);
            this.proofs.flush();
        });
    }

    // ---------- callback ----------

    /// Runs after `ft_transfer`. On failure, undoes everything the payment did.
    #[private]
    pub fn on_pay_complete(
        &mut self,
        owner: AccountId,
        followup_id: String,
        amount: U128,
        counts_to_cap: bool,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_ok() {
            return true;
        }
        if let Some(w) = self.wallets.get_mut(&owner) {
            w.balance = U128(w.balance.0 + amount.0);
            if counts_to_cap {
                w.spent_today = U128(w.spent_today.0.saturating_sub(amount.0));
            }
        }
        self.paid.remove(&(owner.clone(), followup_id.clone()));
        env::log_str(&format!("PAYMENT_FAILED owner={owner} followup_id={followup_id} refunded={}", amount.0));
        false
    }

    // ---------- views ----------

    pub fn get_wallet(&self, owner: AccountId) -> Option<Wallet> {
        self.wallets.get(&owner).cloned()
    }

    pub fn get_payee_label(&self, owner: AccountId, payee: AccountId) -> Option<String> {
        self.payees.get(&(owner, payee)).cloned()
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
}

impl AgentWallet {
    fn wallet_mut(&mut self, owner: &AccountId) -> &mut Wallet {
        self.wallets.get_mut(owner).unwrap_or_else(|| env::panic_str("NOT_REGISTERED"))
    }

    fn check_payable(&mut self, owner: &AccountId, payee: &AccountId, amount: U128, followup_id: &str) {
        require!(followup_id.len() <= 64, "FOLLOWUP_ID_TOO_LONG");
        require!(!self.paid.contains(&(owner.clone(), followup_id.to_string())), "ALREADY_PAID");
        require!(self.payees.get(&(owner.clone(), payee.clone())).is_some(), "UNKNOWN_PAYEE");
        let w = self.wallet_mut(owner);
        require!(!w.paused, "PAUSED");
        require!(w.balance.0 >= amount.0, "LOW_BALANCE");
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

    fn transfer(
        &mut self,
        owner: AccountId,
        receiver: AccountId,
        amount: U128,
        memo: Option<String>,
        followup_id: String,
        counts_to_cap: bool,
    ) {
        // Dropping the promise schedules it; callers return their own values.
        let _ = ext_ft::ext(self.usdc.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(receiver, amount, memo)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .on_pay_complete(owner, followup_id, amount, counts_to_cap),
            );
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
        assert_eq!(c.pay(payee.clone(), U128(150 * USDC), None, "a".into()).status, "sending");
        assert_eq!(c.pay(payee.clone(), U128(100 * USDC), None, "b".into()).status, "blocked");

        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 11));
        assert_eq!(c.pay(payee, U128(100 * USDC), None, "c".into()).status, "sending");
        assert_eq!(c.get_wallet(owner).unwrap().spent_today.0, 100 * USDC);
    }

    #[test]
    fn approval_on_a_new_day_counts_towards_that_day() {
        let (mut c, owner, payee) = funded(10);
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        c.pay(payee.clone(), U128(150 * USDC), None, "a".into());
        assert_eq!(c.pay(payee.clone(), U128(500 * USDC), None, "big".into()).status, "blocked");

        // Approved the next day: yesterday's 150 no longer counts, today's 500 does.
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(1), 11));
        c.approve_pending("big".into());
        assert_eq!(c.get_wallet(owner.clone()).unwrap().spent_today.0, 500 * USDC);

        // So a small payment the same day is over the cap, not silently allowed.
        testing_env!(ctx(owner, NearToken::from_yoctonear(0), 11));
        assert_eq!(c.pay(payee, U128(10 * USDC), None, "c".into()).status, "blocked");
    }

    #[test]
    fn cancelled_pending_returns_its_storage() {
        let (mut c, owner, payee) = funded(10);
        let credit_before = c.get_wallet(owner.clone()).unwrap().storage_credit.0;
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        c.pay(payee, U128(500 * USDC), None, "big".into());
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
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn cancel_needs_the_owner_wallet() {
        let (mut c, owner, payee) = funded(10);
        testing_env!(ctx(owner.clone(), NearToken::from_yoctonear(0), 10));
        c.pay(payee, U128(500 * USDC), None, "big".into());
        c.cancel_pending("big".into());
    }
}
