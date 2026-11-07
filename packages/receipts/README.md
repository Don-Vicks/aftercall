# @aftercall/receipts

Check an Aftercall meeting proof, or one shared line of a meeting, from your own code. It runs the same checks as the public `/verify` page, without the page, in Node 20+ or a browser. It is plain ESM with type definitions, and its only dependencies are `@noble/hashes` and `@noble/curves`.

It isn't on npm yet. To try it, build it from this repo with `pnpm --filter @aftercall/receipts build`, or make a tarball with `npm pack` in `packages/receipts`.

## What it checks

`verifyProofLink(link)` takes a proof link (Copy proof link in the Mac app's Verify sheet):

- **On NEAR:** reads `get_proof(owner, meeting_id)` from the link's agent-wallet contract over NEAR's public RPC, and checks the proof's sha256 (the bundle in canonical JSON) matches it.
- **Signed:** the summary's signature over the exact request and response hashes in the proof (secp256k1 or Ed25519), for every request of a long call.
- **Attested:** the signing key is bound, next to the meeting's nonce, in a TEE quote's report data that the app recorded, and the signer's setup file matches its `mr_config`.
- **End-to-end encrypted:** the key the transcript was encrypted to is bound in the summary TEE's recorded report data.
- **Private model:** the model is a NEAR AI Confidential TEE model, with a verified attestation in the proof.
- **NVIDIA:** the GPU token in the proof against NVIDIA's published keys, when the proof has one.

`verifyLineLink(link)` takes a line link (Share this line in the Mac app). It runs all of the above, plus **Line is in the transcript the proof commits to**: the line's leaf (its index, time, side and words, with its salt) and its Merkle path lead to the transcript root inside the proof. That root is covered by the proof hash on NEAR.

Each check comes back with a label, `ok` and a plain-words detail. `ok` on the receipt means every check passed, and so did every check the app recorded in the proof.

## Usage

```js
import { verifyLineLink } from "@aftercall/receipts";

const r = await verifyLineLink("https://getaftercall.vercel.app/verify#line=eyJidW5…");
console.log(r.ok ? "Checks out" : "Doesn't check out", `· recorded by ${r.owner}`);
console.log(`“${r.line.text}” · ${r.line.speaker === "you" ? "recorder's mic" : "the call's audio"} · ${r.line.at}s in`);
for (const c of r.checks) console.log(c.ok ? "✓" : "✗", c.label, "·", c.detail);
// Pass your own fetch (tests, a proxy): verifyLineLink(link, { fetch })
// Proof links: verifyProofLink(link). Bad links throw BAD_LINK; a proof link passed to
// verifyLineLink throws NOT_A_LINE_LINK.
```

The Merkle helpers are exported too: `lineLeafHash`, `merkleRoot`, `merklePath`, `rootFromPath`, `lineTreeOf`, `proveLine`, `checkLineProof`, `lineSalt`. The tree has RFC 9162's shape, with leaves hashed as `sha256(0x00 ‖ JSON [index, at, speaker, text, salt])` and nodes as `sha256(0x01 ‖ left ‖ right)`.

## What it can't prove

- That anyone else heard a shared line. It shows the line is in the transcript the recorder's Mac committed to in its proof on NEAR, with that proof's checks.
- That NEAR AI's model was given that exact line. The Mac commits to its transcript in the proof; NEAR AI's signature covers the encrypted request as a whole, not each line.
- That the transcript is accurate (Whisper can mishear), or that it came from the attested Whisper TEE: NEAR AI doesn't sign transcriptions.
- Who said a line. `speaker` is the side: the recorder's microphone or the call's audio, never a name.
- That the Intel quotes were genuine. The app verified them with Intel when it made the notes, and the proof records the values it read. This package re-checks the values; it can't re-run Intel's verification, because the quotes aren't in the link.
- That everyone on the call agreed to be recorded, or what NEAR AI keeps.

The full list is `NOT_PROVEN` and `LINE_NOT_PROVEN`, the same lists `/verify` shows.

## License

MIT
