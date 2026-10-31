//! Network side of TEE attestation: the calls a web view can't make (no CORS) and
//! the Intel TDX quote check, which runs Phala's `dcap-qvl` (the original Rust
//! implementation NEAR's verifier wraps).
//!
//! The web view sends evidence it got from NEAR AI and gets back facts:
//! - a TDX quote's verification status and the fields NEAR binds into it,
//!   checked against collateral fetched from Intel's PCS;
//! - NVIDIA NRAS's answer for a GPU evidence payload, and NVIDIA's signing keys.
//!
//! Deciding what passes (report data, compose hash, JWT claims) is pure logic in
//! packages/core/src/tee, so the public Verify page can re-run the same code.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use dcap_qvl::QuoteCollateralV3;
use dcap_qvl::collateral::CollateralClient;
use serde::Serialize;

/// Intel's Provisioning Certification Service, as NEAR's verifier uses it.
pub const INTEL_PCS: &str = "https://api.trustedservices.intel.com/tdx/certification/v4";
const NRAS: &str = "https://nras.attestation.nvidia.com/v3/attest/gpu";
const NVIDIA_JWKS: &str = "https://nras.attestation.nvidia.com/.well-known/jwks.json";

/// A TDX quote is about 5 KB; anything far bigger isn't one.
const MAX_QUOTE_BYTES: usize = 64 * 1024;
/// NVIDIA evidence for 8 GPUs is roughly 100 KB of JSON.
const MAX_GPU_PAYLOAD: usize = 2 * 1024 * 1024;

/// What a verified quote says, hex-encoded.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuoteReport {
    /// Intel TCB status, e.g. "UpToDate" or "OutOfDate".
    pub status: String,
    pub advisory_ids: Vec<String>,
    pub report_data: String,
    pub mr_config_id: String,
    pub td_attributes: String,
    pub rt_mr3: String,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn decode_hex(s: &str) -> Result<Vec<u8>, String> {
    let s = s.trim().trim_start_matches("0x");
    if s.len() % 2 != 0 || !s.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("Not hex".into());
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|e| e.to_string())).collect()
}

/// Verifies `quote` against `collateral` at `now` (seconds). Fails on any broken
/// signature, certificate, CRL or expired collateral, and on debug TDs.
pub fn verify_quote_with(quote: &[u8], collateral: &QuoteCollateralV3, now: u64) -> Result<QuoteReport, String> {
    let verified = dcap_qvl::verify::verify(quote, collateral, now).map_err(|e| format!("{e:#}"))?;
    let td = verified.report.as_td10().ok_or("Not a TDX quote")?;
    Ok(QuoteReport {
        status: verified.status.clone(),
        advisory_ids: verified.advisory_ids.clone(),
        report_data: hex(&td.report_data),
        mr_config_id: hex(&td.mr_config_id),
        td_attributes: hex(&td.td_attributes),
        rt_mr3: hex(&td.rt_mr3),
    })
}

/// Fetches Intel's collateral for the quote and verifies it now.
pub async fn verify_quote(quote_hex: &str) -> Result<QuoteReport, String> {
    let quote = decode_hex(quote_hex)?;
    if quote.is_empty() || quote.len() > MAX_QUOTE_BYTES {
        return Err("That isn't a TDX quote".into());
    }
    let client = CollateralClient::with_default_http(INTEL_PCS).map_err(|e| e.to_string())?;
    let collateral = client.fetch(&quote).await.map_err(|e| format!("Intel PCS: {e:#}"))?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs();
    verify_quote_with(&quote, &collateral, now)
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(Duration::from_secs(60)).build().map_err(|e| e.to_string())
}

/// The GPU evidence must be a JSON object; it goes to NVIDIA unchanged.
pub fn check_gpu_payload(payload: &str) -> Result<(), String> {
    if payload.len() > MAX_GPU_PAYLOAD {
        return Err("GPU evidence is too large".into());
    }
    match serde_json::from_str::<serde_json::Value>(payload) {
        Ok(serde_json::Value::Object(_)) => Ok(()),
        _ => Err("GPU evidence isn't a JSON object".into()),
    }
}

/// POSTs NEAR's GPU evidence to NVIDIA NRAS and returns NRAS's answer as received.
pub async fn nvidia_attest(payload: String) -> Result<String, String> {
    check_gpu_payload(&payload)?;
    let res = client()?
        .post(NRAS)
        .header("content-type", "application/json")
        .header("accept", "application/json")
        .body(payload)
        .send()
        .await
        .map_err(|e| format!("NVIDIA NRAS: {e}"))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("NVIDIA NRAS {status}: {}", text.chars().take(300).collect::<String>()));
    }
    Ok(text)
}

/// NVIDIA's current NRAS signing keys (JWKS).
pub async fn nvidia_keys() -> Result<String, String> {
    let res = client()?.get(NVIDIA_JWKS).send().await.map_err(|e| format!("NVIDIA keys: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("NVIDIA keys {}", res.status()));
    }
    res.text().await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_round_trips() {
        assert_eq!(decode_hex("0x00ff10").unwrap(), vec![0, 255, 16]);
        assert_eq!(hex(&[0, 255, 16]), "00ff10");
        assert!(decode_hex("abc").is_err());
        assert!(decode_hex("zz").is_err());
    }

    #[test]
    fn gpu_payload_must_be_an_object() {
        assert!(check_gpu_payload(r#"{"nonce":"ab","evidence_list":[]}"#).is_ok());
        assert!(check_gpu_payload("[1,2]").is_err());
        assert!(check_gpu_payload("not json").is_err());
    }
}
