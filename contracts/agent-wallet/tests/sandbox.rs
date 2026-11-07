//! Sandbox tests: the agent wallet and a USDC-like token deployed on a local NEAR node.
//! Run from contracts/: cargo test -p agent-wallet --test sandbox -- --test-threads=1

use near_workspaces::network::Sandbox;
use near_workspaces::types::{AccessKey, NearToken, SecretKey};
use near_workspaces::{Account, Contract, Worker};
use serde_json::json;

const USDC: u128 = 1_000_000; // 6 decimals

struct Env {
    worker: Worker<Sandbox>,
    /// The agent-wallet code, to deploy a second copy.
    wallet_wasm: Vec<u8>,
    wallet: Contract,
    usdc: Contract,
    victor: Account,
    designer: Account,
}

async fn setup() -> anyhow::Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let wallet_wasm = near_workspaces::compile_project("./").await?;
    let ft_wasm = near_workspaces::compile_project("../mock-ft").await?;

    let root = worker.root_account()?;
    let victor = root.create_subaccount("victor").initial_balance(NearToken::from_near(20)).transact().await?.into_result()?;
    let designer = root.create_subaccount("designer").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;

    let usdc = worker.dev_deploy(&ft_wasm).await?;
    usdc.call("new")
        .args_json(json!({ "owner_id": victor.id(), "total_supply": (1_000_000 * USDC).to_string() }))
        .transact().await?.into_result()?;

    let wallet = worker.dev_deploy(&wallet_wasm).await?;
    // Only the contract account itself may initialise it (`new` is private).
    wallet.call("new").args_json(json!({ "usdc": usdc.id() })).transact().await?.into_result()?;

    // The wallet contract and the payee must be registered on the token.
    for id in [wallet.id(), designer.id()] {
        victor.call(usdc.id(), "storage_deposit")
            .args_json(json!({ "account_id": id }))
            .deposit(NearToken::from_millinear(125))
            .transact().await?.into_result()?;
    }

    // Victor registers, sets a 200 USDC cap, adds Designer, deposits 300 USDC.
    victor.call(wallet.id(), "register").deposit(NearToken::from_millinear(100)).transact().await?.into_result()?;
    victor.call(wallet.id(), "set_cap").args_json(json!({ "daily_cap": (200 * USDC).to_string() }))
        .deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    victor.call(wallet.id(), "add_payee").args_json(json!({ "payee": designer.id(), "label": "Designer" }))
        .deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    victor.call(usdc.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": wallet.id(), "amount": (300 * USDC).to_string(), "msg": "" }))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;

    Ok(Env { worker, wallet_wasm, wallet, usdc, victor, designer })
}

async fn ft_balance(e: &Env, who: &Account) -> anyhow::Result<u128> {
    let v: String = e.usdc.view("ft_balance_of").args_json(json!({ "account_id": who.id() })).await?.json()?;
    Ok(v.parse()?)
}

async fn wallet_field(e: &Env, field: &str) -> anyhow::Result<u128> {
    let w: serde_json::Value = e.wallet.view("get_wallet").args_json(json!({ "owner": e.victor.id() })).await?.json()?;
    Ok(w[field].as_str().unwrap().parse()?)
}

async fn pay(e: &Env, signer: &Account, amount: u128, followup_id: &str) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    Ok(signer.call(e.wallet.id(), "pay")
        .args_json(json!({ "payee": e.designer.id(), "amount": amount.to_string(), "memo": "deposit", "followup_id": followup_id }))
        .gas(near_workspaces::types::Gas::from_tgas(100))
        .transact().await?)
}

/// The methods the desktop app's key may call (packages/core `APP_KEY_METHODS`).
const APP_KEY_METHODS: [&str; 4] = ["pay", "record_proof", "open_escrow", "release_escrow"];
/// What a key added before Handshake may call.
const OLD_KEY_METHODS: [&str; 2] = ["pay", "record_proof"];

/// Adds a function-call key to Victor's account that may only call the app's methods,
/// and returns Victor's account signing with that limited key (what the desktop app holds).
async fn limited_key(e: &Env) -> anyhow::Result<Account> {
    key_for(&e.worker, &e.victor, &e.wallet, &APP_KEY_METHODS).await
}

async fn key_for(worker: &Worker<Sandbox>, owner: &Account, wallet: &Contract, methods: &[&str]) -> anyhow::Result<Account> {
    let sk = SecretKey::from_random(near_workspaces::types::KeyType::ED25519);
    owner.batch(owner.id())
        .add_key(sk.public_key(), AccessKey::function_call_access(wallet.id(), methods, Some(NearToken::from_millinear(250))))
        .transact().await?.into_result()?;
    Ok(Account::from_secret_key(owner.id().clone(), sk, worker))
}

