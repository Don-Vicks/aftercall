//! The app's side of NEAR: its own limited key (kept in the Keychain), the account
//! and agent-wallet contract it works with, and the two calls it may make.

use std::path::{Path, PathBuf};

use near_tx::{Client, FunctionCall, KeyPair, Network};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const KEYCHAIN_SERVICE: &str = "dev.aftercall.app";
const KEYCHAIN_ACCOUNT: &str = "near-app-key";
const RECORD_PROOF_GAS: u64 = 30_000_000_000_000;

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NearConfig {
    /// "testnet" or "mainnet".
    pub network: String,
    /// The user's NEAR account, e.g. victor.testnet.
    pub account: String,
    /// The agent-wallet contract.
    pub contract: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NearStatus {
    pub public_key: String,
    /// The app's key is on the account, limited to this contract, `pay` and `record_proof`.
    pub key_added: bool,
    /// What the key may do, if it is on the account with other permissions.
    pub key_problem: Option<String>,
    /// The account has a wallet on the contract (`register` was called).
    pub registered: bool,
}

pub fn config_path(data_dir: &Path) -> PathBuf {
    data_dir.join("near.json")
}

pub fn load_config(data_dir: &Path) -> Option<NearConfig> {
    serde_json::from_str(&std::fs::read_to_string(config_path(data_dir)).ok()?).ok()
}

pub fn save_config(data_dir: &Path, config: &NearConfig) -> Result<(), String> {
    let network = Network::parse(&config.network).map_err(|_| "Network must be testnet or mainnet".to_string())?;
    let valid = |id: &str| id.len() >= 2 && id.len() <= 64 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "-_.".contains(c));
    if !valid(&config.account) || !valid(&config.contract) {
        return Err("Use NEAR account ids like yourname.near or yourname.testnet".into());
    }
    for id in [&config.account, &config.contract] {
        if !network.fits(id) {
            return Err(format!("{id} isn't a {} account", config.network));
        }
    }
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    std::fs::write(config_path(data_dir), serde_json::to_string_pretty(config).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn network(config: &NearConfig) -> Network {
    Network::parse(&config.network).unwrap_or(Network::Testnet)
}

fn client(config: &NearConfig) -> Client {
    Client::for_network(network(config))
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())
}

/// The app's key pair, created on first use. Only its public half ever leaves this module.
pub fn app_key() -> Result<KeyPair, String> {
    match entry()?.get_password() {
        Ok(secret) => KeyPair::from_secret(&secret),
        Err(keyring::Error::NoEntry) => {
            let key = KeyPair::generate();
            entry()?.set_password(&key.secret()).map_err(|e| e.to_string())?;
            Ok(key)
        }
        Err(e) => Err(e.to_string()),
    }
}

/// Is this function-call permission exactly what the app needs, and no more?
pub fn check_permission(permission: &Value, contract: &str) -> Result<(), String> {
    let Some(fc) = permission.get("FunctionCall") else {
        return Err("The app's key has full access; remove it and add it as a limited key".into());
    };
    if fc["receiver_id"].as_str() != Some(contract) {
        return Err(format!("The app's key is limited to {}, not {contract}", fc["receiver_id"]));
    }
    let mut methods: Vec<&str> = fc["method_names"].as_array().map(|m| m.iter().filter_map(|v| v.as_str()).collect()).unwrap_or_default();
    methods.sort();
    if methods != ["pay", "record_proof"] {
        return Err("The app's key must be limited to pay and record_proof".into());
    }
    Ok(())
}

pub async fn status(config: &NearConfig) -> Result<NearStatus, String> {
    let key = app_key()?;
    let rpc = client(config);
    let (key_added, key_problem) = match rpc.access_key(&config.account, &key.public_key()).await? {
        None => (false, None),
        Some(access) => match check_permission(&access["permission"], &config.contract) {
            Ok(()) => (true, None),
            Err(problem) => (false, Some(problem)),
        },
    };
    let registered = rpc
        .view(&config.contract, "get_wallet", &json!({ "owner": config.account }))
        .await
        .map(|w| !w.is_null())
        .unwrap_or(false);
    Ok(NearStatus { public_key: key.public_key(), key_added, key_problem, registered })
}

/// Records a meeting's proof hash; returns the transaction hash.
pub async fn record_proof(config: &NearConfig, meeting_id: &str, proof_hash: &str, model: &str) -> Result<String, String> {
    let args = json!({ "meeting_id": meeting_id, "proof_hash": proof_hash, "model": model });
    let outcome = client(config)
        .call(
            &config.account,
            &app_key()?,
            &config.contract,
            FunctionCall { method_name: "record_proof".into(), args: args.to_string().into_bytes(), gas: RECORD_PROOF_GAS, deposit: 0 },
        )
        .await?;
    Ok(outcome.tx_hash)
}

const PAY_GAS: u64 = 100_000_000_000_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayOutcome {
    pub tx_hash: String,
    /// "paid", "failed" (the transfer bounced and was refunded) or "blocked".
    pub status: String,
    /// OVER_CAP or OVER_PAYMENT_CAP when blocked.
    pub reason: Option<String>,
    pub left_today: Option<String>,
}

/// Pays a listed payee with the app's limited key. The contract decides: it sends
/// within the caps, or parks the payment for the owner's wallet.
pub async fn pay(config: &NearConfig, payee: &str, amount: &str, memo: &str, followup_id: &str) -> Result<PayOutcome, String> {
    if amount.is_empty() || !amount.chars().all(|c| c.is_ascii_digit()) {
        return Err("Bad amount".into());
    }
    let rpc = client(config);
    let args = json!({ "payee": payee, "amount": amount, "memo": memo, "followup_id": followup_id });
    let outcome = rpc
        .call(&config.account, &app_key()?, &config.contract, FunctionCall { method_name: "pay".into(), args: args.to_string().into_bytes(), gas: PAY_GAS, deposit: 0 })
        .await?;
    let result = outcome.value.unwrap_or(Value::Null);
    let left_today = result["left_today"].as_str().map(String::from);
    if result["status"] == "blocked" {
        return Ok(PayOutcome { tx_hash: outcome.tx_hash, status: "blocked".into(), reason: result["reason"].as_str().map(String::from), left_today });
    }
    // The transfer and its callback have run by now; a bounced transfer was refunded and unmarked.
    let paid = rpc.view(&config.contract, "is_paid", &json!({ "owner": config.account, "followup_id": followup_id })).await?;
    let status = if paid == Value::Bool(true) { "paid" } else { "failed" };
    Ok(PayOutcome { tx_hash: outcome.tx_hash, status: status.into(), reason: None, left_today })
}

/// The owner's wallet and payees, or nulls if they haven't registered.
pub async fn wallet(config: &NearConfig) -> Result<Value, String> {
    let rpc = client(config);
    let owner = json!({ "owner": config.account });
    let wallet = rpc.view(&config.contract, "get_wallet", &owner).await?;
    let payees = rpc.view(&config.contract, "get_payees", &owner).await.unwrap_or(json!([]));
    Ok(json!({ "wallet": wallet, "payees": payees }))
}

/// Whether a follow-up has been paid, and whether it is still parked.
pub async fn payment_state(config: &NearConfig, followup_id: &str) -> Result<Value, String> {
    let rpc = client(config);
    let args = json!({ "owner": config.account, "followup_id": followup_id });
    let paid = rpc.view(&config.contract, "is_paid", &args).await?;
    let pending = rpc.view(&config.contract, "get_pending", &args).await?;
    Ok(json!({ "paid": paid, "pending": !pending.is_null() }))
}

/// Circle USDC on NEAR.
fn usdc_contract(config: &NearConfig) -> &'static str {
    network(config).usdc()
}

