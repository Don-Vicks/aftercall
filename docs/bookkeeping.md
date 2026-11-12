# For bookkeepers

Aftercall pays people in USDC from an agent wallet on NEAR. Its money trail comes out as a CSV file that opens in Numbers, Excel or Google Sheets. There's one row per payment, deposit and withdrawal, showing where it stands now, and each row links the NEAR transaction behind it.

A real one, read from NEAR testnet: [ledger-demo-owner.csv](ledger-demo-owner.csv) (test accounts `demo-owner` and `demo-freelancer`, `.aftercall.testnet`, 12 Nov 2026).

## Columns

| Column | What it holds |
| --- | --- |
| Date (UTC) | When the row reached its status: the time of the transaction in the Transaction column, ISO 8601 in UTC (`2026-11-12T09:49:30Z`). The Mac app's export says **Meeting date (UTC)** instead and holds the meeting's start. |
| Meeting | The meeting the payment came from: its title in the Mac app, its id when read from NEAR. Empty when no meeting is linked. |
| Payee, Payee account | The payee's label and their NEAR account. For a deposit it's your agent wallet; for a withdrawal it's you. |
| Amount, Currency | USDC, with two decimals and no thousands separator (`5000.00`). An amount with fractions of a cent keeps them rather than being rounded. |
| Status | Where the money stands. See the list below. |
| Approved by | Who let it move. See the list below. |
| Transaction | The NEAR transaction that put the row in its status, on the NEAR explorer. |
| Meeting proof | The transaction that recorded the meeting's proof hash on NEAR. It shows that the meeting's notes were sealed before the payment pointed to them. |
| Note | What happened to the money, in a sentence or two, including any earlier transaction (for example, when a payment was held). |

## Statuses

| Status | Did money leave the agent wallet? |
| --- | --- |
| paid | Yes, to the payee, within your caps. |
| held for approval | No. It was over a cap, so the contract holds it until your own wallet approves or declines it. |
| approved and paid | Yes. It was held over a cap, then approved in your wallet, which paid it. |
| declined | No. It was held, then declined in your wallet. |
| in escrow | Set aside in the contract for a deal, and not paid yet. It still counts against your caps. |
| released | Yes, to the payee, out of escrow, after they confirmed the terms from their own account. |
| returned | No. A deal's money went back to your agent wallet: the payee gave it back, or you took it back. |
| failed and refunded | No. The transfer didn't land, and the amount came back. |
| sent to NEAR Intents | Yes, to NEAR Intents, which pays a payee on Solana or Base but hasn't confirmed it has. Mainnet only. |
| deposited | In: USDC from your NEAR account into the agent wallet. |
| withdrawn | Out: USDC from the agent wallet back to your NEAR account. |

## Approved by

- **you**, **you, on your phone**, **autopilot**: what the Mac app records for a payment it made.
- **you or autopilot**: a row read from NEAR and signed by Aftercall's limited key. The chain can't tell whether you tapped Pay or autopilot ran it.
- **your wallet**: signed by your own NEAR wallet, which is needed for anything over a cap and for deposits and withdrawals.
- **the payee confirmed**, **the payee confirmed, then you released it**: how a deal held in escrow was paid.
- **the payee**: the payee gave a deal back.
- Empty: nobody has yet, as with a payment held for your wallet.

Statuses and amounts come from the contract and its transactions, never from the meeting's notes.

## Making one

- **Mac app:** Agent wallet → Export (top right) → Copy as CSV. This copies the CSV to the clipboard, the same way a meeting is copied as Markdown. Paste it into a text file saved as `.csv`. The Mac app knows each payment's meeting but not the exact time the money moved, so its date column holds the meeting's start; the linked transaction has the exact time.
- **From NEAR, for any owner:** `pnpm --filter @aftercall/core ledger -- <owner account> --out ledger.csv` (add `--network mainnet --contract <account>` for mainnet). It's read-only and needs no key: it lists the owner's transactions from the NearBlocks API, reads each one from FastNEAR's archival RPC, and asks the contract's views (`is_paid`, `get_pending`, `get_escrow`) where each payment stands now. Calls the contract refused moved nothing, so they're listed on screen rather than as rows. The free APIs allow only a few calls a minute, so the script waits when they ask it to.

The file is RFC 4180 CSV in UTF-8: a header row, every field in double quotes, CRLF line ends. Text that would start a spreadsheet formula (`=`, `+`, `-`, `@`) gets a leading apostrophe, so nothing said on a call can run as a formula.

Code: `ledgerCsv` and `ledgerRowsFromMeetings` in `packages/core/src/export.ts`, the chain reader in `packages/core/src/wallet/ledger.ts`, the script in `packages/core/scripts/ledger.ts`. Tests: `export.test.ts` and `wallet/ledger.test.ts`, which run on real testnet transactions from 12 Nov.
