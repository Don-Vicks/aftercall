# Design: the phone protocol (version 1)

Status: built, as the protocol for [phone.md](phone.md) version 1. The shared cryptography and message checks are in `packages/core/src/relay/` (`crypto.ts`, `messages.ts`), the Mac's snapshots and action loop in `mac.ts` and the phone's side in `phone.ts`, each tested next to it; the relay is in `apps/backend/src/relay/` (`relay.test.ts`), the Mac's pairing sheet in `apps/desktop/src/PhoneSettings.tsx` with its Keychain item in `src-tauri/src/phone.rs`, and the phone page in `apps/web/app/phone/`. The parts have run together only in tests and against `pnpm dev:phone`'s in-memory relay and made-up Mac, not yet the Mac app, the deployed relay and a real phone at once.

Three parties:

- **The Mac app** holds the meetings and does every send and payment, as today.
- **The backend relay** (`apps/backend`) passes opaque boxes between the Mac and the phone. It can't read them or forge them.
- **The phone page**, a PWA at `/phone` on the web app (`https://getaftercall.vercel.app/phone`). It shows what waits for you and sends back your taps.

Version 1 has no push notifications. The phone asks the relay for news every 10 seconds while the page is open and visible, and not at all when it's closed: open it to see what waits. Push comes later (phone.md, build order step 3).

## What the phone gets, and what it never gets

| | On the phone | Why |
| --- | --- | --- |
| Payee name and NEAR account, amount, the words it was heard as, route chain and address | Yes | Needed to approve a payment |
| Recap's address, name, subject | Yes | Needed to approve a send |
| The quote from the transcript behind the follow-up | Yes | It's what you approve |
| "What leaves" lines (`emailWhatLeaves`, `paymentWhatLeaves` in `packages/core/src/followups/boundaries.ts`) | Yes | The same boundaries as on the Mac's cards |
| Meeting title and start time | Yes | To tell meetings apart |
| Summary, decisions, action items, transcript, your notes, proofs | Never | Not needed to approve anything |
| A held payment's wallet links (`signUrls`): your NEAR account, the contract, and what's left of today's cap | Yes, for a payment held over a cap | The wallet page shows them, as from the Mac's wallet screen |
| The app's NEAR key, your rules, payee list, and your caps otherwise | Never | Rules and keys stay on the Mac and in your wallet |

Every item is built by `toPendingItem` and every snapshot is checked against `SnapshotSchema` before it's sealed: `sealSnapshot` seals the parsed copy, so a field outside the schema (a summary, a transcript) can't ride along even by mistake. A test checks this ("fields outside the schema never ride along…").

## 1. Pairing

```
 Mac                               Relay                              Phone
  │ newPairing(backend)              │                                   │
  │ POST /relay/pairings ───────────▶│ stores sha256(id), macTokenHash   │
  │ shows QR: https://getaftercall.vercel.app/phone#pair=<payload>       │
  │                                  │                     scans the QR  │
  │                                  │   decodePairing(location.hash)    │
  │                                  │   newRelayKeys() → IndexedDB      │
  │                                  │◀── POST …/hello {box} ────────────│ sealHello(…)
  │ GET …/hello (every 2 s) ────────▶│                                   │
  │ openHello → deriveSession        │                    deriveSession  │
  │ shows "418 207"                  │                  shows "418 207"  │
  │ you press "They match"           │                                   │
  │ POST …/confirm {phoneTokenHash} ▶│ state: active                     │
  │ POST …/snapshot {box} (n = 1) ──▶│◀── GET …/snapshot (every 10 s) ───│ openSnapshot: paired
```

### The QR code

The Mac calls `newPairing(BACKEND_URL)`, which makes:

- an X25519 key pair for this pairing (`mac.secretKey`, `mac.publicKey`);
- a random 32-byte **pairing id**. Its base64url text (43 characters, `pairingIdText`) addresses the pairing on the relay and is the capability to post a hello;
- a random 32-byte **Mac token** (base64url). It never goes in the QR: it's the Mac's bearer token on the relay, which stores only its sha256.

The QR encodes `pairingUrl("https://getaftercall.vercel.app/phone", pairing)`:

```
https://getaftercall.vercel.app/phone#pair=<payload>
payload = base64url(JSON {"v":1,"mac":"<32-byte X25519 public key, base64url>","id":"<pairing id, base64url>","api":"<backend origin>"})
```