/// Before adding a payee: does the account exist, and can it already hold USDC?
pub async fn check_payee(config: &NearConfig, account: &str) -> Result<Value, String> {
    let rpc = client(config);
    if !rpc.account_exists(account).await? {
        return Ok(json!({ "exists": false, "usdcReady": false }));
    }
    let storage = rpc.view(usdc_contract(config), "storage_balance_of", &json!({ "account_id": account })).await.unwrap_or(Value::Null);
    Ok(json!({ "exists": true, "usdcReady": !storage.is_null() }))
}

/// The owner's own USDC balance (outside the agent wallet), for deposits.
pub async fn owner_usdc(config: &NearConfig) -> Result<String, String> {
    let v = client(config).view(usdc_contract(config), "ft_balance_of", &json!({ "account_id": config.account })).await?;
    Ok(v.as_str().unwrap_or("0").to_string())
}

/// Signs a backend sign-in challenge (NEP-413) with the app's key.
pub fn sign_in_message(config: &NearConfig, message: &str, nonce_b64: &str, recipient: &str) -> Result<Value, String> {
    use base64::Engine as _;
    let nonce: [u8; 32] = base64::engine::general_purpose::STANDARD
        .decode(nonce_b64)
        .map_err(|e| e.to_string())?
        .try_into()
        .map_err(|_| "Nonce must be 32 bytes")?;
    if message != "Sign in to Aftercall" || recipient != "aftercall" {
        return Err("The app only signs Aftercall's sign-in message".into());
    }
    let key = app_key()?;
    Ok(json!({
        "accountId": config.account,
        "publicKey": key.public_key(),
        "signature": near_tx::sign_message(&key, message, &nonce, recipient),
        "message": message,
        "nonce": nonce_b64,
        "recipient": recipient,
    }))
}

