# Design: Aftercall on a phone

Status: version 1 is built without push notifications (build order steps 1 and 2 below): the relay in the backend, Settings → Your phone on the Mac, and the phone page at `/phone` in the web app. Steps 3 (push notifications) and 4 (version 2, in-room recording) are not; until push lands, the phone checks for news every 10 s while it's open, and its settings are pairing and Unpair. The exact protocol, and what is tested where, is [phone-protocol.md](phone-protocol.md). The Mac app, the deployed relay and a real phone have not yet run it together.

## The idea

The Mac records the call and makes the notes. The phone is where you say yes to what the meeting wants to do next, from anywhere, without opening your laptop. Later, it can also record meetings in the room.

A phone can't record another app's call: iOS and Android don't allow it. So the phone app isn't a smaller copy of the Mac app. It does two jobs the Mac can't do well:

1. **Act on follow-ups away from your desk.** The meeting ends, you walk to the next one, and the recap and the agreed payment still go out because you tapped Approve on your phone.
2. **Record meetings in the room** (version 2). The phone on the table records, and the notes are made in the same secure hardware.

## Screens (version 1)

```
┌───────────────────────────┐   ┌───────────────────────────┐   ┌───────────────────────────┐
│ Needs you            (3)  │   │ ← Pay Kemi                │   │ ← Held for your wallet    │
│                           │   │                           │   │                           │
│ ● Pay Kemi        20 USDC │   │ 20.00 USDC                │   │ Designer     5,000 USDC   │
│   Sync with Ada · 14:02   │   │ to kemi.near              │   │ Over your 100 USDC        │
│   On Solana via Intents   │   │ USDC on Solana via NEAR   │   │ per-payment cap.          │
│                           │   │ Intents · Kemi gets 19.75 │   │                           │
│ ● Recap to Ada            │   │                           │   │ Only your NEAR wallet     │
│   Autopilot sends in 0:42 │   │ “send Kemi the twenty     │   │ can approve this. The     │
│   [Undo]                  │   │  dollars for the icons”   │   │ app's key can't.          │
│                           │   │                           │   │                           │
│ ● Designer   5,000 USDC   │   │ What leaves: on NEAR,     │   │ [Approve in wallet]       │
│   Held for your wallet    │   │ publicly: kemi.near, 20   │   │ [Decline]                 │
│                           │   │ USDC, “Aftercall payment”.│   │                           │
│ Done today                │   │ Nothing from the meeting. │   │                           │
│ ✓ Paid Designer 50 USDC   │   │                           │   │                           │
│ ✓ Recap sent to Ada       │   │ [Dismiss]   [Approve]     │   │                           │
└───────────────────────────┘   └───────────────────────────┘   └───────────────────────────┘
       Inbox                         A follow-up                    Over a cap
```

- **Inbox:** everything waiting for you across meetings, newest first, and what went out today. A push notification when something new lands, or when autopilot starts a countdown you might want to stop.
- **A follow-up:** the same card as on the Mac: the amount, who, the route, the quote it came from, and "What leaves". Approve or Dismiss.
- **Over a cap:** the payment waits for your NEAR wallet; the button opens it (Meteor, Intear, or any wallet NEAR Connect supports), as the web `/sign` page already does on a phone today.

Settings on the phone stay small: pair with a Mac, notifications on or off, and sign out. Rules, caps and payees stay on the Mac and in your wallet.

## Privacy: what the phone may know

Today a meeting never leaves the Mac except to NEAR AI's secure hardware. The phone must not weaken that.

| | Version 1 | Why |
| --- | --- | --- |
| Payee, amount, route, status | Yes | Already public on NEAR once paid; needed to approve |
| Who a recap goes to, its subject | Yes | Needed to approve a send |
| The quote behind a follow-up | Yes, end-to-end encrypted | It's what you're approving |
| Summary, transcript, your notes | No | Not needed to approve anything |

How it travels: the Mac and phone pair once with a QR code, which exchanges keys. The Mac encrypts each pending item to the phone's key and posts it to the backend as an opaque blob; the backend relays blobs it can't read: it keeps only the latest one, replaced on each post, keeps the phone's taps until the Mac collects them or for a day, and forgets the pairing 30 days after the Mac last called (never readable; [phone-protocol.md](phone-protocol.md), "Keeping"). The phone's tap goes back the same way, and the Mac does the actual sending or paying, with the same limited NEAR key and the same caps. The phone never holds the app's NEAR key.

## What runs where

- **The Mac** still makes every request to NEAR AI and NEAR. If the Mac is asleep, an approval waits until it wakes; the phone says so ("Your Mac will send this when it's back online").
- **Held payments** need no Mac at all: the phone opens your wallet, and the contract does the rest.
- **The backend** gains a small relay: encrypted blobs in, encrypted blobs out, with push notifications that carry no content ("1 item needs you").

## Version 2: meetings in the room

Record on the phone with a consent tick, as on the Mac. The audio goes from the phone to NEAR AI through the same attestation checks, and the notes come back to the phone, then sync to the Mac encrypted. Every check in `packages/core` is TypeScript already, so the phone (React Native, or Tauri on mobile) reuses it.

## Build order

1. Pairing and the encrypted relay (backend and Mac).
2. Inbox and approve/dismiss (phone), held payments through the wallet.
3. Push notifications.
4. In-room recording.

Estimate: version 1 is two to three weeks of work; version 2 adds about as much again.