#[tokio::test]
async fn deposit_credits_owner_and_refunds_unregistered() -> anyhow::Result<()> {
    let e = setup().await?;
    assert_eq!(wallet_field(&e, "balance").await?, 300 * USDC);

    // Designer isn't registered with the wallet: their deposit comes straight back.
    e.victor.call(e.usdc.id(), "ft_transfer").args_json(json!({ "receiver_id": e.designer.id(), "amount": (10 * USDC).to_string() }))
        .deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    e.designer.call(e.usdc.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": e.wallet.id(), "amount": (10 * USDC).to_string(), "msg": "" }))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    assert_eq!(ft_balance(&e, &e.designer).await?, 10 * USDC);
    Ok(())
}

#[tokio::test]
async fn fake_token_cannot_credit() -> anyhow::Result<()> {
    let e = setup().await?;
    let r = e.victor.call(e.wallet.id(), "ft_on_transfer")
        .args_json(json!({ "sender_id": e.victor.id(), "amount": (1_000 * USDC).to_string(), "msg": "" }))
        .transact().await?;
    assert!(r.is_failure(), "ft_on_transfer from a non-USDC caller must fail");
    assert!(format!("{:?}", r.into_result().unwrap_err()).contains("ONLY_USDC"));
    assert_eq!(wallet_field(&e, "balance").await?, 300 * USDC);
    Ok(())
}

#[tokio::test]
async fn limited_key_pays_within_cap() -> anyhow::Result<()> {
    let e = setup().await?;
    let app = limited_key(&e).await?;
    let r = pay(&e, &app, 50 * USDC, "f-1").await?;
    assert!(r.is_success(), "{:?}", r.failures());
    let out: serde_json::Value = r.json()?;
    assert_eq!(out["status"], "sending");
    assert_eq!(ft_balance(&e, &e.designer).await?, 50 * USDC);
    assert_eq!(wallet_field(&e, "balance").await?, 250 * USDC);
    assert_eq!(wallet_field(&e, "spent_today").await?, 50 * USDC);

    // The same follow-up can never pay twice.
    let again = pay(&e, &app, 50 * USDC, "f-1").await?;
    assert!(format!("{:?}", again.into_result().unwrap_err()).contains("ALREADY_PAID"));
    Ok(())
}

#[tokio::test]
async fn over_cap_is_blocked_then_owner_approves() -> anyhow::Result<()> {
    let e = setup().await?;
    let app = limited_key(&e).await?;
    let r = pay(&e, &app, 250 * USDC, "f-big").await?;
    assert!(r.is_success(), "{:?}", r.failures());
    let out: serde_json::Value = r.json()?;
    assert_eq!(out["status"], "blocked");
    assert_eq!(out["reason"], "OVER_CAP");
    assert_eq!(ft_balance(&e, &e.designer).await?, 0);

    // The limited key cannot approve it (needs 1 yocto, which a function-call key can't attach).
    let by_app = app.call(e.wallet.id(), "approve_pending").args_json(json!({ "followup_id": "f-big" }))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await;
    assert!(by_app.is_err() || by_app.unwrap().is_failure());

    // The owner's wallet (full-access key) approves it.
    let ok = e.victor.call(e.wallet.id(), "approve_pending").args_json(json!({ "followup_id": "f-big" }))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
    assert!(ok.is_success(), "{:?}", ok.failures());
    assert_eq!(ft_balance(&e, &e.designer).await?, 250 * USDC);
    Ok(())
}

#[tokio::test]
async fn limited_key_cannot_change_rules() -> anyhow::Result<()> {
    let e = setup().await?;
    let app = limited_key(&e).await?;
    for (method, args) in [
        ("set_cap", json!({ "daily_cap": (1_000_000 * USDC).to_string() })),
        ("add_payee", json!({ "payee": "attacker.near", "label": "x" })),
        ("withdraw", json!({ "amount": (300 * USDC).to_string() })),
        ("set_paused", json!({ "paused": false })),
        ("approve_escrow", json!({ "escrow_id": "e-1" })),
        ("cancel_escrow", json!({ "escrow_id": "e-1" })),
    ] {
        // Outside the key's method list: rejected before it runs.
        let r = app.call(e.wallet.id(), method).args_json(args.clone()).deposit(NearToken::from_yoctonear(1)).transact().await;
        assert!(r.is_err() || r.unwrap().is_failure(), "{method} with limited key must fail");
    }
    assert_eq!(wallet_field(&e, "daily_cap").await?, 200 * USDC);
    assert_eq!(wallet_field(&e, "balance").await?, 300 * USDC);
    Ok(())
}

#[tokio::test]
async fn refuses_unknown_payee_low_balance_and_paused() -> anyhow::Result<()> {
    let e = setup().await?;
    let app = limited_key(&e).await?;

    let unknown = app.call(e.wallet.id(), "pay")
        .args_json(json!({ "payee": e.usdc.id(), "amount": USDC.to_string(), "followup_id": "f-u" }))
        .gas(near_workspaces::types::Gas::from_tgas(100)).transact().await?;
    assert!(format!("{:?}", unknown.into_result().unwrap_err()).contains("UNKNOWN_PAYEE"));

    // Under the caps, more than the balance is refused. (Over a cap it would be parked: the
    // balance is checked when the owner approves.)
    e.victor.call(e.wallet.id(), "set_cap").args_json(json!({ "daily_cap": (1_000 * USDC).to_string() }))
        .deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    let low = pay(&e, &app, 301 * USDC, "f-low").await?;
    assert!(format!("{:?}", low.into_result().unwrap_err()).contains("LOW_BALANCE"));

    e.victor.call(e.wallet.id(), "set_paused").args_json(json!({ "paused": true }))
        .deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    let paused = pay(&e, &app, USDC, "f-p").await?;
    assert!(format!("{:?}", paused.into_result().unwrap_err()).contains("PAUSED"));
    Ok(())
}

#[tokio::test]
async fn failed_transfer_refunds_everything() -> anyhow::Result<()> {
    let e = setup().await?;
    let app = limited_key(&e).await?;
    // A listed payee who never registered on the token: ft_transfer will fail.
    let root = e.worker.root_account()?;
    let unregistered = root.create_subaccount("newbie").initial_balance(NearToken::from_near(1)).transact().await?.into_result()?;
    e.victor.call(e.wallet.id(), "add_payee").args_json(json!({ "payee": unregistered.id(), "label": "Newbie" }))
        .deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;

    let r = app.call(e.wallet.id(), "pay")
        .args_json(json!({ "payee": unregistered.id(), "amount": (40 * USDC).to_string(), "followup_id": "f-fail" }))
        .gas(near_workspaces::types::Gas::from_tgas(100)).transact().await?;
    assert!(r.logs().iter().any(|l| l.contains("PAYMENT_FAILED")), "logs: {:?}", r.logs());
    assert_eq!(wallet_field(&e, "balance").await?, 300 * USDC);
    assert_eq!(wallet_field(&e, "spent_today").await?, 0);
    let paid: bool = e.wallet.view("is_paid").args_json(json!({ "owner": e.victor.id(), "followup_id": "f-fail" })).await?.json()?;
    assert!(!paid, "a failed payment must be retryable");
    let stats: serde_json::Value = e.wallet.view("get_stats").await?.json()?;
    assert_eq!(stats["payments"], 0, "a refunded payment isn't counted");
    Ok(())
}

#[tokio::test]
async fn callbacks_and_init_are_private() -> anyhow::Result<()> {
    let e = setup().await?;
    let amount = (1_000 * USDC).to_string();
    for (method, args) in [
        ("on_pay_complete", json!({ "owner": e.victor.id(), "followup_id": "x", "amount": amount, "day": 0, "cross_chain": false })),
        ("on_withdraw_complete", json!({ "owner": e.victor.id(), "amount": amount })),
        ("on_deposit_address_registered", json!({ "owner": e.victor.id(), "followup_id": "x", "amount": amount, "day": 0, "deposit_address": DEPOSIT })),
        ("on_escrow_released", json!({ "owner": e.victor.id(), "escrow_id": "x" })),
    ] {
        let r = e.victor.call(e.wallet.id(), method).args_json(args).max_gas().transact().await?;
        assert!(r.is_failure(), "anyone calling {method} must fail");
    }
    assert_eq!(wallet_field(&e, "balance").await?, 300 * USDC);

    // A deployed but not yet initialised copy can't be initialised by someone else first.
    let fresh = e.worker.dev_deploy(&e.wallet_wasm).await?;
    let front_run = e.victor.call(fresh.id(), "new").args_json(json!({ "usdc": e.victor.id() })).transact().await?;
    assert!(format!("{:?}", front_run.into_result().unwrap_err()).contains("is private"));
    fresh.call("new").args_json(json!({ "usdc": e.usdc.id() })).transact().await?.into_result()?;
    let usdc: String = fresh.view("get_usdc").await?.json()?;
    assert_eq!(usdc, e.usdc.id().as_str());
    Ok(())
}

#[tokio::test]
async fn proofs_are_charged_and_never_overwritten() -> anyhow::Result<()> {
    let e = setup().await?;
    let app = limited_key(&e).await?;
    let credit_before = wallet_field(&e, "storage_credit").await?;
    app.call(e.wallet.id(), "record_proof")
        .args_json(json!({ "meeting_id": "m-1", "proof_hash": "9f3a00c21e", "model": "Qwen/Qwen3.8-27B" }))
        .transact().await?.into_result()?;
    assert!(wallet_field(&e, "storage_credit").await? < credit_before, "proof storage is charged to the user");

    let again = app.call(e.wallet.id(), "record_proof")
        .args_json(json!({ "meeting_id": "m-1", "proof_hash": "different", "model": "x" }))
        .transact().await?;
    assert!(format!("{:?}", again.into_result().unwrap_err()).contains("PROOF_EXISTS"));
    let proof: serde_json::Value = e.wallet.view("get_proof").args_json(json!({ "owner": e.victor.id(), "meeting_id": "m-1" })).await?.json()?;
    assert_eq!(proof["proof_hash"], "9f3a00c21e");
    Ok(())
}

#[tokio::test]
async fn one_yocto_rule_holds_even_if_key_lists_owner_methods() -> anyhow::Result<()> {
    let e = setup().await?;
    // A badly scoped key that is *allowed* to call set_cap and withdraw.
    let sk = SecretKey::from_random(near_workspaces::types::KeyType::ED25519);
    e.victor.batch(e.victor.id())
        .add_key(sk.public_key(), AccessKey::function_call_access(
            e.wallet.id(), &["set_cap", "withdraw"], Some(NearToken::from_millinear(250))))
        .transact().await?.into_result()?;
    let bad = Account::from_secret_key(e.victor.id().clone(), sk, &e.worker);

    // With the 1 yocto the method demands: the protocol refuses a deposit from a function-call key.
    let with_deposit = bad.call(e.wallet.id(), "set_cap").args_json(json!({ "daily_cap": "1" }))
        .deposit(NearToken::from_yoctonear(1)).transact().await;
    assert!(with_deposit.is_err() || with_deposit.unwrap().is_failure());
    // Without it: the contract refuses (assert_one_yocto).
    let without = bad.call(e.wallet.id(), "withdraw").args_json(json!({ "amount": (300 * USDC).to_string() }))
        .transact().await?;
    assert!(without.is_failure());
    assert_eq!(wallet_field(&e, "daily_cap").await?, 200 * USDC);
    assert_eq!(wallet_field(&e, "balance").await?, 300 * USDC);
    Ok(())
}

#[tokio::test]
async fn per_payment_cap_parks_big_single_payments() -> anyhow::Result<()> {
    let e = setup().await?;
    let app = limited_key(&e).await?;
    // Per-payment cap: 50 USDC (daily cap is 200). It limits every payment the app's key sends, approved in the app or by autopilot.
    e.victor.call(e.wallet.id(), "set_payment_cap").args_json(json!({ "per_payment_cap": (50 * USDC).to_string() }))
        .deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;

    let small = pay(&e, &app, 50 * USDC, "pp-1").await?;
    assert_eq!(small.json::<serde_json::Value>()?["status"], "sending");

    // 60 is under the daily cap but over the per-payment cap: parked, not paid.
    let big = pay(&e, &app, 60 * USDC, "pp-2").await?;
    let out: serde_json::Value = big.json()?;
    assert_eq!(out["status"], "blocked");
    assert_eq!(out["reason"], "OVER_PAYMENT_CAP");
    assert_eq!(ft_balance(&e, &e.designer).await?, 50 * USDC);

    // The limited key can't raise or turn off its own cap (0 would turn it off).
    let raise = app.call(e.wallet.id(), "set_payment_cap").args_json(json!({ "per_payment_cap": "0" }))
        .deposit(NearToken::from_yoctonear(1)).transact().await;
    assert!(raise.is_err() || raise.unwrap().is_failure());
    Ok(())
}

#[tokio::test]
async fn owner_can_decline_a_blocked_payment() -> anyhow::Result<()> {
    let e = setup().await?;
    let app = limited_key(&e).await?;
    let r = pay(&e, &app, 250 * USDC, "f-no").await?;
    assert_eq!(r.json::<serde_json::Value>()?["status"], "blocked");

    // The app's key can't decline on the owner's behalf.
    let by_app = app.call(e.wallet.id(), "cancel_pending").args_json(json!({ "followup_id": "f-no" }))
        .deposit(NearToken::from_yoctonear(1)).transact().await;
    assert!(by_app.is_err() || by_app.unwrap().is_failure());

    e.victor.call(e.wallet.id(), "cancel_pending").args_json(json!({ "followup_id": "f-no" }))
        .deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    let pending: Option<serde_json::Value> = e.wallet.view("get_pending")
        .args_json(json!({ "owner": e.victor.id(), "followup_id": "f-no" })).await?.json()?;
    assert!(pending.is_none());
    assert_eq!(ft_balance(&e, &e.designer).await?, 0);
    assert_eq!(wallet_field(&e, "balance").await?, 300 * USDC);
    Ok(())
}

/// The desktop app's own signer (crates/near-tx) talking to a real NEAR node:
/// a limited key it generated records a proof and pays, and can't do anything else.
#[tokio::test]
async fn app_signer_records_proofs_and_pays_over_rpc() -> anyhow::Result<()> {
    let e = setup().await?;
    let app_key = near_tx::KeyPair::generate();
    let pk: near_workspaces::types::PublicKey = app_key.public_key().parse()?;
    e.victor.batch(e.victor.id())
        .add_key(pk, AccessKey::function_call_access(e.wallet.id(), &APP_KEY_METHODS, Some(NearToken::from_millinear(250))))
        .transact().await?.into_result()?;

    let rpc = near_tx::Client::new(e.worker.rpc_addr());
    let victor = e.victor.id().as_str();
    let wallet = e.wallet.id().as_str();
    let gas = 50_000_000_000_000u64;

    let proof = rpc.call(victor, &app_key, wallet, near_tx::FunctionCall {
        method_name: "record_proof".into(),
        args: json!({ "meeting_id": "1793006441", "proof_hash": "ab".repeat(32), "model": "Qwen/Qwen3.8-27B" }).to_string().into_bytes(),
        gas,
        deposit: 0,
    }).await.map_err(anyhow::Error::msg)?;
    assert!(!proof.tx_hash.is_empty());
    let stored = rpc.view(wallet, "get_proof", &json!({ "owner": victor, "meeting_id": "1793006441" })).await.map_err(anyhow::Error::msg)?;
    assert_eq!(stored["proof_hash"], "ab".repeat(32));

    // The same proof can't be recorded twice, and the error says why.
    let again = rpc.call(victor, &app_key, wallet, near_tx::FunctionCall {
        method_name: "record_proof".into(),
        args: json!({ "meeting_id": "1793006441", "proof_hash": "cd".repeat(32), "model": "x" }).to_string().into_bytes(),
        gas,
        deposit: 0,
    }).await;
    assert!(again.unwrap_err().contains("PROOF_EXISTS"));

    let paid = rpc.call(victor, &app_key, wallet, near_tx::FunctionCall {
        method_name: "pay".into(),
        args: json!({ "payee": e.designer.id(), "amount": (50 * USDC).to_string(), "memo": "deposit", "followup_id": "f-app", "meeting_id": "1793006441" }).to_string().into_bytes(),
        gas: 100_000_000_000_000,
        deposit: 0,
    }).await.map_err(anyhow::Error::msg)?;
    assert_eq!(paid.value.unwrap()["status"], "sending");
    assert_eq!(ft_balance(&e, &e.designer).await?, 50 * USDC);
    // Anyone can go from the payment to the meeting's proof.
    let link = rpc.view(wallet, "get_payment_proof", &json!({ "owner": victor, "followup_id": "f-app" })).await.map_err(anyhow::Error::msg)?;
    assert_eq!(link, json!({ "meeting_id": "1793006441", "proof_hash": "ab".repeat(32) }));

    // The same key opens an escrow and, once the payee confirms, releases it.
    let terms = "7e".repeat(32);
    let opened = rpc.call(victor, &app_key, wallet, near_tx::FunctionCall {
        method_name: "open_escrow".into(),
        args: json!({ "escrow_id": "f-deal", "payee": e.designer.id(), "amount": (20 * USDC).to_string(), "meeting_id": "1793006441", "terms_hash": terms, "has_condition": true }).to_string().into_bytes(),
        gas,
        deposit: 0,
    }).await.map_err(anyhow::Error::msg)?;
    assert_eq!(opened.value.unwrap()["state"], "open");
    confirm(&e, &e.designer, "f-deal", &terms).await?.into_result()?;
    rpc.call(victor, &app_key, wallet, near_tx::FunctionCall {
        method_name: "release_escrow".into(),
        args: json!({ "escrow_id": "f-deal" }).to_string().into_bytes(),
        gas: 100_000_000_000_000,
        deposit: 0,
    }).await.map_err(anyhow::Error::msg)?;
    assert_eq!(ft_balance(&e, &e.designer).await?, 70 * USDC);

    // Anything else is refused by the protocol before the contract runs.
    let rules = rpc.call(victor, &app_key, wallet, near_tx::FunctionCall {
        method_name: "set_cap".into(),
        args: json!({ "daily_cap": (1_000_000 * USDC).to_string() }).to_string().into_bytes(),
        gas,
        deposit: 1,
    }).await;
    assert!(rules.is_err());
    assert_eq!(wallet_field(&e, "daily_cap").await?, 200 * USDC);
    Ok(())
}

/// Mainnet lock: the contract account's full-access keys are deleted after deploy,
/// so nobody (us included) can redeploy the code or empty the account. Everything
/// users do still works, because none of it is signed by the contract account.
#[tokio::test]
async fn locked_contract_still_serves_owners_and_the_app_key() -> anyhow::Result<()> {
    let e = setup().await?;
    let contract = e.wallet.as_account();
    let keys = contract.view_access_keys().await?;
    assert!(!keys.is_empty());
    let mut batch = contract.batch(contract.id());
    for k in &keys {
        batch = batch.delete_key(k.public_key.clone());
    }
    batch.transact().await?.into_result()?;
    assert!(contract.view_access_keys().await?.is_empty(), "no keys left on the contract account");

    // Nothing can be signed as the contract any more: no redeploy, no deleting the account.
    let redeploy = contract.deploy(&[0u8; 16]).await;
    assert!(redeploy.is_err() || redeploy.unwrap().is_failure(), "a locked contract can't be redeployed");
    let delete = contract.clone().delete_account(e.victor.id()).await;
    assert!(delete.is_err() || delete.unwrap().is_failure(), "a locked contract account can't be deleted");

    // The owner's wallet still changes rules with the 1-yocto rule.
    e.victor.call(e.wallet.id(), "set_cap").args_json(json!({ "daily_cap": (5 * USDC).to_string() }))
        .deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    e.victor.call(e.wallet.id(), "set_payment_cap").args_json(json!({ "per_payment_cap": (2 * USDC).to_string() }))
        .deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    assert_eq!(wallet_field(&e, "daily_cap").await?, 5 * USDC);
    let no_yocto = e.victor.call(e.wallet.id(), "set_cap").args_json(json!({ "daily_cap": "1" })).transact().await?;
    assert!(no_yocto.is_failure(), "the 1-yocto rule still holds");

    // The app's limited key still records proofs and pays; the token transfer and its callback still run.
    let app = limited_key(&e).await?;
    app.call(e.wallet.id(), "record_proof")
        .args_json(json!({ "meeting_id": "m-locked", "proof_hash": "ab".repeat(32), "model": "Qwen/Qwen3.8-27B" }))
        .transact().await?.into_result()?;
    let small = pay(&e, &app, 2 * USDC, "f-locked").await?;
    assert_eq!(small.json::<serde_json::Value>()?["status"], "sending");
    assert_eq!(ft_balance(&e, &e.designer).await?, 2 * USDC);

    // Over the tiny per-payment cap: parked, then approved in the owner's wallet.
    let big = pay(&e, &app, 3 * USDC, "f-locked-big").await?;
    assert_eq!(big.json::<serde_json::Value>()?["reason"], "OVER_PAYMENT_CAP");
    e.victor.call(e.wallet.id(), "approve_pending").args_json(json!({ "followup_id": "f-locked-big" }))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    assert_eq!(ft_balance(&e, &e.designer).await?, 5 * USDC);

    // The owner can always take their money out.
    let before = ft_balance(&e, &e.victor).await?;
    e.victor.call(e.wallet.id(), "withdraw").args_json(json!({ "amount": (10 * USDC).to_string() }))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    assert_eq!(ft_balance(&e, &e.victor).await?, before + 10 * USDC);

    let stats: serde_json::Value = e.wallet.view("get_stats").await?.json()?;
    assert_eq!(stats, json!({ "wallets": 1, "proofs": 1, "payments": 2, "parked": 1 }));
    Ok(())
}

// ---------- cross-chain payments (NEAR Intents 1Click) ----------

/// A 1Click-style deposit address on NEAR: an implicit account nobody registered with USDC yet.
const DEPOSIT: &str = "69f5eccee1e146961b47ac7cecb0f5caada2b6e1ee124e72e8b47adedd701f74";
const SOL: &str = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

async fn pay_cross_chain(e: &Env, signer: &Account, payee: &str, amount: u128, followup_id: &str) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    pay_cross_chain_with_gas(e, signer, payee, amount, followup_id, 100).await
}

