//! The app's side of NEAR: its own limited key (kept in the Keychain), the account
//! and agent-wallet contract it works with, and the two calls it may make.

use std::path::{Path, PathBuf};

use near_tx::{Client, FunctionCall, KeyPair};
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
    if !matches!(config.network.as_str(), "testnet" | "mainnet") {
        return Err("Network must be testnet or mainnet".into());
    }
    let valid = |id: &str| id.len() >= 2 && id.len() <= 64 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "-_.".contains(c));
    if !valid(&config.account) || !valid(&config.contract) {
        return Err("Use NEAR account ids like yourname.testnet".into());
    }
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    std::fs::write(config_path(data_dir), serde_json::to_string_pretty(config).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn client(config: &NearConfig) -> Client {
    if config.network == "mainnet" { Client::mainnet() } else { Client::testnet() }
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
        assert!(save_config(&dir, &NearConfig { account: "Victor Testnet".into(), ..ok }).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
