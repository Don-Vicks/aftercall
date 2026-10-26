//! Minimal NEAR client for the Aftercall app's limited key: build, sign and send
//! function-call transactions, and call view methods, over JSON-RPC.
//!
//! The app's key is a function-call access key on the user's account that may only
//! call `pay` and `record_proof` on the agent-wallet contract, so this crate never
//! needs any other action. Borsh layout follows nearcore's `Transaction` (V0) and
//! `SignedTransaction`.

use base64::Engine as _;
use ed25519_dalek::{Signer, SigningKey};
use rand_core::OsRng;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub type Error = String;

// ---------- keys ----------

/// An ed25519 key pair in NEAR's string formats.
#[derive(Clone)]
pub struct KeyPair(SigningKey);

impl KeyPair {
    pub fn generate() -> Self {
        Self(SigningKey::generate(&mut OsRng))
    }

    /// "ed25519:<base58 of the 64-byte secret+public>", as near-cli stores it.
    pub fn from_secret(secret: &str) -> Result<Self, Error> {
        let data = secret.strip_prefix("ed25519:").ok_or("Secret key must start with ed25519:")?;
        let bytes = bs58::decode(data).into_vec().map_err(|e| e.to_string())?;
        if bytes.len() != 64 && bytes.len() != 32 {
            return Err("Bad secret key length".into());
        }
        let seed: [u8; 32] = bytes[..32].try_into().map_err(|_| "Bad secret key")?;
        let key = SigningKey::from_bytes(&seed);
        if bytes.len() == 64 && bytes[32..] != key.verifying_key().to_bytes() {
            return Err("Secret key and its public half don't match".into());
        }
        Ok(Self(key))
    }

    pub fn secret(&self) -> String {
        let mut b = self.0.to_bytes().to_vec();
        b.extend_from_slice(&self.0.verifying_key().to_bytes());
        format!("ed25519:{}", bs58::encode(b).into_string())
    }

    pub fn public_key(&self) -> String {
        format!("ed25519:{}", bs58::encode(self.0.verifying_key().to_bytes()).into_string())
    }

    fn public_bytes(&self) -> [u8; 32] {
        self.0.verifying_key().to_bytes()
    }
}

// ---------- NEP-413 ----------

/// NEP-413 "sign in with NEAR": signs sha256(tag ++ borsh(message, nonce, recipient, None)).
/// Returns the signature as base64, as wallets do.
pub fn sign_message(key: &KeyPair, message: &str, nonce: &[u8; 32], recipient: &str) -> String {
    let mut b = Borsh::default();
    b.u32((1u32 << 31) + 413).string(message).raw(nonce).string(recipient).u8(0);
    let hash: [u8; 32] = Sha256::digest(&b.0).into();
    base64::engine::general_purpose::STANDARD.encode(key.0.sign(&hash).to_bytes())
}

// ---------- borsh ----------

#[derive(Default)]
struct Borsh(Vec<u8>);

impl Borsh {
    fn u8(&mut self, v: u8) -> &mut Self {
        self.0.push(v);
        self
    }
    fn u32(&mut self, v: u32) -> &mut Self {
        self.0.extend_from_slice(&v.to_le_bytes());
        self
    }
    fn u64(&mut self, v: u64) -> &mut Self {
        self.0.extend_from_slice(&v.to_le_bytes());
        self
    }
    fn u128(&mut self, v: u128) -> &mut Self {
        self.0.extend_from_slice(&v.to_le_bytes());
        self
    }
    fn bytes(&mut self, v: &[u8]) -> &mut Self {
        self.u32(v.len() as u32);
        self.0.extend_from_slice(v);
        self
    }
    fn string(&mut self, v: &str) -> &mut Self {
        self.bytes(v.as_bytes())
    }
    fn raw(&mut self, v: &[u8]) -> &mut Self {
        self.0.extend_from_slice(v);
        self
    }
}

const KEY_TYPE_ED25519: u8 = 0;
const ACTION_FUNCTION_CALL: u8 = 2;

pub struct FunctionCall {
    pub method_name: String,
    pub args: Vec<u8>,
    pub gas: u64,
    /// yoctoNEAR. A function-call key can only send 0.
    pub deposit: u128,
}