async fn pay_cross_chain_with_gas(e: &Env, signer: &Account, payee: &str, amount: u128, followup_id: &str, tgas: u64) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    Ok(signer.call(e.wallet.id(), "pay")
        .args_json(json!({
            "payee": payee, "amount": amount.to_string(), "memo": "deposit", "followup_id": followup_id,
            "cross_chain": { "deposit_address": DEPOSIT, "quote_id": "ecb38db7-2b32-450a-8ef2-0efc83ec6ea7" },
        }))
        .gas(near_workspaces::types::Gas::from_tgas(tgas))
        .transact().await?)
}

async fn opt_in_designer(e: &Env) -> anyhow::Result<()> {
    e.victor.call(e.wallet.id(), "set_payee_destination")
        .args_json(json!({ "payee": e.designer.id(), "destination": { "chain": "solana", "address": SOL } }))
        .deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    Ok(())
}

async fn set_cross_chain_cap(e: &Env, cap: u128) -> anyhow::Result<()> {
    e.victor.call(e.wallet.id(), "set_cross_chain_cap")
        .args_json(json!({ "cross_chain_daily_cap": cap.to_string() }))
        .deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    Ok(())
}

async fn usdc_owner_call(e: &Env, method: &str, args: serde_json::Value) -> anyhow::Result<()> {
    e.victor.call(e.usdc.id(), method).args_json(args).transact().await?.into_result()?;
    Ok(())
}

