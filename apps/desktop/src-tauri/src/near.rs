//! The app's side of NEAR: its own limited key (kept in the Keychain), the account
//! and agent-wallet contract it works with, and the two calls it may make.

use std::path::{Path, PathBuf};

use near_tx::{Client, FunctionCall, KeyPair, Network, Problem};
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
    /// The agent-wallet contract: the network's built-in one, or the user's own deployment.
    pub contract: String,
}

/// What "Save and check" found, before anything is saved.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupCheck {
    /// The user's account exists on the network.
    pub account: bool,
    /// "ok" (Aftercall's contract, on this network's USDC), "missing" (no account there, or no
    /// code) or "wrong" (a contract, but not Aftercall's).
    pub contract: &'static str,
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

/// Well-formed ids that fit the chosen network; returns the network.
fn validate(config: &NearConfig) -> Result<Network, String> {
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
    Ok(network)
}

pub fn save_config(data_dir: &Path, config: &NearConfig) -> Result<(), String> {
    validate(config)?;
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    std::fs::write(config_path(data_dir), serde_json::to_string_pretty(config).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn network(config: &NearConfig) -> Network {
    Network::parse(&config.network).unwrap_or(Network::Testnet)
}

fn client(config: &NearConfig) -> Client {
    Client::for_network(network(config))
}

/// A NEAR failure in words a person can act on, for the causes that have one (`near_tx::problem`).
/// Anything else, such as a contract's own reason ("LOW_BALANCE"), passes through unchanged:
/// the interface matches on those. `packages/core` `plainNearError` says the same for the web.
pub fn plain(config: &NearConfig, error: String) -> String {
    let net = network(config).name();
    match near_tx::problem(&error) {
        Some(Problem::NoAccount(id)) if id == config.contract => format!("No Aftercall contract at {id} on {net} yet."),
        Some(Problem::NoAccount(id)) => format!("{id} doesn't exist on {net}."),
        Some(Problem::NoCode) => format!("No Aftercall contract at {} on {net} yet.", config.contract),
        Some(Problem::NoMethod) => format!("{} isn't the Aftercall contract.", config.contract),
        Some(Problem::Allowance) => "Authorise this Mac again: its key ran out of allowance.".into(),
        Some(Problem::KeyGone) => "This Mac's key isn't on your account any more. Authorise this Mac again.".into(),
        None => error,
    }
}

/// Before saving: does the account exist, and is the contract really Aftercall's? Its
/// `get_usdc` must name this network's USDC, so an ordinary account or someone else's
/// contract at that id doesn't pass. Read-only; nothing is saved.
pub async fn check_setup(config: &NearConfig) -> Result<SetupCheck, String> {
    let network = validate(config)?;
    let rpc = Client::for_network(network);
    let account = rpc.account_exists(&config.account).await.map_err(|e| plain(config, e))?;
    let contract = match rpc.view(&config.contract, "get_usdc", &json!({})).await {
        Ok(usdc) if usdc.as_str() == Some(network.usdc()) => "ok",
        Ok(_) => "wrong",
        Err(e) => match near_tx::problem(&e) {
            Some(Problem::NoAccount(_) | Problem::NoCode) => "missing",
            Some(Problem::NoMethod) => "wrong",
            // It panicked: there's a contract, and it isn't ours.
            _ if e.contains("wasm execution failed") || e.contains("CONTRACT_EXECUTION_ERROR") => "wrong",
            _ => return Err(plain(config, e)),
        },
    };
    Ok(SetupCheck { account, contract })
}

/// Whether a web page answers (the signing page, before the app opens it). Only http(s).
pub async fn page_answers(url: &str) -> bool {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return false;
    }
    let http = reqwest::Client::builder().timeout(std::time::Duration::from_secs(3)).build();
    match http {
        Ok(http) => http.get(url).send().await.map(|r| r.status().is_success()).unwrap_or(false),
        Err(_) => false,
    }
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())
}