The pairing rides in the fragment, which browsers never send to a server, so the web app's host never sees it. `decodePairing` refuses another version, a key that isn't 32 bytes, a payload over 400 characters, and a backend that isn't `https://` (or `http://localhost`, `127.0.0.1`, `[::1]` for development) or has a path, query or credentials. The phone page removes the fragment with `history.replaceState` as soon as it has read it.

The Mac shows the QR for 10 minutes at most (the relay forgets an unconfirmed pairing then), with Cancel. Cancel, or closing the sheet, deletes the pairing (`DELETE /relay/pairings/:id`).

### The hello

The phone makes its own X25519 key pair for this pairing (`newRelayKeys()`) and keeps it in IndexedDB. It posts `sealHello(pairing, phone.publicKey, device)`, where `device` is a short label such as "iPhone · Safari" (cut to 40 characters) for the Mac's settings. The hello box is:

```
[0x01 version][ephemeral X25519 public key, 32][nonce, 24][XChaCha20-Poly1305 ciphertext + tag]
key   = HKDF-SHA256(ikm = X25519(ephemeral, Mac key), salt = pairing id bytes, info = "aftercall-relay-v1 hello", 32 bytes)
aad   = the version byte
plain = JSON {"phone": "<phone public key, base64url>", "device": "…"}, padded with spaces to 512 bytes
```

Only the Mac can open it (`openHello`), and it's bound to this pairing id. Every hello is 780 characters, whatever the label.

The relay keeps the first hello for a pairing and refuses any other (409 `HELLO_TAKEN`). If someone who photographed the QR posts first, your phone is told "Someone else used this code. Cancel on your Mac and make a new one", and the Mac shows a code your phone doesn't: you press Cancel.

### The session and the code

Both sides call `deriveSession` with their own secret key and the other's public key:

```
transcript = SHA-256("aftercall-relay-v1" ‖ pairing id ‖ Mac public key ‖ phone public key)
okm        = HKDF-SHA256(ikm = X25519 shared secret, salt = transcript, info = "aftercall-relay-v1 keys", 64 bytes)
key        = okm[0..32]    the envelope key, both directions
phoneToken = base64url(okm[32..64])    the phone's bearer token on the relay
code       = (first 8 bytes of SHA-256("aftercall-relay-v1 code" ‖ transcript), big-endian) mod 1,000,000, six digits
```

A low-order public key (all-zero shared secret) is refused. A key swapped in by anyone else gives a different transcript, so the two screens show different codes (tested: "a key swapped in by someone who saw the QR gives different codes and keys").

Both screens show the code, grouped "418 207". The Mac asks "Does your phone show 418 207?" with **They match** and **Cancel**. Until you press They match:

- the Mac posts no snapshot and reads no action;
- the relay answers the phone's snapshot request with 409 `NOT_CONFIRMED`, and refuses actions;
- the phone shows the code and "Check your Mac shows the same code, then press They match there."

On They match the Mac posts `relayTokenHash(session.phoneToken)` to `/confirm` and its first snapshot. The phone counts itself paired when that first snapshot opens with its key: only a Mac holding the secret behind the QR's key could have sealed it.

One phone per Mac in version 1. Pairing again replaces the old pairing: the Mac deletes the old one on the relay first.

## 2. Envelopes

Everything after pairing travels as an envelope (`sealEnvelope`, `openEnvelope`):

```
box   = base64url([0x01 version][nonce, 24 random bytes][XChaCha20-Poly1305 ciphertext + tag])
key   = session.key
aad   = the version byte
plain = JSON {"dir": "mac-to-phone" | "phone-to-mac", "n": <counter>, "body": <message>}, padded with spaces
```