pub async fn get_proof(config: &NearConfig, owner: &str, meeting_id: &str) -> Result<Value, String> {
    client(config).view(&config.contract, "get_proof", &json!({ "owner": owner, "meeting_id": meeting_id })).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_key_limited_to_pay_and_record_proof_is_accepted() {
        let good = json!({ "FunctionCall": { "allowance": "250000000000000000000000", "receiver_id": "w.testnet", "method_names": ["record_proof", "pay"] } });
        assert!(check_permission(&good, "w.testnet").is_ok());
        assert!(check_permission(&json!("FullAccess"), "w.testnet").is_err());
        assert!(check_permission(&good, "other.testnet").is_err());
        let wide = json!({ "FunctionCall": { "receiver_id": "w.testnet", "method_names": [] } });
        assert!(check_permission(&wide, "w.testnet").is_err(), "an empty list means every method");
    }

    #[test]
    fn config_rejects_bad_ids_and_networks() {
        let dir = std::env::temp_dir().join(format!("aftercall-near-{}", std::process::id()));
        let ok = NearConfig { network: "testnet".into(), account: "victor.testnet".into(), contract: "aftercall-wallet.testnet".into() };
        assert!(save_config(&dir, &ok).is_ok());
        assert_eq!(load_config(&dir).unwrap().account, "victor.testnet");
        assert!(save_config(&dir, &NearConfig { network: "devnet".into(), ..ok.clone() }).is_err());
        assert!(save_config(&dir, &NearConfig { account: "Victor Testnet".into(), ..ok.clone() }).is_err());
        // A testnet account can't be saved in a mainnet setup, and the other way round.
        assert!(save_config(&dir, &NearConfig { network: "mainnet".into(), ..ok.clone() }).is_err());
        let main = NearConfig { network: "mainnet".into(), account: "victor.near".into(), contract: "wallet.victor.near".into() };
        assert!(save_config(&dir, &main).is_ok());
        assert_eq!(usdc_contract(&main), "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1");
        assert!(save_config(&dir, &NearConfig { network: "devnet".into(), ..main }).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