/// The app's key pair. Only its public half ever leaves this module. New installs get
/// it from a recovery phrase (see `recovery`); older installs keep their random key.
pub fn app_key() -> Result<KeyPair, String> {
    match entry()?.get_password() {
        Ok(secret) => KeyPair::from_secret(&secret),
        Err(keyring::Error::NoEntry) => Err("This Mac has no NEAR key yet. Create a recovery phrase in Settings.".into()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn has_app_key() -> Result<bool, String> {
    match entry()?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

/// Replaces the app's key (a key derived from a recovery phrase).
pub fn set_app_key(key: &KeyPair) -> Result<(), String> {
    entry()?.set_password(&key.secret()).map_err(|e| e.to_string())
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
    let (key_added, key_problem) = match rpc.access_key(&config.account, &key.public_key()).await.map_err(|e| plain(config, e))? {
        None => (false, None),
        Some(access) => match check_permission(&access["permission"], &config.contract) {
            Ok(()) => (true, None),
            Err(problem) => (false, Some(problem)),
        },
    };
    // A contract that's missing or isn't Aftercall's is said as such, not read as "not registered".
    let registered = rpc
        .view(&config.contract, "get_wallet", &json!({ "owner": config.account }))
        .await
        .map(|w| !w.is_null())
        .map_err(|e| plain(config, e))?;
    Ok(NearStatus { public_key: key.public_key(), key_added, key_problem, registered })
}

/// A recorded proof's transaction, and what it cost.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofTx {
    pub tx_hash: String,
    /// Tokens burnt for gas, in yoctoNEAR, paid from this Mac's key allowance. None if NEAR didn't say.
    pub fee: Option<String>,
}

/// Records a meeting's proof hash; returns the transaction hash and its fee.
pub async fn record_proof(config: &NearConfig, meeting_id: &str, proof_hash: &str, model: &str) -> Result<ProofTx, String> {
    let args = json!({ "meeting_id": meeting_id, "proof_hash": proof_hash, "model": model });
    let outcome = client(config)
        .call(
            &config.account,
            &app_key()?,
            &config.contract,
            FunctionCall { method_name: "record_proof".into(), args: args.to_string().into_bytes(), gas: RECORD_PROOF_GAS, deposit: 0 },
        )
        .await
        .map_err(|e| plain(config, e))?;
    Ok(ProofTx { tx_hash: outcome.tx_hash, fee: outcome.fee.map(|f| f.to_string()) })
}

// ---------- A new testnet account ----------

/// NEAR testnet's account helper: the `faucet_url` near-cli-rs posts to for
/// `account create-account sponsor-by-faucet-service` (its built-in testnet config, and
/// `~/Library/Application Support/near-cli/config.toml`). It creates `<name>.testnet` with the
/// given full-access public key and funds it with test NEAR. Testnet only; mainnet has none.
pub const TESTNET_HELPER_URL: &str = "https://helper.nearprotocol.com/account";

/// Why `<name>.testnet` can't be a new account, or None if it can. The helper makes names
/// directly under `testnet`, so the name has no dots. Mirrors `newTestnetNameProblem` in
/// packages/core, which the interface shows as you type.
pub fn new_testnet_name_problem(account: &str) -> Option<String> {
    let Some(name) = account.strip_suffix(".testnet") else { return Some("A new testnet account ends in .testnet.".into()) };
    if name.is_empty() {
        return Some("Type a name.".into());
    }
    if name.len() < 2 {
        return Some("Use at least 2 characters.".into());
    }
    if name.len() > 56 {
        return Some("Use at most 56 characters.".into());
    }
    if name.contains('.') {
        return Some("Use one name with no dots.".into());
    }
    if let Some(c) = name.chars().find(|c| !(c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '-' || *c == '_')) {
        return Some(if c.is_ascii_uppercase() { "Use lowercase letters.".into() } else { format!("“{c}” can't be in a NEAR name. Use a–z, 0–9, - and _.") });
    }
    let sep = |c: char| c == '-' || c == '_';
    if name.starts_with(sep) || name.ends_with(sep) || name.contains("--") || name.contains("__") || name.contains("-_") || name.contains("_-") {
        return Some("- and _ go between letters or digits, one at a time.".into());
    }
    None
}

/// Read-only: is `<name>.testnet` free to create? An error says why the name can't be used.
pub async fn testnet_name_free(account: &str) -> Result<bool, String> {
    if let Some(problem) = new_testnet_name_problem(account) {
        return Err(problem);
    }
    Ok(!Client::testnet().account_exists(account).await?)
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreatedAccount {
    pub account_id: String,
    /// The helper's create_account transaction, when its reply named it.
    pub tx_hash: Option<String>,
    /// The new account's balance in yoctoNEAR, read back from NEAR once it exists.
    pub balance: Option<String>,
}

/// Asks the testnet helper to create `account` with `public_key` as its full-access key, through
/// `post` (the real one is `helper_post`; tests pass a stub, so nothing is created). Reads the
/// reply as near-cli-rs does: a transaction result whose value is `false` when nothing was made.
pub async fn create_testnet_account<F, Fut>(account: &str, public_key: &str, post: F) -> Result<CreatedAccount, String>
where
    F: FnOnce(Value) -> Fut,
    Fut: std::future::Future<Output = Result<(u16, Value), String>>,
{
    if let Some(problem) = new_testnet_name_problem(account) {
        return Err(problem);
    }
    near_tx::parse_public_key(public_key)?;
    let (status, body) = post(json!({ "newAccountId": account, "newAccountPublicKey": public_key })).await?;
    let said = body.as_str().map(|s| s.trim().chars().take(160).collect::<String>()).filter(|s| !s.is_empty());
    if status >= 400 {
        return Err(match said {
            Some(why) => format!("NEAR's testnet helper didn't create {account}: {why}"),
            None => format!("NEAR's testnet helper didn't create {account} (it answered {status}). Try again in a minute."),
        });
    }
    // near-cli-rs reads this as an RPC transaction response, its outcome flattened in.
    let tx = body.get("final_execution_outcome").unwrap_or(&body);
    let Some(result) = tx.get("status") else {
        return Err(format!("NEAR's testnet helper answered, but not with a transaction. Check {account} on NEAR before trying again."));
    };
    if let Some(failure) = result.get("Failure") {
        return Err(format!("NEAR refused to create {account}: {failure}"));
    }
    let tx_hash = tx.pointer("/transaction_outcome/id").or_else(|| tx.pointer("/transaction/hash")).and_then(|v| v.as_str()).map(String::from);
    let value = result.get("SuccessValue").and_then(|v| v.as_str()).and_then(|b64| {
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD.decode(b64).ok()
    });
    if value.as_deref() == Some(b"false") {
        return Err(format!("{account} wasn't created. Someone may have just taken the name: pick another."));
    }
    Ok(CreatedAccount { account_id: account.to_string(), tx_hash, balance: None })
}

/// The real call to the testnet helper. Only `near_create_testnet_account` uses it.
pub async fn helper_post(body: Value) -> Result<(u16, Value), String> {
    let http = reqwest::Client::builder().timeout(std::time::Duration::from_secs(60)).build().map_err(|e| e.to_string())?;
    let response = http.post(TESTNET_HELPER_URL).json(&body).send().await.map_err(|e| format!("NEAR's testnet helper couldn't be reached: {e}"))?;
    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    Ok((status, serde_json::from_str(&text).unwrap_or(Value::String(text))))
}

/// The account's balance in yoctoNEAR, or None if it isn't on testnet (yet).
pub async fn testnet_balance(account: &str) -> Result<Option<String>, String> {
    Ok(Client::testnet().view_account(account).await?.and_then(|v| v["amount"].as_str().map(String::from)))
}

const PAY_GAS: u64 = 100_000_000_000_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayOutcome {
    pub tx_hash: String,
    /// "paid", "failed" (the transfer bounced and was refunded) or "blocked" (over a cap: parked for
    /// the owner's wallet, or for a cross-chain payment refused with nothing parked).
    pub status: String,
    /// OVER_CAP, OVER_PAYMENT_CAP or (cross-chain only) OVER_CROSS_CHAIN_CAP when blocked.
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
        .await
        .map_err(|e| plain(config, e))?;
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

/// Pays a listed payee on Solana or Base: the USDC goes to the 1Click deposit address
/// of the quote the person approved. Same limited key, same `pay` method and caps, but over a cap
/// it's refused and nothing is parked (the quote would expire); the contract refuses payees the
/// owner hasn't opted in and records the route.
pub async fn pay_cross_chain(config: &NearConfig, payee: &str, amount: &str, memo: &str, followup_id: &str, deposit_address: &str, quote_id: &str) -> Result<PayOutcome, String> {
    if amount.is_empty() || !amount.chars().all(|c| c.is_ascii_digit()) {
        return Err("Bad amount".into());
    }
    if !is_deposit_address(deposit_address) {
        return Err("The quote's deposit address isn't a NEAR implicit account".into());
    }
    let rpc = client(config);
    let args = json!({
        "payee": payee, "amount": amount, "memo": memo, "followup_id": followup_id,
        "cross_chain": { "deposit_address": deposit_address, "quote_id": quote_id },
    });
    let outcome = rpc
        .call(&config.account, &app_key()?, &config.contract, FunctionCall { method_name: "pay".into(), args: args.to_string().into_bytes(), gas: PAY_GAS, deposit: 0 })
        .await
        .map_err(|e| plain(config, e))?;
    let result = outcome.value.unwrap_or(Value::Null);
    let left_today = result["left_today"].as_str().map(String::from);
    if result["status"] == "blocked" {
        return Ok(PayOutcome { tx_hash: outcome.tx_hash, status: "blocked".into(), reason: result["reason"].as_str().map(String::from), left_today });
    }
    // "paid" here means the USDC reached the deposit address; 1Click's status says when it reaches the payee.
    let paid = rpc.view(&config.contract, "is_paid", &json!({ "owner": config.account, "followup_id": followup_id })).await?;
    let status = if paid == Value::Bool(true) { "paid" } else { "failed" };
    Ok(PayOutcome { tx_hash: outcome.tx_hash, status: status.into(), reason: None, left_today })
}

/// 1Click deposit addresses on NEAR are implicit accounts (64 lowercase hex), as the contract requires.
fn is_deposit_address(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// The owner's wallet, payees and their addresses outside NEAR, or nulls if they haven't registered.
pub async fn wallet(config: &NearConfig) -> Result<Value, String> {
    let rpc = client(config);
    let owner = json!({ "owner": config.account });
    let wallet = rpc.view(&config.contract, "get_wallet", &owner).await.map_err(|e| plain(config, e))?;
    let payees = rpc.view(&config.contract, "get_payees", &owner).await.unwrap_or(json!([]));
    // An older contract without the method: no payee has a destination.
    let destinations = rpc.view(&config.contract, "get_payee_destinations", &owner).await.unwrap_or(json!([]));
    Ok(json!({ "wallet": wallet, "payees": payees, "destinations": destinations }))
}

/// Whether a follow-up has been paid, and whether it is still parked.
pub async fn payment_state(config: &NearConfig, followup_id: &str) -> Result<Value, String> {
    let rpc = client(config);
    let args = json!({ "owner": config.account, "followup_id": followup_id });
    let paid = rpc.view(&config.contract, "is_paid", &args).await.map_err(|e| plain(config, e))?;
    let pending = rpc.view(&config.contract, "get_pending", &args).await.map_err(|e| plain(config, e))?;
    Ok(payment_state_answer(config, paid, &pending))
}

/// The answer, with the network, contract and account that gave it: a payment parked on
/// another one isn't pending here either, so only these say whether it was declined.
fn payment_state_answer(config: &NearConfig, paid: Value, pending: &Value) -> Value {
    json!({ "paid": paid, "pending": !pending.is_null(), "asked": config })
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
    client(config).view(&config.contract, "get_proof", &json!({ "owner": owner, "meeting_id": meeting_id })).await.map_err(|e| plain(config, e))
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
    fn near_failures_read_as_plain_sentences() {
        let c = NearConfig { network: "testnet".into(), account: "victor.testnet".into(), contract: "wallet.aftercall.testnet".into() };
        let unknown = |id: &str| format!(r#"RPC error UNKNOWN_ACCOUNT "account {id} does not exist while viewing""#);
        assert_eq!(plain(&c, unknown("wallet.aftercall.testnet")), "No Aftercall contract at wallet.aftercall.testnet on testnet yet.");
        assert_eq!(plain(&c, unknown("victor.testnet")), "victor.testnet doesn't exist on testnet.");
        let no_code = r#"wasm execution failed with error: CompilationError(CodeDoesNotExist { account_id: "wallet.aftercall.testnet" })"#;
        assert_eq!(plain(&c, no_code.into()), "No Aftercall contract at wallet.aftercall.testnet on testnet yet.");
        assert_eq!(plain(&c, "wasm execution failed with error: MethodResolveError(MethodNotFound)".into()), "wallet.aftercall.testnet isn't the Aftercall contract.");
        assert_eq!(plain(&c, r#"RPC error INVALID_TRANSACTION {"NotEnoughAllowance":{}}"#.into()), "Authorise this Mac again: its key ran out of allowance.");
        // The contract's own reasons pass through: the interface matches on them.
        assert_eq!(plain(&c, "Transaction failed: LOW_BALANCE".into()), "Transaction failed: LOW_BALANCE");
    }

    #[test]
    fn a_payment_state_says_which_network_contract_and_account_answered() {
        let c = NearConfig { network: "testnet".into(), account: "victor.testnet".into(), contract: "wallet.aftercall.testnet".into() };
        let asked = json!({ "network": "testnet", "account": "victor.testnet", "contract": "wallet.aftercall.testnet" });
        assert_eq!(payment_state_answer(&c, json!(false), &Value::Null), json!({ "paid": false, "pending": false, "asked": asked }));
        assert_eq!(payment_state_answer(&c, json!(false), &json!({ "amount": "5000000000" }))["pending"], true);
    }

    /// Read-only calls to testnet's RPC: `cargo test -- --ignored check_setup`.
    #[tokio::test]
    #[ignore]
    async fn check_setup_tells_a_missing_contract_from_a_wrong_one() {
        let c = |contract: &str| NearConfig { network: "testnet".into(), account: "victor.testnet".into(), contract: contract.into() };
        // No account at all; an account with no code; a contract without get_usdc (USDC itself).
        let none = check_setup(&c("no-such-aftercall-wallet.testnet")).await.unwrap();
        assert_eq!(none.contract, "missing");
        assert_eq!(check_setup(&c("victor.testnet")).await.unwrap().contract, "missing");
        assert_eq!(check_setup(&c(Network::Testnet.usdc())).await.unwrap().contract, "wrong");
    }

    #[test]
    fn new_testnet_names_follow_near_rules() {
        for ok in ["victor.testnet", "ada-lovelace.testnet", "a1_b2.testnet", "42.testnet", &format!("{}.testnet", "a".repeat(56))] {
            assert_eq!(new_testnet_name_problem(ok), None, "{ok}");
        }
        let problem = |id: &str| new_testnet_name_problem(id).unwrap();
        assert!(problem("victor.near").contains("ends in .testnet"));
        assert!(problem(".testnet").contains("Type a name"));
        assert!(problem("v.testnet").contains("at least 2"));
        assert!(problem(&format!("{}.testnet", "a".repeat(57))).contains("at most 56"));
        assert!(problem("me.victor.testnet").contains("no dots"));
        assert!(problem("Victor.testnet").contains("lowercase"));
        assert!(problem("vic tor.testnet").contains("can't be in a NEAR name"));
        assert!(problem("víctor.testnet").contains("can't be in a NEAR name"));
        for bad in ["-victor.testnet", "victor_.testnet", "vic--tor.testnet", "vic-_tor.testnet"] {
            assert!(problem(bad).contains("one at a time"), "{bad}");
        }
    }

    const PK: &str = "ed25519:6j4b6zUaty6fD1awqcGCCU9JYGCWYUgdJhQrzfZhqE25";

    /// The helper's reply as near-cli-rs reads it: an RPC transaction response.
    fn helper_reply(value: &[u8]) -> Value {
        use base64::Engine as _;
        json!({
            "final_execution_status": "EXECUTED",
            "status": { "SuccessValue": base64::engine::general_purpose::STANDARD.encode(value) },
            "transaction": { "hash": "HelperTx111" },
            "transaction_outcome": { "id": "HelperTx111", "outcome": { "tokens_burnt": "1" } },
        })
    }

    #[tokio::test]
    async fn creating_a_testnet_account_sends_the_name_and_key_and_reads_the_reply() {
        // A stub stands in for the helper: nothing is created anywhere.
        let sent = std::sync::Mutex::new(None);
        let created = create_testnet_account("ada.testnet", PK, |body| {
            *sent.lock().unwrap() = Some(body);
            async { Ok((200, helper_reply(b"true"))) }
        })
        .await
        .unwrap();
        assert_eq!(sent.into_inner().unwrap(), Some(json!({ "newAccountId": "ada.testnet", "newAccountPublicKey": PK })));
        assert_eq!(created, CreatedAccount { account_id: "ada.testnet".into(), tx_hash: Some("HelperTx111".into()), balance: None });
    }

    #[tokio::test]
    async fn a_refused_or_odd_helper_reply_is_an_error_in_words() {
        let reply = |status: u16, body: Value| move |_body: Value| async move { Ok((status, body)) };
        let taken = create_testnet_account("ada.testnet", PK, reply(200, helper_reply(b"false"))).await.unwrap_err();
        assert!(taken.contains("pick another"), "{taken}");
        let down = create_testnet_account("ada.testnet", PK, reply(500, Value::Null)).await.unwrap_err();
        assert!(down.contains("answered 500"), "{down}");
        let said = create_testnet_account("ada.testnet", PK, reply(400, json!("Account ada.testnet already exists"))).await.unwrap_err();
        assert!(said.ends_with("Account ada.testnet already exists"), "{said}");
        let odd = create_testnet_account("ada.testnet", PK, reply(200, json!({ "ok": true }))).await.unwrap_err();
        assert!(odd.contains("not with a transaction"), "{odd}");
        let failed = create_testnet_account("ada.testnet", PK, reply(200, json!({ "status": { "Failure": { "ActionError": {} } } }))).await.unwrap_err();
        assert!(failed.contains("refused"), "{failed}");
    }

    #[tokio::test]
    async fn nothing_is_sent_for_a_bad_name_or_key() {
        let never = |_body: Value| async { panic!("the helper must not be called") };
        assert!(create_testnet_account("Ada.testnet", PK, never).await.is_err());
        assert!(create_testnet_account("ada.near", PK, never).await.is_err());
        assert!(create_testnet_account("ada.testnet", "ed25519:short", never).await.is_err());
    }

    /// Read-only, against testnet's RPC: `cargo test -- --ignored name_free`.
    #[tokio::test]
    #[ignore]
    async fn name_free_reads_testnet() {
        assert_eq!(testnet_name_free("aftercall.testnet").await.unwrap(), false);
        assert!(testnet_name_free("Bad.testnet").await.is_err());
    }

    #[test]
    fn only_implicit_accounts_are_deposit_addresses() {
        assert!(is_deposit_address("69f5eccee1e146961b47ac7cecb0f5caada2b6e1ee124e72e8b47adedd701f74"));
        assert!(!is_deposit_address("69F5ECCEE1E146961B47AC7CECB0F5CAADA2B6E1EE124E72E8B47ADEDD701F74"));
        assert!(!is_deposit_address("attacker.near"));
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