async fn is_paid(e: &Env, followup_id: &str) -> anyhow::Result<bool> {
    Ok(e.wallet.view("is_paid").args_json(json!({ "owner": e.victor.id(), "followup_id": followup_id })).await?.json()?)
}

/// 0.00125 NEAR: what registering a deposit address with USDC costs the owner's storage credit.
const REGISTRATION_FEE: u128 = 1_250_000_000_000_000_000_000;

#[tokio::test]
async fn cross_chain_pays_the_deposit_address_within_caps() -> anyhow::Result<()> {
    let e = setup().await?;
    // The contract registers the deposit address with 0.00125 NEAR: enough for this token.
    let bounds: serde_json::Value = e.usdc.view("storage_balance_bounds").await?.json()?;
    assert!(bounds["min"].as_str().unwrap().parse::<u128>()? <= 1_250_000_000_000_000_000_000);

    opt_in_designer(&e).await?;
    let dests: serde_json::Value = e.wallet.view("get_payee_destinations").args_json(json!({ "owner": e.victor.id() })).await?.json()?;
    assert_eq!(dests[0]["address"], SOL);

    // Opted in, but the cross-chain cap is still 0: refused, nothing parked, nothing moved.
    let app = limited_key(&e).await?;
    let off = pay_cross_chain(&e, &app, e.designer.id().as_str(), 150 * USDC, "x-0").await?;
    let out: serde_json::Value = off.json()?;
    assert_eq!((out["status"].as_str(), out["reason"].as_str()), (Some("blocked"), Some("OVER_CROSS_CHAIN_CAP")));
    assert_eq!(wallet_field(&e, "balance").await?, 300 * USDC);

    set_cross_chain_cap(&e, 200 * USDC).await?;
    assert_eq!(wallet_field(&e, "cross_chain_daily_cap").await?, 200 * USDC);
    let r = pay_cross_chain(&e, &app, e.designer.id().as_str(), 150 * USDC, "x-1").await?;
    assert!(r.is_success(), "{:?}", r.failures());
    assert_eq!(r.json::<serde_json::Value>()?["status"], "sending");
    let v: String = e.usdc.view("ft_balance_of").args_json(json!({ "account_id": DEPOSIT })).await?.json()?;
    assert_eq!(v.parse::<u128>()?, 150 * USDC, "the USDC went to the deposit address");
    assert_eq!(ft_balance(&e, &e.designer).await?, 0, "not to the payee's NEAR account");
    assert_eq!(wallet_field(&e, "spent_today").await?, 150 * USDC);
    assert_eq!(wallet_field(&e, "cross_chain_spent_today").await?, 150 * USDC);
    let rec: serde_json::Value = e.wallet.view("get_cross_chain_payment").args_json(json!({ "owner": e.victor.id(), "followup_id": "x-1" })).await?.json()?;
    assert_eq!((rec["chain"].as_str(), rec["address"].as_str(), rec["deposit_address"].as_str()), (Some("solana"), Some(SOL), Some(DEPOSIT)));
    assert_eq!(rec["quote_id"], "ecb38db7-2b32-450a-8ef2-0efc83ec6ea7");

    // 60 more is over the 200 daily cap: refused and nothing parked.
    let over = pay_cross_chain(&e, &app, e.designer.id().as_str(), 60 * USDC, "x-2").await?;
    let out: serde_json::Value = over.json()?;
    assert_eq!((out["status"].as_str(), out["reason"].as_str()), (Some("blocked"), Some("OVER_CAP")));
    let pending: Option<serde_json::Value> = e.wallet.view("get_pending").args_json(json!({ "owner": e.victor.id(), "followup_id": "x-2" })).await?.json()?;
    assert!(pending.is_none());
    assert_eq!(wallet_field(&e, "balance").await?, 150 * USDC);
    Ok(())
}

