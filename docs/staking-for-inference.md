# Staking for Inference: funding the team org

Aftercall's meeting notes run on NEAR AI Cloud (`cloud-api.near.ai`). NEAR AI's *Staking for Inference* turns staking rewards on NEAR into NEAR AI Cloud credits. This page is what Victor does to fund the team's NEAR AI Cloud organization that way. Victor does it themselves: it needs their mainnet wallet and real NEAR, and nothing in this repo signs it.

Researched on 26 Oct 2026. Every fact below links its source. **Not confirmed** marks what the sources didn't settle.

## What it is

- NEAR AI runs it. It was announced on 30 Jul 2026. ([NEAR AI blog: Staking for NEAR AI](https://near.ai/blog/staking-for-near-ai))
- You stake NEAR. The **rewards** (not the NEAR you stake) become NEAR AI Cloud credits, at 1 credit = 1 USD of usage. Credits accrue every second and unused credits carry over. Unstaking gives the NEAR back and stops the credits. ([docs: Staking for Inference overview](https://docs.near.ai/cloud/staking-for-inference/overview))
- How many credits you get depends on how much you stake, the NEAR price and the staking APY, after the validator's commission (1–10%). The calculator page gives no formula; it points to cloud.near.ai for model prices and to your wallet for the APY. ([overview](https://docs.near.ai/cloud/staking-for-inference/overview), [calculator](https://docs.near.ai/cloud/staking-for-inference/calculator))
- The NEAR goes to the House of Stake "staking farm", whose configuration converts on-chain staking rewards into NEAR AI Cloud credits. ([API: get staking farm configuration](https://docs.near.ai/api-reference/staking-farm/get-staking-farm-configuration))
  - The production contract is `stake.dao` in House of Stake's own deploy runbook. It pools stake across whitelisted validators; you `lock`, later `unlock`, wait a set number of epochs, then `withdraw`. ([house-of-stake-contracts](https://github.com/houseofstake/house-of-stake-contracts): `staking-contract/docs/runbook/deploy-prod.md`, `staking-contract/README.md`)
- Credits belong to a NEAR AI Cloud **organization**. The staking API is per organization (`/v1/organizations/{org_id}/staking/farm`), needs a signed-in session (an API key won't do), and today works on the NEAR-signed-in user's **default** organization. ([API: organization staking farm state](https://docs.near.ai/api-reference/staking-farm/get-organization-staking-farm-state), [API: sync credits](https://docs.near.ai/api-reference/staking-farm/sync-organization-staking-farm-credits))
- Staking credits are spent before purchased credits (grant, then staking, then transfer, then payment, then postpay). ([nearai/cloud-api](https://github.com/nearai/cloud-api): `docs/credit-allocation.md`)
- Don't mix this up with NEAR AI **agent hosting**, which also uses staking but has different rules (a budget of staked NEAR ÷ 100 in USD a month, at least 50 NEAR for a first agent). ([NEAR AI blog](https://near.ai/blog/staking-for-near-ai))

## Steps for Victor

1. **Pick the org.** Decide which NEAR AI Cloud organization pays for Aftercall's inference. Under today's rules that is the default organization of the account you sign in with in step 3. See "Team org" below before staking from a personal account.
2. **Have the NEAR ready** in a mainnet NEAR wallet you control. No minimum is published for inference (see "Not confirmed").
3. **Sign in at [cloud.near.ai](https://cloud.near.ai/signin) with your NEAR wallet**, not email. Staking credits are tied to the NEAR-signed-in user. ([sync credits API](https://docs.near.ai/api-reference/staking-farm/sync-organization-staking-farm-credits))
4. **Stake from the org's Credits page.** The staking card there calls the House of Stake contract's `lock` through your wallet. Check the amount and the contract (`stake.dao` per the runbook above) in your wallet before you sign. (From [house-of-stake-contracts issue #228](https://github.com/nearai/house-of-stake-contracts/issues/228); the cloud UI's source is private, so the exact button names are **not confirmed**.)
5. **Check that credits arrive.**
   - The staking card on the Credits page.
   - Or, with a session token: `GET https://cloud-api.near.ai/v1/organizations/{org_id}/staking/farm`. Look at `sync_status`, `farm_credit_nano_usd`, `last_synced_at` and `last_sync_error`. A failed sync can still come back as HTTP 200, so read `sync_status`. ([API](https://docs.near.ai/api-reference/staking-farm/get-organization-staking-farm-state))
   - The org's balance: [get organization balance](https://docs.near.ai/api-reference/usage/get-organization-balance).
6. **Use the credits.** Create an API key for that org under **API Keys** on cloud.near.ai ([quickstart](https://docs.near.ai/cloud/quickstart)) and paste it into Aftercall → Settings → NEAR AI. Inference with that key draws on the org's credits.
7. **Tick the README item** only after step 5 shows credits on the org Aftercall's key belongs to.

## Team org

To fund a shared team org rather than your personal default org, NEAR AI Cloud has a newer *wallet binding* flow: `POST /v1/organizations/{org_id}/staking/farm/bind`, two steps with a signed wallet challenge (NEP-413). ([cloud-api: organization staking wallet binding](https://github.com/nearai/cloud-api/blob/main/docs/features/organization-staking-wallet-binding.md))

Read this before using it:

- **Binding is permanent.** The wallet is tied to that org for good, even after unstaking. The org can't be deleted, and the wallet's NEAR identity becomes a permanent admin of it. There is no unbind.
- It sits behind a feature flag (`STAKING_FARM_SELECTED_ORG_BINDING_ENABLED`) that defaults to off. Per issue #228 it is meant for active prepaid orgs, and starts from the org's Credits page.

If the Credits page doesn't offer to stake for the team org, the flag is off. Then either stake from a NEAR account whose default org *is* the team org, or ask NEAR AI.

## Not confirmed

- **Minimum stake for inference.** None is published. The 50 NEAR minimum is for agent hosting only.
- **Unstaking delay.** It is set by `epoch_unstake_settle_epochs` in the `stake.dao` configuration; the live value wasn't found. Ordinary NEAR staking pools take about 4 epochs (2–3 days), which may not hold here.
- **Whether team-org binding is switched on** in production.
- **The live conversion rate** (`credit_nano_usd_per_reward_unit`) and contract id that cloud.near.ai uses. The code's default is 1 USD per reward unit; the live values come only from the signed-in `/v1/staking/farm/config` endpoint.
- **The UI's wording**, since the cloud UI's source is private.
- **Anything from the hackathon about it.** [nearhackathon.com](https://nearhackathon.com/) and its [HACKATHON.md](https://nearhackathon.com/HACKATHON.md) don't mention staking or inference credits.
