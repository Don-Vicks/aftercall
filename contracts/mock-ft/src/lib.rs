//! NEP-141 token with 6 decimals, standing in for Circle USDC in the agent-wallet sandbox tests. Never deployed.
//!
//! Two test switches, set by the token's owner, make the agent wallet's failure paths reachable:
//! a blocklist (like Circle's: a transfer to or from a blocked account fails) and a raised
//! minimum storage deposit (so a deposit-address registration fails).

use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::store::LookupSet;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue};

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Token,
    Blocked,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
    owner_id: AccountId,
    blocked: LookupSet<AccountId>,
    /// A minimum storage deposit above the token's own, when set.
    storage_min: Option<NearToken>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId, total_supply: U128) -> Self {
        let mut this = Self { token: FungibleToken::new(StorageKey::Token), owner_id: owner_id.clone(), blocked: LookupSet::new(StorageKey::Blocked), storage_min: None };
        this.token.internal_register_account(&owner_id);
        this.token.internal_deposit(&owner_id, total_supply.into());
        this
    }

    /// Test switch: transfers to or from a blocked account fail.
    pub fn set_blocked(&mut self, account_id: AccountId, blocked: bool) {
        require!(env::predecessor_account_id() == self.owner_id, "OWNER_ONLY");
        if blocked {
            self.blocked.insert(account_id);
        } else {
            self.blocked.remove(&account_id);
        }
    }

    /// Test switch: storage_deposit needs at least this much (None goes back to the token's own minimum).
    pub fn set_storage_min(&mut self, min: Option<NearToken>) {
        require!(env::predecessor_account_id() == self.owner_id, "OWNER_ONLY");
        self.storage_min = min;
    }

    fn check_not_blocked(&self, receiver_id: &AccountId) {
        require!(!self.blocked.contains(&env::predecessor_account_id()) && !self.blocked.contains(receiver_id), "BLOCKED");
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.check_not_blocked(&receiver_id);
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.check_not_blocked(&receiver_id);
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used, _burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        if let Some(min) = self.storage_min {
            require!(env::attached_deposit() >= min, "The attached deposit is less than the minimum storage balance");
        }
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        let bounds = self.token.storage_balance_bounds();
        match self.storage_min {
            Some(min) => StorageBalanceBounds { min, max: Some(min) },
            None => bounds,
        }
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Mock USDC".to_string(),
            symbol: "USDC".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }
}
