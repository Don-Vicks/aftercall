//! Intel TDX quote verification with dcap-qvl, offline.
//!
//! Fixtures: `tdx_quote` and `tdx_quote_collateral.json` are the sample TDX quote
//! and the Intel collateral captured for it, from Phala's dcap-qvl repository
//! (MIT, https://github.com/Phala-Network/dcap-qvl/tree/master/sample).

use aftercall_desktop_lib::test_api::{decode_hex, verify_quote_with};

const QUOTE: &[u8] = include_bytes!("fixtures/tdx_quote");

fn collateral() -> dcap_qvl::QuoteCollateralV3 {
    serde_json::from_slice(include_bytes!("fixtures/tdx_quote_collateral.json")).unwrap()
}

/// 2025-06-20 00:00 UTC: inside the collateral's validity window.
const WHEN_ISSUED: u64 = 1_750_377_600;

#[test]
fn a_genuine_quote_verifies_against_intel_collateral() {
    let report = verify_quote_with(QUOTE, &collateral(), WHEN_ISSUED).unwrap();
    assert_eq!(report.status, "UpToDate");
    assert!(report.advisory_ids.is_empty());
    assert_eq!(report.report_data.len(), 128, "64 bytes of report data");
    assert_eq!(report.mr_config_id.len(), 96, "48 bytes of mr_config_id");
    assert_eq!(report.rt_mr3.len(), 96);
    assert_eq!(decode_hex(&report.td_attributes).unwrap()[0] & 1, 0, "not a debug TD");
}

#[test]
fn a_tampered_quote_fails() {
    // Flip one bit of report data (TD report body starts after the 48-byte header;
    // report data is its last 64 bytes): the quote signature no longer matches.
    let mut quote = QUOTE.to_vec();
    quote[48 + 520] ^= 1;
    assert!(verify_quote_with(&quote, &collateral(), WHEN_ISSUED).is_err());
}

#[test]
fn expired_collateral_fails() {
    // 2026-10-31: Intel's TCB info for this quote expired in July 2025.
    assert!(verify_quote_with(QUOTE, &collateral(), 1_793_404_800).is_err());
}

#[test]
fn garbage_is_not_a_quote() {
    assert!(verify_quote_with(b"not a quote", &collateral(), WHEN_ISSUED).is_err());
}

/// Live: fetches today's collateral for the sample quote from Intel's PCS and
/// NVIDIA's NRAS keys. Run with `cargo test -- --ignored live_`.
#[tokio::test]
#[ignore]
async fn live_intel_pcs_and_nvidia_keys() {
    let hex: String = QUOTE.iter().map(|b| format!("{b:02x}")).collect();
    match aftercall_desktop_lib::test_api::verify_quote(&hex).await {
        Ok(report) => println!("Intel PCS: verified, TCB status {}", report.status),
        // The sample platform's TCB may since have been revoked; the call still reached Intel.
        Err(e) => {
            println!("Intel PCS: {e}");
            assert!(!e.starts_with("Intel PCS:"), "collateral fetch failed: {e}");
        }
    }
    let keys = aftercall_desktop_lib::test_api::nvidia_keys().await.unwrap();
    assert!(keys.contains("\"P-384\""));
}