- **Version.** A box whose first byte isn't 1 is refused (`BAD_VERSION`) before decryption. A later version is chosen when pairing, never by retrying.
- **Direction.** The Mac only seals `mac-to-phone` (snapshots); the phone only `phone-to-mac` (actions). A box sent back to its sender fails (`WRONG_DIRECTION`).
- **Counter.** Each sender counts its boxes from 1, adds 1 for every box, and keeps the counter across restarts. Each receiver keeps the highest counter it has accepted from the other side (`lastN`, 0 at first) and refuses a box whose `n` isn't above it (`REPLAY`): a replayed box, or an older one delivered after a newer one. The receiver saves the new `n` only after it has acted on the box.
- **Padding.** An action always pads to 1,024 bytes, so the relay can't tell an approve from a dismiss by its size. A snapshot pads to the next 1 KiB.
- **Limits.** Plaintext at most 1,024 bytes for an action and 65,536 for a snapshot (`RELAY_LIMITS`); box text at most 1,420 and 87,436 characters, and 780 for a hello (`RELAY_BOX_LIMITS`). Over the limit, sealing throws `TOO_LARGE` and opening refuses before decrypting.
- **Failures.** A tampered byte or the wrong key fails as `BAD_BOX`; a body that doesn't match the schema as `BAD_MESSAGE`. All are `RelayError` with a stable `code`; nothing about the content is in the message.

## 3. Messages

Both are zod schemas in `packages/core/src/relay/messages.ts`. Amounts are USDC base units (6 decimals) as digit strings; times are ms since epoch unless named otherwise.

### The Mac's snapshot (`SnapshotSchema`)

```json
{
  "t": "snapshot",
  "at": 1762440000000,
  "network": "testnet",
  "items": [
    {
      "kind": "payment",
      "meetingId": "1762000000", "followUpId": "f2",
      "meetingTitle": "Sync with Ada", "meetingAt": "2026-11-06T14:02:00Z",
      "status": "proposed",
      "quote": "send Kemi the twenty dollars for the icons",
      "payeeName": "Kemi", "payeeAccount": "kemi.testnet", "payeeListed": true,
      "amount": "20000000", "heard": "the twenty dollars",
      "route": { "chain": "solana", "address": "8xKemi…", "quotedOut": "19750000", "quotedAt": 1762439990000 },
      "whatLeaves": { "summary": "Public on NEAR, nothing from the meeting.", "details": ["On NEAR, publicly and for good: …"] }
    },
    {
      "kind": "email",
      "meetingId": "1762000000", "followUpId": "f1",
      "meetingTitle": "Sync with Ada", "meetingAt": "2026-11-06T14:02:00Z",
      "status": "proposed", "autopilotAt": 1762440042000,
      "quote": "send Ada the recap",
      "to": "ada@example.com", "toName": "Ada", "subject": "Recap: Sync with Ada",
      "whatLeaves": { "summary": "Draft in Mail keeps it on this Mac.", "details": ["The recap holds the summary, 1 decision, …"] }
    }
  ],
  "more": 0,
  "done": [{ "kind": "payment", "meetingTitle": "Sync with Ada", "label": "Paid Designer 50.00 USDC", "doneAt": "14:06", "byAutopilot": true }],
  "results": [{ "n": 3, "outcome": "refused", "reason": "It changed on your Mac since your phone showed it. Look again." }]
}
```

Item fields, both kinds: `meetingId`, `followUpId` (`[A-Za-z0-9_.:-]`, 1–80), `meetingTitle` (≤120), `meetingAt` (the meeting's `startedAt`), `status` (`proposed`, `sending`, `blocked`, `failed`), `quote` (≤500), optional `error` (≤300, the follow-up's plain-words error), `autopilotAt`, `autopilotHeld`, `whatLeaves` ({`summary`, up to 5 `details`}), and `sample` (from the made-up sample meeting: approving it is simulated, as in the app; the phone labels it "Sample").

- **email:** `to` (empty until you add an address on the Mac), `toName`, `subject`.
- **payment:** `payeeName`, `payeeAccount` (empty when not on your list), `payeeListed`, `amount` (null when the words didn't read as an amount), `heard`, `route` (null, or `chain` `solana` | `base`, `address`, and the Mac's last preview quote `quotedOut`/`quotedAt` if it has one), and for a **held** payment (`status: "blocked"`) `signUrls: {approve, decline}`.

`toPendingItem(meeting, followUp, options)` builds each item from the follow-up and the meeting's title and start only; it returns null for `sent`, `paid` and `dismissed`. Text is clipped to the limits. `toDoneItem` builds the done list. `fitSnapshot` keeps a snapshot under the limit: at most 40 items, newest first; older ones are dropped and counted in `more` (the phone says "and 3 more on your Mac"), then the done list is cut.