#[tokio::test]
async fn cross_chain_refuses_unlisted_unopted_paused_and_other_callers() -> anyhow::Result<()> {
    let e = setup().await?;
    let app = limited_key(&e).await?;

    // Listed but not opted in.
    let not_opted = pay_cross_chain(&e, &app, e.designer.id().as_str(), USDC, "x-a").await?;
    assert!(format!("{:?}", not_opted.into_result().unwrap_err()).contains("NO_DESTINATION"));

    // The app's key can't opt a payee in: the method isn't on its list.
    let by_app = app.call(e.wallet.id(), "set_payee_destination")
        .args_json(json!({ "payee": e.designer.id(), "destination": { "chain": "solana", "address": SOL } }))
        .deposit(NearToken::from_yoctonear(1)).transact().await;
    assert!(by_app.is_err() || by_app.unwrap().is_failure());

    opt_in_designer(&e).await?;
    // Not on the list at all.
    let unlisted = pay_cross_chain(&e, &app, e.usdc.id().as_str(), USDC, "x-b").await?;
    assert!(format!("{:?}", unlisted.into_result().unwrap_err()).contains("UNKNOWN_PAYEE"));

    // Someone else's account can't spend Victor's wallet: the contract acts on the caller's own.
    let other = pay_cross_chain(&e, &e.designer, e.designer.id().as_str(), USDC, "x-c").await?;
    // Designer has no wallet or payees of their own, so the payee is unknown to them.
    assert!(format!("{:?}", other.into_result().unwrap_err()).contains("UNKNOWN_PAYEE"));

    e.victor.call(e.wallet.id(), "set_paused").args_json(json!({ "paused": true }))
        .deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    let paused = pay_cross_chain(&e, &app, e.designer.id().as_str(), USDC, "x-d").await?;
    assert!(format!("{:?}", paused.into_result().unwrap_err()).contains("PAUSED"));
    assert_eq!(wallet_field(&e, "balance").await?, 300 * USDC);
    Ok(())
}

/// Both ways a cross-chain payment can fail, at exactly the 70 TGas floor so the whole chain
/// (storage_deposit, the callback, ft_transfer, its callback) is shown to fit.
#[tokio::test]
async fn failed_cross_chain_payment_is_refunded() -> anyhow::Result<()> {
    let e = setup().await?;
    opt_in_designer(&e).await?;
    set_cross_chain_cap(&e, 200 * USDC).await?;
    let app = limited_key(&e).await?;
    let designer = e.designer.id().as_str();
    let credit = wallet_field(&e, "storage_credit").await?;

    // 1. Registering the deposit address fails (the token now wants more than 0.00125 NEAR):
    // everything is undone and the fee comes back to the storage credit.
    usdc_owner_call(&e, "set_storage_min", json!({ "min": "2000000000000000000000" })).await?;
    let r = pay_cross_chain_with_gas(&e, &app, designer, 150 * USDC, "x-1", 70).await?;
    assert!(r.is_success(), "{:?}", r.failures());
    assert!(r.logs().iter().any(|l| l.contains("PAYMENT_FAILED")), "logs: {:?}", r.logs());
    assert_eq!(wallet_field(&e, "balance").await?, 300 * USDC);
    assert_eq!(wallet_field(&e, "spent_today").await?, 0);
    assert_eq!(wallet_field(&e, "cross_chain_spent_today").await?, 0);
    assert_eq!(wallet_field(&e, "storage_credit").await?, credit, "fee, record and paid mark all refunded");
    assert!(!is_paid(&e, "x-1").await?);
    let rec: Option<serde_json::Value> = e.wallet.view("get_cross_chain_payment").args_json(json!({ "owner": e.victor.id(), "followup_id": "x-1" })).await?.json()?;
    assert!(rec.is_none());

    // 2. The address registers, but the transfer is refused (Circle-style blocklist): the USDC and
    // the caps come back; the fee was spent registering the address, so it stays spent.
    usdc_owner_call(&e, "set_storage_min", json!({ "min": null })).await?;
    usdc_owner_call(&e, "set_blocked", json!({ "account_id": DEPOSIT, "blocked": true })).await?;
    let r = pay_cross_chain_with_gas(&e, &app, designer, 150 * USDC, "x-2", 70).await?;
    assert!(r.logs().iter().any(|l| l.contains("PAYMENT_FAILED")), "logs: {:?}", r.logs());
    assert_eq!(wallet_field(&e, "balance").await?, 300 * USDC);
    assert_eq!(wallet_field(&e, "cross_chain_spent_today").await?, 0);
    assert_eq!(wallet_field(&e, "storage_credit").await?, credit - REGISTRATION_FEE);
    let registered: Option<serde_json::Value> = e.usdc.view("storage_balance_of").args_json(json!({ "account_id": DEPOSIT })).await?.json()?;
    assert!(registered.is_some());
    assert!(!is_paid(&e, "x-2").await?, "a failed payment can be retried");

    // 3. Retried once the address can receive: it goes through.
    usdc_owner_call(&e, "set_blocked", json!({ "account_id": DEPOSIT, "blocked": false })).await?;
    let r = pay_cross_chain_with_gas(&e, &app, designer, 150 * USDC, "x-2", 70).await?;
    assert!(r.is_success(), "{:?}", r.failures());
    let v: String = e.usdc.view("ft_balance_of").args_json(json!({ "account_id": DEPOSIT })).await?.json()?;
    assert_eq!(v.parse::<u128>()?, 150 * USDC);
    assert!(is_paid(&e, "x-2").await?);
    let stats: serde_json::Value = e.wallet.view("get_stats").await?.json()?;
    assert_eq!(stats["payments"], 1, "the two refunded payments aren't counted");
    Ok(())
}

/// Every record is paid from the owner's storage credit, the wallet record and each paid mark
/// included. When it runs out, the app's proofs and payments stop; the owner's wallet tops it up.
#[tokio::test]
async fn storage_credit_runs_out_then_is_topped_up() -> anyhow::Result<()> {
    let e = setup().await?;
    let app = limited_key(&e).await?;
    let credit = wallet_field(&e, "storage_credit").await?;
    assert!(credit < NearToken::from_millinear(100).as_yoctonear(), "the wallet record came out of the 0.1 NEAR");

    // Victor takes back all but 10 bytes' worth; the NEAR lands in his account.
    let keep = 10 * 10_000_000_000_000_000_000u128;
    let near_before = e.victor.view_account().await?.balance.as_yoctonear();
    e.victor.call(e.wallet.id(), "withdraw_storage_credit").args_json(json!({ "amount": (credit - keep).to_string() }))
        .deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    assert_eq!(wallet_field(&e, "storage_credit").await?, keep);
    let near_after = e.victor.view_account().await?.balance.as_yoctonear();
    assert!(near_after + NearToken::from_millinear(5).as_yoctonear() > near_before + (credit - keep), "refunded, less gas");

    // Out of credit: a proof and a payment (its paid mark) are both refused.
    let proof = app.call(e.wallet.id(), "record_proof")
        .args_json(json!({ "meeting_id": "m-1", "proof_hash": "ab".repeat(32), "model": "Qwen/Qwen3.8-27B" }))
        .transact().await?;
    assert!(format!("{:?}", proof.into_result().unwrap_err()).contains("STORAGE_CREDIT_LOW"));
    let paid = pay(&e, &app, 10 * USDC, "f-1").await?;
    assert!(format!("{:?}", paid.into_result().unwrap_err()).contains("STORAGE_CREDIT_LOW"));
    assert_eq!(wallet_field(&e, "balance").await?, 300 * USDC);

    // The app's key can't top up: the method isn't on its list, and it can't attach NEAR.
    let by_app = app.call(e.wallet.id(), "add_storage_credit").deposit(NearToken::from_millinear(50)).transact().await;
    assert!(by_app.is_err() || by_app.unwrap().is_failure());

    // Victor's wallet tops up; both work again.
    e.victor.call(e.wallet.id(), "add_storage_credit").deposit(NearToken::from_millinear(50)).transact().await?.into_result()?;
    assert_eq!(wallet_field(&e, "storage_credit").await?, keep + NearToken::from_millinear(50).as_yoctonear());
    app.call(e.wallet.id(), "record_proof")
        .args_json(json!({ "meeting_id": "m-1", "proof_hash": "ab".repeat(32), "model": "Qwen/Qwen3.8-27B" }))
        .transact().await?.into_result()?;
    let paid = pay(&e, &app, 10 * USDC, "f-1").await?;
    assert_eq!(paid.json::<serde_json::Value>()?["status"], "sending");
    assert_eq!(ft_balance(&e, &e.designer).await?, 10 * USDC);
    Ok(())
}