/// Borsh bytes of a V0 transaction with one FunctionCall action.
pub fn transaction_bytes(signer: &str, key: &KeyPair, nonce: u64, receiver: &str, block_hash: &[u8; 32], call: &FunctionCall) -> Vec<u8> {
    let mut b = Borsh::default();
    b.string(signer)
        .u8(KEY_TYPE_ED25519)
        .raw(&key.public_bytes())
        .u64(nonce)
        .string(receiver)
        .raw(block_hash)
        .u32(1) // one action
        .u8(ACTION_FUNCTION_CALL)
        .string(&call.method_name)
        .bytes(&call.args)
        .u64(call.gas)
        .u128(call.deposit);
    b.0
}

/// Signs a transaction; returns (base64 signed transaction, transaction hash in base58).
pub fn sign(tx: &[u8], key: &KeyPair) -> (String, String) {
    let hash: [u8; 32] = Sha256::digest(tx).into();
    let signature = key.0.sign(&hash).to_bytes();
    let mut b = Borsh::default();
    b.raw(tx).u8(KEY_TYPE_ED25519).raw(&signature);
    (base64::engine::general_purpose::STANDARD.encode(b.0), bs58::encode(hash).into_string())
}

// ---------- RPC ----------

pub struct Client {
    url: String,
    http: reqwest::Client,
}

#[derive(Deserialize)]
struct RpcResponse {
    result: Option<Value>,
    error: Option<Value>,
}

/// The outcome of a sent transaction.
#[derive(Debug, Clone)]
pub struct Outcome {
    pub tx_hash: String,
    /// The method's return value (JSON) when it succeeded.
    pub value: Option<Value>,
}

impl Client {
    pub fn new(url: impl Into<String>) -> Self {
        Self { url: url.into(), http: reqwest::Client::new() }
    }

    pub fn testnet() -> Self {
        Self::new("https://rpc.testnet.near.org")
    }

    pub fn mainnet() -> Self {
        Self::new("https://rpc.mainnet.near.org")
    }

    async fn rpc(&self, method: &str, params: Value) -> Result<Value, Error> {
        let res: RpcResponse = self
            .http
            .post(&self.url)
            .json(&json!({ "jsonrpc": "2.0", "id": "aftercall", "method": method, "params": params }))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        match (res.result, res.error) {
            (Some(r), _) => Ok(r),
            (None, Some(e)) => Err(rpc_error(&e)),
            _ => Err("Empty RPC response".into()),
        }
    }