`results` holds the latest outcomes of the phone's actions (at most 20, newest first) by the action's counter: `accepted` (the Mac ran it: "Your Mac is sending it") or `refused` with the reason.

### The phone's action (`PhoneActionSchema`)

```json
{ "t": "action", "kind": "approve", "meetingId": "1762000000", "followUpId": "f2", "digest": "9f2c…64 hex", "at": 1762440005000 }
```

`kind` is `approve`, `dismiss` or `undo-autopilot`. `digest` is `itemDigest(item)` of the item as the phone showed it: a SHA-256 over what you approve (kind, ids, and the payee account, listed flag, amount and route for a payment; the address and subject for a recap). The envelope carries the counter.

## 4. The relay (backend)

A new NestJS module, `apps/backend/src/relay/`, with a memory store for tests and a Postgres store, wired like `claims/`. `:id` is the pairing id's 43-character base64url text; anything else is 400 `BAD_PAIRING`. Bearer tokens go in `authorization: Bearer <token>`; the relay hashes them (`sha256` of the token's text, hex, as `relayTokenHash` and claim tokens do) and compares. Errors are `HttpException`s with a code as the message, as in `claims/`.

| Method and path | Who | Auth | Body | Answer |
| --- | --- | --- | --- | --- |
| `POST /relay/pairings` | Mac | none | `{id, macTokenHash}` | 201 `{expiresAt}`; 409 `PAIRING_EXISTS` |
| `POST /relay/pairings/:id/hello` | phone | none: knowing the id is the capability | `{box}` ≤ 780 | 200 `{ok}`; 409 `HELLO_TAKEN` once a hello is stored or the pairing is active; 404 `NO_PAIRING` |
| `GET /relay/pairings/:id/hello` | Mac | Mac token | | `{box}` or `{box: null}` |
| `POST /relay/pairings/:id/confirm` | Mac | Mac token | `{phoneTokenHash}` (64 hex) | 200 `{ok}`; 409 `NO_HELLO` |
| `POST /relay/pairings/:id/snapshot` | Mac | Mac token | `{box}` ≤ 87,436 | 200 `{version}`; 409 `NOT_CONFIRMED` |
| `GET /relay/pairings/:id/snapshot?after=<version>` | phone | phone token | | `{now, version, postedAt, macSeenAt, box?}`; `box` left out when `version` ≤ `after`; 409 `NOT_CONFIRMED` before confirm |
| `POST /relay/pairings/:id/actions` | phone | phone token | `{box}` ≤ 1,420 | 200 `{seq}`; 429 `TOO_MANY_ACTIONS` with 50 waiting |
| `GET /relay/pairings/:id/actions` | Mac | Mac token | | `{actions: [{seq, box, postedAt}]}`, oldest first, at most 50 |
| `POST /relay/pairings/:id/ack` | Mac | Mac token | `{seq}` | 200 `{ok}`: deletes the pairing's actions up to `seq` |
| `DELETE /relay/pairings/:id` | either | Mac or phone token | | 200 `{ok}`: deletes the pairing, its snapshot and its actions |

A wrong token is 401 `BAD_TOKEN`; an unknown or expired pairing 404 `NO_PAIRING`; a box that isn't base64url 400 `BAD_BOX`; one over its limit 413 `TOO_LARGE`; a token hash that isn't 64 lowercase hex 400 `BAD_HASH`; an `ack` without a whole `seq` 400 `BAD_SEQ`; an `after` that isn't a whole number 400 `BAD_AFTER`. Every request the Mac makes with its token sets `mac_seen_at`. CORS: the phone page is on `WEB_ORIGIN`, which `main.ts` already allows with GET, POST and DELETE; the JSON body limit (100 kB in Nest by default) holds the largest snapshot.

**Keeping.** A snapshot is replaced on each post (`version` goes up by one). Actions stay until the Mac acknowledges them, or 24 hours. A pairing not confirmed within 10 minutes of creation is gone; a confirmed one is gone 30 days after the Mac last called. Expired rows are deleted on the next write and treated as gone on reads.