/// A withdrawal that bounces comes back to the balance through its own callback and never
/// touches a payment's paid mark. Withdraw and approve run at their 50 TGas floor, and refuse less.
#[tokio::test]
async fn failed_withdrawal_is_refunded_and_leaves_payments_alone() -> anyhow::Result<()> {
    let e = setup().await?;
    let app = limited_key(&e).await?;
    pay(&e, &app, 50 * USDC, "f-1").await?.into_result()?;

    let withdraw = |tgas: u64| e.victor.call(e.wallet.id(), "withdraw").args_json(json!({ "amount": (10 * USDC).to_string() }))
        .deposit(NearToken::from_yoctonear(1)).gas(near_workspaces::types::Gas::from_tgas(tgas)).transact();
    usdc_owner_call(&e, "set_blocked", json!({ "account_id": e.victor.id(), "blocked": true })).await?;
    let r = withdraw(50).await?;
    assert!(r.logs().iter().any(|l| l.contains("WITHDRAW_FAILED")), "logs: {:?}", r.logs());
    assert_eq!(wallet_field(&e, "balance").await?, 250 * USDC);
    assert!(is_paid(&e, "f-1").await?, "the payment is still marked paid");

    usdc_owner_call(&e, "set_blocked", json!({ "account_id": e.victor.id(), "blocked": false })).await?;
    let before = ft_balance(&e, &e.victor).await?;
    withdraw(50).await?.into_result()?;
    assert_eq!(ft_balance(&e, &e.victor).await?, before + 10 * USDC);
    let low = withdraw(30).await?;
    assert!(format!("{:?}", low.into_result().unwrap_err()).contains("NEEDS_50_TGAS"));

    // Approving a parked payment at exactly 50 TGas pays it.
    pay(&e, &app, 220 * USDC, "f-big").await?.into_result()?;
    e.victor.call(e.wallet.id(), "approve_pending").args_json(json!({ "followup_id": "f-big" }))
        .deposit(NearToken::from_yoctonear(1)).gas(near_workspaces::types::Gas::from_tgas(50)).transact().await?.into_result()?;
    assert_eq!(ft_balance(&e, &e.designer).await?, 270 * USDC);
    Ok(())
}

/// The app's first-time setup signs `register` and `set_cap` as two actions of one
/// transaction (packages/core toTransactions, kind "setup"): NEAR runs them in order, so
/// set_cap finds the wallet register just made, and a failure in either undoes both.
#[tokio::test]
async fn setup_registers_and_sets_the_cap_in_one_transaction() -> anyhow::Result<()> {
    use near_workspaces::operations::Function;
    let e = setup().await?;
    let get = |who: &Account| e.wallet.view("get_wallet").args_json(json!({ "owner": who.id() }));

    e.designer.batch(e.wallet.id())
        .call(Function::new("register").args_json(json!({})).deposit(NearToken::from_millinear(100)))
        .call(Function::new("set_cap").args_json(json!({ "daily_cap": (25 * USDC).to_string() })).deposit(NearToken::from_yoctonear(1)))
        .transact().await?.into_result()?;
    let w: serde_json::Value = get(&e.designer).await?.json()?;
    assert_eq!(w["daily_cap"], (25 * USDC).to_string());

    // Victor is registered already: the batch fails at register, and set_cap doesn't stick either.
    let again = e.victor.batch(e.wallet.id())
        .call(Function::new("register").args_json(json!({})).deposit(NearToken::from_millinear(100)))
        .call(Function::new("set_cap").args_json(json!({ "daily_cap": "1" })).deposit(NearToken::from_yoctonear(1)))
        .transact().await?;
    assert!(again.is_failure());
    assert_eq!(wallet_field(&e, "daily_cap").await?, 200 * USDC);
    Ok(())
}

// ---------- Handshake: escrow ----------

const TERMS: &str = "5f7c1d0e9a3b2c4d6e8f00112233445566778899aabbccddeeff001122334455";

async fn record_proof(e: &Env, app: &Account, meeting_id: &str) -> anyhow::Result<()> {
    app.call(e.wallet.id(), "record_proof")
        .args_json(json!({ "meeting_id": meeting_id, "proof_hash": "ab".repeat(32), "model": "Qwen/Qwen3.8-27B" }))
        .transact().await?.into_result()?;
    Ok(())
}

async fn open_escrow(e: &Env, signer: &Account, amount: u128, escrow_id: &str, has_condition: bool) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    Ok(signer.call(e.wallet.id(), "open_escrow")
        .args_json(json!({ "escrow_id": escrow_id, "payee": e.designer.id(), "amount": amount.to_string(), "meeting_id": "m-1", "terms_hash": TERMS, "has_condition": has_condition }))
        .transact().await?)
}

/// The payee confirms from their own account, with the 1 yoctoNEAR a full-access key attaches.
async fn confirm(e: &Env, payee: &Account, escrow_id: &str, terms_hash: &str) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    Ok(payee.call(e.wallet.id(), "confirm_escrow")
        .args_json(json!({ "owner": e.victor.id(), "escrow_id": escrow_id, "terms_hash": terms_hash }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(near_workspaces::types::Gas::from_tgas(100))
        .transact().await?)
}

async fn release(e: &Env, signer: &Account, escrow_id: &str) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    Ok(signer.call(e.wallet.id(), "release_escrow")
        .args_json(json!({ "escrow_id": escrow_id }))
        .gas(near_workspaces::types::Gas::from_tgas(100))
        .transact().await?)
}