    /// The key's permission ("FullAccess" or the FunctionCall details) and nonce, or None if absent.
    pub async fn access_key(&self, account: &str, public_key: &str) -> Result<Option<Value>, Error> {
        // Optimistic: a key added moments ago (and the latest nonce) must be visible.
        match self
            .rpc("query", json!({ "request_type": "view_access_key", "finality": "optimistic", "account_id": account, "public_key": public_key }))
            .await
        {
            // Some nodes report a missing key inside the result instead of as an RPC error.
            Ok(v) if v.get("error").is_some() => {
                let e = v["error"].to_string();
                if e.contains("does not exist") { Ok(None) } else { Err(e) }
            }
            Ok(v) => Ok(Some(v)),
            Err(e) if e.contains("UNKNOWN_ACCESS_KEY") || e.contains("does not exist") => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Whether an account exists.
    pub async fn account_exists(&self, account: &str) -> Result<bool, Error> {
        match self.rpc("query", json!({ "request_type": "view_account", "finality": "optimistic", "account_id": account })).await {
            Ok(_) => Ok(true),
            Err(e) if e.contains("UNKNOWN_ACCOUNT") || e.contains("does not exist") => Ok(false),
            Err(e) => Err(e),
        }
    }

    /// Calls a view method and parses its JSON result.
    pub async fn view(&self, contract: &str, method: &str, args: &Value) -> Result<Value, Error> {
        let args = base64::engine::general_purpose::STANDARD.encode(args.to_string());
        let r = self
            .rpc("query", json!({ "request_type": "call_function", "finality": "optimistic", "account_id": contract, "method_name": method, "args_base64": args }))
            .await?;
        let bytes: Vec<u8> = serde_json::from_value(r["result"].clone()).map_err(|e| e.to_string())?;
        serde_json::from_slice(&bytes).map_err(|e| e.to_string())
    }

    /// Signs and sends one function call, waiting until it has executed.
    pub async fn call(&self, signer: &str, key: &KeyPair, receiver: &str, call: FunctionCall) -> Result<Outcome, Error> {
        let access = self.access_key(signer, &key.public_key()).await?.ok_or("This app's key isn't on the account yet")?;
        let nonce = access["nonce"].as_u64().ok_or_else(|| format!("No nonce on access key: {access}"))? + 1;
        let block_hash: [u8; 32] = bs58::decode(access["block_hash"].as_str().ok_or("No block hash")?)
            .into_vec()
            .map_err(|e| e.to_string())?
            .try_into()
            .map_err(|_| "Bad block hash")?;
        let tx = transaction_bytes(signer, key, nonce, receiver, &block_hash, &call);
        let (signed, tx_hash) = sign(&tx, key);
        let r = self.rpc("send_tx", json!({ "signed_tx_base64": signed, "wait_until": "EXECUTED_OPTIMISTIC" })).await?;
        let status = &r["status"];
        if let Some(failure) = status.get("Failure") {
            return Err(format!("Transaction failed: {}", failure_message(failure)));
        }
        let value = status
            .get("SuccessValue")
            .and_then(|v| v.as_str())
            .and_then(|b64| base64::engine::general_purpose::STANDARD.decode(b64).ok())
            .and_then(|bytes| serde_json::from_slice(&bytes).ok());
        Ok(Outcome { tx_hash, value })
    }
}

fn rpc_error(e: &Value) -> String {
    let cause = e.pointer("/cause/name").and_then(|v| v.as_str()).unwrap_or("");
    let data = e.get("data").map(|d| d.to_string()).unwrap_or_default();
    format!("RPC error {cause} {data}").trim().to_string()
}

/// Pulls the contract's panic message ("ALREADY_PAID", "PROOF_EXISTS"...) out of a failure.
fn failure_message(f: &Value) -> String {
    f.pointer("/ActionError/kind/FunctionCallError/ExecutionError")
        .and_then(|v| v.as_str())
        .map(|s| s.trim_start_matches("Smart contract panicked: ").to_string())
        .unwrap_or_else(|| f.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_round_trip_in_near_formats() {
        let k = KeyPair::generate();
        let again = KeyPair::from_secret(&k.secret()).unwrap();
        assert_eq!(again.public_key(), k.public_key());
        assert!(k.public_key().starts_with("ed25519:"));
        assert!(KeyPair::from_secret("secp256k1:abc").is_err());
    }

    #[test]
    fn transaction_layout_matches_nearcore() {
        // Fixed key (seed of 32 x 0x01) so the bytes are reproducible.
        let key = KeyPair(SigningKey::from_bytes(&[1u8; 32]));
        let call = FunctionCall { method_name: "record_proof".into(), args: br#"{"a":1}"#.to_vec(), gas: 30_000_000_000_000, deposit: 0 };
        let tx = transaction_bytes("v.testnet", &key, 7, "w.testnet", &[9u8; 32], &call);

        let mut expected = vec![9, 0, 0, 0];
        expected.extend_from_slice(b"v.testnet");
        expected.push(0);
        expected.extend_from_slice(&key.public_bytes());
        expected.extend_from_slice(&7u64.to_le_bytes());
        expected.extend_from_slice(&[9, 0, 0, 0]);
        expected.extend_from_slice(b"w.testnet");
        expected.extend_from_slice(&[9u8; 32]);
        expected.extend_from_slice(&[1, 0, 0, 0, 2]);
        expected.extend_from_slice(&[12, 0, 0, 0]);
        expected.extend_from_slice(b"record_proof");
        expected.extend_from_slice(&[7, 0, 0, 0]);
        expected.extend_from_slice(br#"{"a":1}"#);
        expected.extend_from_slice(&30_000_000_000_000u64.to_le_bytes());
        expected.extend_from_slice(&0u128.to_le_bytes());
        assert_eq!(tx, expected);

        let (signed, hash) = sign(&tx, &key);
        let raw = base64::engine::general_purpose::STANDARD.decode(signed).unwrap();
        assert_eq!(raw.len(), tx.len() + 1 + 64);
        assert_eq!(hash, bs58::encode(Sha256::digest(&tx)).into_string());
    }
}

#[cfg(test)]
mod nep413_tests {
    use super::*;

    #[test]
    fn signs_the_nep413_payload() {
        let key = KeyPair(SigningKey::from_bytes(&[2u8; 32]));
        let sig = sign_message(&key, "Sign in to Aftercall", &[7u8; 32], "aftercall");
        let raw = base64::engine::general_purpose::STANDARD.decode(&sig).unwrap();
        assert_eq!(raw.len(), 64);
        // Print a vector for the cross-check against the backend's TypeScript verifier.
        println!("NEP413_VECTOR {} {}", key.public_key(), sig);
    }
}