**Limits** (the existing `DailyCounts`, keys made with `limitKey`): 20 pairings and 20 hellos per IP per day; 3,000 snapshots and 300 actions per pairing per day; over a limit is 429 (`IP_DAILY_LIMIT` per IP, `DAILY_LIMIT` per pairing). A hello for an unknown id still counts too (an id is 32 random bytes, so it can't be guessed anyway). Reads aren't counted: the phone polls every 10 s only while visible (`PHONE_POLL_MS`) and the Mac every 10 s while running (`MAC_POLL_MS`).

**Tables.**

```sql
CREATE TABLE IF NOT EXISTS relay_pairings (
  id_hash          text PRIMARY KEY,   -- sha256 of the pairing id's text, hex
  mac_token_hash   text NOT NULL,
  phone_token_hash text,               -- set by /confirm
  hello            text,               -- the sealed hello, until /confirm clears it
  state            text NOT NULL CHECK (state IN ('waiting', 'active')),
  created_at       bigint NOT NULL,
  expires_at       bigint NOT NULL,
  mac_seen_at      bigint NOT NULL,
  snapshot         text,               -- the latest sealed snapshot
  snapshot_version integer NOT NULL DEFAULT 0,
  snapshot_at      bigint
);
CREATE TABLE IF NOT EXISTS relay_actions (
  seq       bigserial PRIMARY KEY,
  id_hash   text NOT NULL REFERENCES relay_pairings (id_hash) ON DELETE CASCADE,
  box       text NOT NULL,             -- one sealed action
  posted_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS relay_actions_pairing ON relay_actions (id_hash, seq);
```

A test checks the live tables have exactly these columns, as `CLAIM_COLUMNS` does for claims.

**What the backend can see:** opaque boxes and their sizes (padded), when each side calls, how many actions wait, the pairing id and tokens in transit (stored only as sha256), and the caller's IP for the per-IP limits (counted under a hash, as today). **What it can't:** any key, any item, payee, amount, address, quote or meeting title, which kind of action you tapped, or which device you use (the label is inside the hello). It can't forge a box either: it holds no key. What it can do is withhold or delay boxes; the phone then shows your Mac as offline, and nothing runs.

## 5. The Mac

**Storage.** The Mac's secret key, its token and the session key go in the macOS Keychain, like the app's NEAR key. Beside the app data: the pairing id, backend, the phone's label and public key, the paired time, the snapshot counter it last used, the highest action counter it accepted, and the last acknowledged `seq`.

**Snapshots.** After pairing, and whenever a pending follow-up or the done list changes (at most one post every 5 s), the Mac posts a fresh snapshot with counter + 1, saved before it posts. Items: every follow-up with status `proposed`, `sending`, `blocked` or `failed`, newest meeting first, built with `toPendingItem` and the same options as the app's own cards: `backend: HAS_BACKEND`, `claimLinks`, `route` from `routeFor`, `quoted` from the latest preview quote, `sample: true` for the sample meeting, and for a held payment `signUrls` built the way the wallet screen builds Review and Decline (`SIGN_URL#encodeSignRequest(…)` with `approve` and `cancel`, the contract follow-up id `contractFollowupId(meeting.id, f.id)`, and the same `context`). A meeting waiting out its delete Undo is left out. Done: follow-ups `sent` or `paid` in today's meetings. Then `fitSnapshot`, then `sealSnapshot`.

**Actions.** Every 10 s while Aftercall runs and a phone is paired, the Mac fetches waiting actions and, in `seq` order:

1. `openAction(session.key, lastActionN, box)`. If it throws, the action is skipped and acknowledged; nothing runs.
2. Finds the meeting and follow-up, rebuilds its item with `toPendingItem` (same options as the snapshot), and calls `checkPhoneAction(action, followUp, item, Date.now())`. It refuses when the follow-up is gone or no longer waits, when its digest differs (an amount, payee, route, address or subject changed since the phone showed it), when the action is over 24 hours old, when it's already sending, and for approve when the app's own Approve wouldn't be offered: a held payment (approve or decline it in the wallet), a recap with no address, a payee not on your list, an amount that didn't read.
3. If it passes, the Mac runs exactly what the app's own button runs after its 5 s window, and nothing more: `approve` → `handlersFor(meeting).onApprove(followUpId)` (App.tsx), `dismiss` → `onDismiss`, `undo-autopilot` → `onUndoAutopilot`. The contract still enforces the payee list and the caps; a payment on Solana or Base takes a fresh 1Click quote and is refused over 3% in fees, as in the app.
4. Saves `n` as `lastActionN`, records `{n, outcome, reason}` for the next snapshot's `results`.

Then it posts `/ack` with the last `seq` and a new snapshot.

**Held payments.** The phone opens the wallet directly; the Mac isn't needed. While a phone is paired, the Mac checks each held payment on the contract when it refreshes the wallet (`near.paymentState`, as the wallet screen does after you sign there: `is_paid`, `get_pending`) and marks it paid, or dismissed once it's no longer pending and wasn't paid.

**Settings.** A Phone section: Pair a phone (the QR sheet and the code), the paired phone's label and date, and Unpair (`DELETE` with the Mac token, then forget the Keychain items).

**QR code.** The repo has no QR encoder. The Mac needs one small, dependency-free, MIT-licensed encoder (for example `qrcode-generator` or `uqr`), rendering to SVG in the web view.

## 6. The phone page

A client page at `/phone` in `apps/web`, with a web app manifest scoped to `/phone` so it can be added to the home screen. It reuses `app/ui.tsx` and the CSS module tokens.

**Storage.** One IndexedDB record (database `aftercall-phone`, store `pairing`): the pairing (Mac public key, pairing id, backend), the phone's key pair, the session key and phone token, the counter it last used for an action, the highest snapshot counter it accepted with the relay `version` it came with, and the last snapshot itself, so the inbox shows at once and while offline. It is the browser's storage for this site: anyone with your unlocked phone can open the page, as with the Mac app. Unpairing clears it.

**Polling.** `GET …/snapshot?after=<version>` every 10 s while `document.visibilityState` is `visible`, and once when the page becomes visible. A new box opens with `openSnapshot(key, lastN, box)`; if it fails, the page keeps the last good snapshot and says "Couldn't read an update from your Mac." 401 or 404: the pairing is gone; the page clears it and asks you to pair again.

**Offline.** With `now - macSeenAt` over 60 s (`MAC_OFFLINE_AFTER_MS`, on the relay's clock), the page says "Your Mac is offline (last seen 14:02). It will do what you tap here when Aftercall is open again." Taps are still sent: the relay keeps them for 24 hours.

**Taps.** Approve and Dismiss show a 5 s Undo on the phone first (`PHONE_UNDO_MS`, the app's own window), then send `sealAction` with counter + 1, saved before it posts. Undo on an autopilot countdown sends `undo-autopilot` at once. The card says "Sent to your Mac" until a snapshot's `results` has that counter, then the outcome. Items the Mac would refuse (no address, payee not listed, amount unclear, held) show why and offer no Approve.

**Held payments.** "Approve in wallet" and "Decline" open `signUrls.approve` and `signUrls.decline`, the existing `/sign` page, which signs with NEAR Connect (Meteor, Intear and others) on the phone as it already does. The page opens them only if `signUrlsMatch(item, location.origin, snapshot.network)` holds: on this site's own `/sign`, approving and declining exactly this payee, amount and follow-up. Otherwise it says "Review this on your Mac."

**Unpair.** `DELETE` with the phone token, then clear IndexedDB.

## 7. Not in version 1

Push notifications; more than one phone per Mac; changing an amount, address or payee on the phone; claim links; Draft in Mail; recording on the phone (phone.md version 2).

## Who builds what

| Part | Where | Tests |
| --- | --- | --- |
| Crypto and messages (built) | `packages/core/src/relay/crypto.ts`, `messages.ts` | `crypto.test.ts`, `messages.test.ts` |
| Relay (built) | `apps/backend/src/relay/` (controller, service, memory and Postgres stores), `app.module.ts` | `relay.test.ts`: routes, tokens, limits, TTLs, replace-on-post, ack, cascade on unpair, the stored columns |
| Mac (built) | pairing sheet and Settings → Your phone (`PhoneSettings.tsx`), relay client and sync (`phone.ts`, `phoneSync.ts`), snapshot builder and action loop (`packages/core/src/relay/mac.ts`), the `phone-relay` Keychain item and `phone.json` (`src-tauri/src/phone.rs`) | `mac.test.ts`; `phone.rs` tests for the Keychain item, `phone.json` and counters |
| Phone page (built) | `apps/web/app/phone/`, its logic in `packages/core/src/relay/phone.ts` | `phone.test.ts`, against the in-memory relay and made-up Mac in `testkit.ts` |