async fn owner_escrow_call(e: &Env, method: &str, escrow_id: &str) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    Ok(e.victor.call(e.wallet.id(), method)
        .args_json(json!({ "escrow_id": escrow_id }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(near_workspaces::types::Gas::from_tgas(100))
        .transact().await?)
}

async fn escrow(e: &Env, escrow_id: &str) -> anyhow::Result<serde_json::Value> {
    Ok(e.wallet.view("get_escrow").args_json(json!({ "owner": e.victor.id(), "escrow_id": escrow_id })).await?.json()?)
}

fn refused(r: near_workspaces::result::ExecutionFinalResult, why: &str) -> bool {
    format!("{:?}", r.into_result().unwrap_err()).contains(why)
}

/// Opened within the caps by the app's key, with the meeting's proof hash; only the payee can
/// confirm, and only the terms they saw; release waits for that, pays once, and the caps
/// count it once, when it was set aside.
#[tokio::test]
async fn escrow_within_cap_is_confirmed_by_the_payee_and_released_by_the_app_key() -> anyhow::Result<()> {
    let e = setup().await?;
    let app = limited_key(&e).await?;
    record_proof(&e, &app, "m-1").await?;

    // No proof under that meeting id: refused.
    let no_proof = app.call(e.wallet.id(), "open_escrow")
        .args_json(json!({ "escrow_id": "e-0", "payee": e.designer.id(), "amount": USDC.to_string(), "meeting_id": "m-2", "terms_hash": TERMS, "has_condition": true }))
        .transact().await?;
    assert!(refused(no_proof, "PROOF_NOT_FOUND"));

    let r = open_escrow(&e, &app, 150 * USDC, "e-1", true).await?;
    assert!(r.is_success(), "{:?}", r.failures());
    assert_eq!(r.json::<serde_json::Value>()?, json!({ "state": "open", "reason": null, "left_today": (50 * USDC).to_string() }));
    assert_eq!((wallet_field(&e, "balance").await?, wallet_field(&e, "spent_today").await?), (150 * USDC, 150 * USDC));
    let opened = escrow(&e, "e-1").await?;
    assert_eq!(opened["proof"], json!({ "meeting_id": "m-1", "proof_hash": "ab".repeat(32) }), "the meeting's proof, as recorded");
    assert_eq!((opened["terms_hash"].as_str(), opened["state"].as_str()), (Some(TERMS), Some("open")));

    // Before the payee confirms, the app's key can't release it.
    assert!(refused(release(&e, &app, "e-1").await?, "NOT_CONFIRMED"));
    // Only the payee confirms: not the owner, not another account, and not other terms.
    let root = e.worker.root_account()?;
    let stranger = root.create_subaccount("stranger").initial_balance(NearToken::from_near(2)).transact().await?.into_result()?;
    assert!(refused(confirm(&e, &stranger, "e-1", TERMS).await?, "NOT_THE_PAYEE"));
    assert!(refused(confirm(&e, &e.victor, "e-1", TERMS).await?, "NOT_THE_PAYEE"));
    assert!(refused(confirm(&e, &e.designer, "e-1", &"00".repeat(32)).await?, "TERMS_DIFFER"));
    let ok = confirm(&e, &e.designer, "e-1", TERMS).await?;
    assert!(ok.is_success(), "{:?}", ok.failures());
    assert_eq!(ok.json::<String>()?, "confirmed", "with a condition, it waits for the owner");
    assert_eq!(ft_balance(&e, &e.designer).await?, 0);

    // Released by the app's key: paid once, and not counted against the caps again.
    let paid = release(&e, &app, "e-1").await?;
    assert!(paid.is_success(), "{:?}", paid.failures());
    assert_eq!(ft_balance(&e, &e.designer).await?, 150 * USDC);
    assert_eq!(escrow(&e, "e-1").await?["state"], "released");
    assert_eq!((wallet_field(&e, "balance").await?, wallet_field(&e, "spent_today").await?), (150 * USDC, 150 * USDC));
    assert!(refused(release(&e, &app, "e-1").await?, "ESCROW_CLOSED"));
    assert_eq!(ft_balance(&e, &e.designer).await?, 150 * USDC);
    // 50 left today, for escrows and payments together.
    assert_eq!(open_escrow(&e, &app, 60 * USDC, "e-2", true).await?.json::<serde_json::Value>()?["state"], "parked");
    let stats: serde_json::Value = e.wallet.view("get_stats").await?.json()?;
    assert_eq!((stats["payments"].as_u64(), stats["parked"].as_u64()), (Some(1), Some(1)));
    Ok(())
}

/// Over a cap the escrow is parked, nothing is set aside, and only the owner's wallet can
/// approve it; then the payee confirms and the owner's wallet releases it.
#[tokio::test]
async fn escrow_over_cap_is_parked_until_the_owner_wallet_approves() -> anyhow::Result<()> {
    let e = setup().await?;
    let app = limited_key(&e).await?;
    record_proof(&e, &app, "m-1").await?;
    let r = open_escrow(&e, &app, 250 * USDC, "e-big", true).await?;
    assert_eq!(r.json::<serde_json::Value>()?["reason"], "OVER_CAP");
    assert_eq!(escrow(&e, "e-big").await?["state"], "parked");
    assert_eq!((wallet_field(&e, "balance").await?, wallet_field(&e, "spent_today").await?), (300 * USDC, 0));
    assert!(refused(confirm(&e, &e.designer, "e-big", TERMS).await?, "NOT_OPEN_YET"));

    // The app's key can't approve it: the method isn't on its list, and it can't attach 1 yocto.
    let by_app = app.call(e.wallet.id(), "approve_escrow").args_json(json!({ "escrow_id": "e-big" }))
        .deposit(NearToken::from_yoctonear(1)).transact().await;
    assert!(by_app.is_err() || by_app.unwrap().is_failure());
    owner_escrow_call(&e, "approve_escrow", "e-big").await?.into_result()?;
    assert_eq!((wallet_field(&e, "balance").await?, wallet_field(&e, "spent_today").await?), (50 * USDC, 250 * USDC));

    confirm(&e, &e.designer, "e-big", TERMS).await?.into_result()?;
    // The owner's wallet can release too (it signs as the same account).
    release(&e, &e.victor, "e-big").await?.into_result()?;
    assert_eq!(ft_balance(&e, &e.designer).await?, 250 * USDC);
    assert_eq!(wallet_field(&e, "spent_today").await?, 250 * USDC, "counted once, when approved");
    Ok(())
}

/// The owner's wallet can take an escrow back before the payee confirms, not after (until 30
/// days pass; unit-tested). After, the payee can give it back. The app's key can't cancel.
#[tokio::test]
async fn owner_cancels_an_escrow_only_before_the_payee_confirms() -> anyhow::Result<()> {
    let e = setup().await?;
    let app = limited_key(&e).await?;
    record_proof(&e, &app, "m-1").await?;
    open_escrow(&e, &app, 100 * USDC, "e-1", true).await?.into_result()?;
    let by_app = app.call(e.wallet.id(), "cancel_escrow").args_json(json!({ "escrow_id": "e-1" })).transact().await;
    assert!(by_app.is_err() || by_app.unwrap().is_failure());
    owner_escrow_call(&e, "cancel_escrow", "e-1").await?.into_result()?;
    assert_eq!(escrow(&e, "e-1").await?["state"], "cancelled");
    assert_eq!((wallet_field(&e, "balance").await?, wallet_field(&e, "spent_today").await?), (300 * USDC, 0));
    assert!(refused(confirm(&e, &e.designer, "e-1", TERMS).await?, "ESCROW_CLOSED"));

    open_escrow(&e, &app, 100 * USDC, "e-2", true).await?.into_result()?;
    confirm(&e, &e.designer, "e-2", TERMS).await?.into_result()?;
    assert!(refused(owner_escrow_call(&e, "cancel_escrow", "e-2").await?, "PAYEE_CONFIRMED"));
    // Both agree to call it off: the payee gives it back.
    e.designer.call(e.wallet.id(), "return_escrow").args_json(json!({ "owner": e.victor.id(), "escrow_id": "e-2" }))
        .deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    assert_eq!(escrow(&e, "e-2").await?["state"], "returned");
    assert_eq!(wallet_field(&e, "balance").await?, 300 * USDC);
    assert_eq!(ft_balance(&e, &e.designer).await?, 0);
    Ok(())
}

/// Without a condition, the payee's confirmation pays them in the same transaction. If the
/// transfer bounces, the escrow is confirmed again with its money still set aside.
#[tokio::test]
async fn escrow_without_a_condition_is_released_by_the_payees_confirmation() -> anyhow::Result<()> {
    let e = setup().await?;
    let app = limited_key(&e).await?;
    record_proof(&e, &app, "m-1").await?;
    open_escrow(&e, &app, 40 * USDC, "e-now", false).await?.into_result()?;
    let r = confirm(&e, &e.designer, "e-now", TERMS).await?;
    assert!(r.is_success(), "{:?}", r.failures());
    assert_eq!(r.json::<String>()?, "released");
    assert_eq!(ft_balance(&e, &e.designer).await?, 40 * USDC);
    assert_eq!(escrow(&e, "e-now").await?["state"], "released");

    // A payee the token refuses: the release fails and is undone.
    usdc_owner_call(&e, "set_blocked", json!({ "account_id": e.designer.id(), "blocked": true })).await?;
    open_escrow(&e, &app, 30 * USDC, "e-bounce", false).await?.into_result()?;
    let r = confirm(&e, &e.designer, "e-bounce", TERMS).await?;
    assert!(r.logs().iter().any(|l| l.contains("ESCROW_RELEASE_FAILED")), "logs: {:?}", r.logs());
    assert_eq!(escrow(&e, "e-bounce").await?["state"], "confirmed");
    assert_eq!(wallet_field(&e, "balance").await?, 230 * USDC, "still set aside");
    let stats: serde_json::Value = e.wallet.view("get_stats").await?.json()?;
    assert_eq!(stats["payments"], 1, "the bounced release isn't counted");
    usdc_owner_call(&e, "set_blocked", json!({ "account_id": e.designer.id(), "blocked": false })).await?;
    release(&e, &app, "e-bounce").await?.into_result()?;
    assert_eq!(ft_balance(&e, &e.designer).await?, 70 * USDC);
    Ok(())
}

/// A key added before Handshake (pay and record_proof only) still pays, but the protocol
/// refuses it an escrow method. The owner's wallet updates it in one transaction (delete the
/// key and add it back with today's methods, as packages/core `update-key` builds it), and the
/// same key then opens escrows.
#[tokio::test]
async fn a_key_from_before_escrows_pays_and_is_updated_in_one_transaction() -> anyhow::Result<()> {
    let e = setup().await?;
    let sk = SecretKey::from_random(near_workspaces::types::KeyType::ED25519);
    let allowance = Some(NearToken::from_millinear(250));
    e.victor.batch(e.victor.id())
        .add_key(sk.public_key(), AccessKey::function_call_access(e.wallet.id(), &OLD_KEY_METHODS, allowance))
        .transact().await?.into_result()?;
    let old = Account::from_secret_key(e.victor.id().clone(), sk.clone(), &e.worker);
    record_proof(&e, &old, "m-1").await?;
    assert_eq!(pay(&e, &old, 10 * USDC, "f-1").await?.json::<serde_json::Value>()?["status"], "sending");
    let r = open_escrow(&e, &old, 10 * USDC, "e-1", true).await;
    assert!(r.is_err() || r.unwrap().is_failure(), "open_escrow isn't on the old key's list");
    let none: Option<serde_json::Value> = e.wallet.view("get_escrow").args_json(json!({ "owner": e.victor.id(), "escrow_id": "e-1" })).await?.json()?;
    assert!(none.is_none());

    e.victor.batch(e.victor.id())
        .delete_key(sk.public_key())
        .add_key(sk.public_key(), AccessKey::function_call_access(e.wallet.id(), &APP_KEY_METHODS, allowance))
        .transact().await?.into_result()?;
    let updated = Account::from_secret_key(e.victor.id().clone(), sk, &e.worker);
    let r = open_escrow(&e, &updated, 10 * USDC, "e-1", true).await?;
    assert!(r.is_success(), "{:?}", r.failures());
    assert_eq!(pay(&e, &updated, 10 * USDC, "f-2").await?.json::<serde_json::Value>()?["status"], "sending", "it still pays");
    Ok(())
}

/// The testnet contract already holds state. A plain redeploy of this code over the code on
/// main before Handshake (tests/fixtures/agent_wallet_6184cac.wasm, built from commit 6184cac)
/// keeps every wallet, payee, proof, payment and parked payment readable and usable, and the
/// escrow methods work on top, with no migration call.
#[tokio::test]
async fn upgrade_from_the_code_before_handshake_keeps_state_and_adds_escrows() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let old_wasm = std::fs::read("tests/fixtures/agent_wallet_6184cac.wasm")?;
    let new_wasm = near_workspaces::compile_project("./").await?;
    let ft_wasm = near_workspaces::compile_project("../mock-ft").await?;
    let root = worker.root_account()?;
    let victor = root.create_subaccount("victor").initial_balance(NearToken::from_near(20)).transact().await?.into_result()?;
    let designer = root.create_subaccount("designer").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    let usdc = worker.dev_deploy(&ft_wasm).await?;
    usdc.call("new").args_json(json!({ "owner_id": victor.id(), "total_supply": (1_000_000 * USDC).to_string() })).transact().await?.into_result()?;

    // The old code, with a wallet that has used everything it offered.
    let wallet = worker.dev_deploy(&old_wasm).await?;
    wallet.call("new").args_json(json!({ "usdc": usdc.id() })).transact().await?.into_result()?;
    for id in [wallet.id(), designer.id()] {
        victor.call(usdc.id(), "storage_deposit").args_json(json!({ "account_id": id })).deposit(NearToken::from_millinear(125)).transact().await?.into_result()?;
    }
    victor.call(wallet.id(), "register").deposit(NearToken::from_millinear(100)).transact().await?.into_result()?;
    victor.call(wallet.id(), "set_cap").args_json(json!({ "daily_cap": (200 * USDC).to_string() })).deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    victor.call(wallet.id(), "add_payee").args_json(json!({ "payee": designer.id(), "label": "Designer" })).deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    victor.call(usdc.id(), "ft_transfer_call").args_json(json!({ "receiver_id": wallet.id(), "amount": (500 * USDC).to_string(), "msg": "" }))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    let old_app = key_for(&worker, &victor, &wallet, &OLD_KEY_METHODS).await?;
    old_app.call(wallet.id(), "record_proof").args_json(json!({ "meeting_id": "m-1", "proof_hash": "ab".repeat(32), "model": "Qwen/Qwen3.8-27B" }))
        .transact().await?.into_result()?;
    for (amount, id) in [(50 * USDC, "f-1"), (250 * USDC, "f-big")] {
        old_app.call(wallet.id(), "pay").args_json(json!({ "payee": designer.id(), "amount": amount.to_string(), "memo": "deposit", "followup_id": id }))
            .gas(near_workspaces::types::Gas::from_tgas(100)).transact().await?.into_result()?;
    }

    let owner = json!({ "owner": victor.id() });
    let views = || async {
        let w = &wallet;
        anyhow::Ok(json!({
            "wallet": w.view("get_wallet").args_json(owner.clone()).await?.json::<serde_json::Value>()?,
            "payees": w.view("get_payees").args_json(owner.clone()).await?.json::<serde_json::Value>()?,
            "proof": w.view("get_proof").args_json(json!({ "owner": victor.id(), "meeting_id": "m-1" })).await?.json::<serde_json::Value>()?,
            "paid": w.view("is_paid").args_json(json!({ "owner": victor.id(), "followup_id": "f-1" })).await?.json::<serde_json::Value>()?,
            "pending": w.view("get_pending").args_json(json!({ "owner": victor.id(), "followup_id": "f-big" })).await?.json::<serde_json::Value>()?,
            "stats": w.view("get_stats").await?.json::<serde_json::Value>()?,
            "usdc": w.view("get_usdc").await?.json::<serde_json::Value>()?,
        }))
    };
    let before = views().await?;
    assert_eq!(before["pending"]["amount"], (250 * USDC).to_string());

    // The upgrade: deploy the new code over the old, as `near contract deploy … without-init-call` does.
    wallet.as_account().deploy(&new_wasm).await?.into_result()?;
    assert_eq!(views().await?, before, "every old record reads the same after the upgrade");
    let no_link: Option<serde_json::Value> = wallet.view("get_payment_proof").args_json(json!({ "owner": victor.id(), "followup_id": "f-1" })).await?.json()?;
    assert!(no_link.is_none(), "a payment from before has no proof link, and reading it doesn't fail");

    // The old key and the old parked payment still work (with room under a higher cap for what follows).
    victor.call(wallet.id(), "set_cap").args_json(json!({ "daily_cap": (1_000 * USDC).to_string() })).deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    victor.call(wallet.id(), "approve_pending").args_json(json!({ "followup_id": "f-big" })).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    let designer_usdc = |amount: u128| {
        let usdc = &usdc;
        let designer = &designer;
        async move { anyhow::Ok(usdc.view("ft_balance_of").args_json(json!({ "account_id": designer.id() })).await?.json::<String>()? == amount.to_string()) }
    };
    assert!(designer_usdc(300 * USDC).await?);
    let old_pay = old_app.call(wallet.id(), "pay").args_json(json!({ "payee": designer.id(), "amount": USDC.to_string(), "followup_id": "f-2" }))
        .gas(near_workspaces::types::Gas::from_tgas(100)).transact().await?;
    assert_eq!(old_pay.json::<serde_json::Value>()?["status"], "sending");
    assert!(designer_usdc(301 * USDC).await?);

    // New methods on the old state: the owner adds a key with the escrow methods.
    let app = key_for(&worker, &victor, &wallet, &APP_KEY_METHODS).await?;
    let r = app.call(wallet.id(), "open_escrow")
        .args_json(json!({ "escrow_id": "e-1", "payee": designer.id(), "amount": (20 * USDC).to_string(), "meeting_id": "m-1", "terms_hash": TERMS, "has_condition": true }))
        .transact().await?;
    assert!(r.is_success(), "{:?}", r.failures());
    let e: serde_json::Value = wallet.view("get_escrow").args_json(json!({ "owner": victor.id(), "escrow_id": "e-1" })).await?.json()?;
    assert_eq!(e["proof"]["proof_hash"], "ab".repeat(32), "the escrow links the proof recorded before the upgrade");
    designer.call(wallet.id(), "confirm_escrow").args_json(json!({ "owner": victor.id(), "escrow_id": "e-1", "terms_hash": TERMS }))
        .deposit(NearToken::from_yoctonear(1)).gas(near_workspaces::types::Gas::from_tgas(100)).transact().await?.into_result()?;
    app.call(wallet.id(), "release_escrow").args_json(json!({ "escrow_id": "e-1" })).gas(near_workspaces::types::Gas::from_tgas(100)).transact().await?.into_result()?;
    assert!(designer_usdc(321 * USDC).await?);
    let stats: serde_json::Value = wallet.view("get_stats").await?.json()?;
    assert_eq!(stats, json!({ "wallets": 1, "proofs": 1, "payments": 4, "parked": 1 }));
    Ok(())
}
