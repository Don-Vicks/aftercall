//! Sandbox tests: the agent wallet and a USDC-like token deployed on a local NEAR node.
//! Run from contracts/: cargo test -p agent-wallet --test sandbox -- --test-threads=1

use near_workspaces::network::Sandbox;
use near_workspaces::types::{AccessKey, NearToken, SecretKey};
use near_workspaces::{Account, Contract, Worker};
use serde_json::json;

const USDC: u128 = 1_000_000; // 6 decimals

struct Env {
    worker: Worker<Sandbox>,
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

    Ok(Env { worker, wallet, usdc, victor, designer })
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

/// Adds a function-call key to Victor's account that may only call pay and record_proof,
/// and returns Victor's account signing with that limited key (what the desktop app holds).
async fn limited_key(e: &Env) -> anyhow::Result<Account> {
    let sk = SecretKey::from_random(near_workspaces::types::KeyType::ED25519);
    e.victor.batch(e.victor.id())
        .add_key(sk.public_key(), AccessKey::function_call_access(
            e.wallet.id(), &["pay", "record_proof"], Some(NearToken::from_millinear(250))))
        .transact().await?.into_result()?;
    Ok(Account::from_secret_key(e.victor.id().clone(), sk, &e.worker))
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
async fn callback_is_private() -> anyhow::Result<()> {
    let e = setup().await?;
    let r = e.victor.call(e.wallet.id(), "on_pay_complete")
        .args_json(json!({ "owner": e.victor.id(), "followup_id": "x", "amount": (1_000 * USDC).to_string(), "counts_to_cap": false }))
        .transact().await?;
    assert!(r.is_failure(), "anyone calling the callback must fail");
    assert_eq!(wallet_field(&e, "balance").await?, 300 * USDC);
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
    // Autopilot limit: 50 USDC per payment (daily cap is 200).
    e.victor.call(e.wallet.id(), "set_payment_cap").args_json(json!({ "per_payment_cap": (50 * USDC).to_string() }))
        .deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;

    let small = pay(&e, &app, 50 * USDC, "auto-1").await?;
    assert_eq!(small.json::<serde_json::Value>()?["status"], "sending");

    // 60 is under the daily cap but over the per-payment cap: parked, not paid.
    let big = pay(&e, &app, 60 * USDC, "auto-2").await?;
    let out: serde_json::Value = big.json()?;
    assert_eq!(out["status"], "blocked");
    assert_eq!(out["reason"], "OVER_PAYMENT_CAP");
    assert_eq!(ft_balance(&e, &e.designer).await?, 50 * USDC);

    // The limited key can't raise its own limit.
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
        .add_key(pk, AccessKey::function_call_access(e.wallet.id(), &["pay", "record_proof"], Some(NearToken::from_millinear(250))))
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
        args: json!({ "payee": e.designer.id(), "amount": (50 * USDC).to_string(), "memo": "deposit", "followup_id": "f-app" }).to_string().into_bytes(),
        gas: 100_000_000_000_000,
        deposit: 0,
    }).await.map_err(anyhow::Error::msg)?;
    assert_eq!(paid.value.unwrap()["status"], "sending");
    assert_eq!(ft_balance(&e, &e.designer).await?, 50 * USDC);

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
