import { utf8ToBytes } from "@noble/hashes/utils";
import { hasFullChecks, type ProofBundle, type ProofBundleV2, type ProofBundleV3 } from "./bundle.ts";
import type { SignatureResponse } from "../tee/checks.ts";
import type { NoticeLog } from "../meeting.ts";
import { isNetwork, type Network } from "../network.ts";
import { recoverPersonalSign, sha256Hex, yourNotesHash } from "./verify.ts";
import { bindsIdentity, expectedMrConfig, signatureKind, signedParts, signerOf, strip0x, type TeeCheck } from "../tee/checks.ts";
import type { TeeEvidence } from "../tee/attest.ts";
import { verifyNrasJwt, type Jwks } from "../tee/nvidia.ts";

/**
 * The proof on NEAR is the sha256 of the proof bundle in canonical JSON (keys
 * sorted, no spaces). The bundle holds hashes, nonces, the model and its
 * signature, never meeting content, so it can be shared in a public link.
 */

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function proofHash(bundle: ProofBundle): string {
  return sha256Hex(utf8ToBytes(canonicalJson(bundle)));
}

/** What `get_proof` on the agent-wallet contract returns. */
export interface OnChainProof {
  proof_hash: string;
  model: string;
  /** Block timestamp in nanoseconds, as a decimal string (the contract's U64: it is above 2^53). */
  recorded_at: string;
}

/** When a proof was recorded on NEAR, in milliseconds since 1970. */
export function recordedAtMs(onChain: OnChainProof): number {
  return Number(BigInt(onChain.recorded_at) / 1_000_000n);
}

/**
 * The summary models Aftercall uses (NEAR AI Confidential TEE tier). "Private model" also
 * needs, in proofs with full checks, a verified attestation of the model in the proof:
 * an anonymised model has no TEE to attest.
 */
export const CONFIDENTIAL_MODELS = ["Qwen/Qwen3.8-27B"];

/** The recorded report data binds the TEE's key and nonce (with its TLS key, when it sent one). */
const bound = (e: TeeEvidence) => bindsIdentity(e.reportData, e.signingAddress, e.nonce, e.tlsCertFingerprint, e.scope);

export interface Check {
  id: "on-chain" | "matches" | "signed" | "attested" | "e2ee" | "compose" | "gpu" | "confidential" | "unchanged" | "your-notes" | "line";
  label: string;
  ok: boolean;
  detail: string;
}

/** Your notes as the app shows them, with the salt from notes.json. */
export interface ShownYourNotes {
  /** Empty when the meeting shows none. */
  text: string;
  salt?: string;
}

/**
 * The checks behind "Verified" that anyone can re-run from the bundle and NEAR:
 * the public Verify page runs them in the browser, the app runs them when the
 * Verify sheet opens. The app also passes the notes it shows, to prove they are
 * the ones that were signed, and your notes with their salt, to prove they are the
 * ones the model was given. Without the salt (the public page) your notes aren't checked.
 *
 * For a v2 bundle this re-checks the signature and that the signer is bound in
 * the report data recorded from a verified quote. It can't re-verify the quotes
 * (they aren't in the bundle, and Intel's collateral service doesn't allow
 * browser requests); the app's own checks are in `bundle.checks`.
 */
export function verifyProof(bundle: ProofBundle, onChain: OnChainProof | null, shownNotes?: unknown, yourNotes?: ShownYourNotes): Check[] {
  const hash = proofHash(bundle);
  const checks: Check[] = [
    {
      id: "on-chain",
      label: "Proof recorded on NEAR",
      ok: onChain !== null,
      detail: onChain
        ? `Recorded ${new Date(recordedAtMs(onChain)).toISOString().replace("T", " ").slice(0, 16)} UTC`
        : "No proof for this meeting on the agent-wallet contract",
    },
    {
      id: "matches",
      label: "Proof matches this meeting",
      ok: onChain !== null && onChain.proof_hash === hash,
      detail: onChain ? (onChain.proof_hash === hash ? `sha256 ${hash.slice(0, 16)}…` : "The hash on NEAR is different") : "Nothing on NEAR to compare",
    },
    ...(bundle.version === 3 ? signatureChecksV3(bundle) : bundle.version === 2 ? signatureChecksV2(bundle) : signatureChecksV1(bundle)),
    confidentialCheck(bundle),
  ];

  if (shownNotes !== undefined) {
    const same = sha256Hex(utf8ToBytes(JSON.stringify(shownNotes))) === bundle.notesHash;
    checks.push({
      id: "unchanged",
      label: "Notes unchanged since signing",
      ok: same,
      detail: same ? "The notes shown are the ones the model returned" : "The notes were changed after signing",
    });
  }
  const yours = yourNotes ? yourNotesCheck(bundle, yourNotes) : null;
  if (yours) checks.push(yours);
  return checks;
}

/** "Private model": a model Aftercall uses, and (in full proofs) a verified TEE attestation of it and of Whisper. */
function confidentialCheck(bundle: ProofBundle): Check {
  const listed = CONFIDENTIAL_MODELS.includes(bundle.summaryModel);
  const attested = (model: string) => !hasFullChecks(bundle) || bundle.evidence.some((e) => e.scope === "model" && e.model === model && e.verified);
  const ok = listed && attested(bundle.summaryModel) && attested(bundle.whisperModel);
  return {
    id: "confidential",
    label: "Private model",
    ok,
    detail: ok
      ? `${bundle.summaryModel} on NEAR AI Confidential TEE · transcription by ${bundle.whisperModel}`
      : !listed
        ? `${bundle.summaryModel} isn't a model Aftercall sends meetings to`
        : `The proof has no verified TEE attestation of ${attested(bundle.summaryModel) ? bundle.whisperModel : bundle.summaryModel}`,
  };
}

/**
 * "Your notes unchanged since signing": the notes shown hash, with the saved salt, to
 * the bundle's `yourNotesHash`. No check when neither the proof nor the meeting has any.
 */
function yourNotesCheck(bundle: ProofBundle, shown: ShownYourNotes): Check | null {
  const recorded = hasFullChecks(bundle) ? bundle.yourNotesHash : undefined;
  const label = "Your notes unchanged since signing";
  if (!recorded) {
    return shown.text ? { id: "your-notes", label, ok: false, detail: "Your notes aren't in the signed proof; they were added afterwards" } : null;
  }
  if (!shown.salt) return { id: "your-notes", label, ok: false, detail: "The salt for your notes is missing from this Mac's copy" };
  const same = yourNotesHash(shown.salt, shown.text) === recorded;
  return {
    id: "your-notes",
    label,
    ok: same,
    detail: same ? "What you typed is what the model was given, by a salted hash" : shown.text ? "Your notes were changed after signing" : "Your notes were removed after signing",
  };
}

function signatureChecksV1(bundle: Exclude<ProofBundle, ProofBundleV2 | ProofBundleV3>): Check[] {
  const sig = bundle.signature;
  const signer = sig.text && sig.signature ? recoverPersonalSign(sig.text, sig.signature) : null;
  const signedParts = sig.text?.split(":") ?? [];
  const coversExchange = signedParts.includes(bundle.requestHash) && signedParts.includes(bundle.responseHash);
  return [
    {
      id: "signed",
      label: "Summary signed inside secure hardware",
      ok: !!signer && coversExchange && signer === sig.signing_address?.toLowerCase(),
      detail: !signer
        ? "No valid signature"
        : coversExchange
          ? `Signed by ${signer.slice(0, 10)}… over the exact request and response`
          : "The signature doesn't cover this request and response",
    },
    {
      id: "attested",
      label: "Signer was attested",
      ok: !!signer && bundle.attestedSigners.includes(signer),
      detail: signer && bundle.attestedSigners.includes(signer)
        ? "The signing key belonged to an attested enclave, checked with a fresh nonce"
        : "The signer isn't in the attestation recorded at processing time",
    },
  ];
}

/** One signed request of a v2 or v3 proof: who signed, whether it covers the recorded hashes, and the TEE that binds the signer. */
function signedCall(bundle: ProofBundleV2 | ProofBundleV3, sig: SignatureResponse, requestHash: string, responseHash: string) {
  const signer = signerOf(sig, bundle.signingAlgo);
  const parts = signedParts(sig.text ?? "");
  const kind = signatureKind(sig);
  const coversExchange = parts.request === requestHash && parts.response === responseHash && (parts.model === null || parts.model === bundle.summaryModel);
  // The signer must be a TEE of the right kind whose recorded report data binds its key and our nonce.
  const scope = kind === "gateway" ? "gateway" : kind === "provider_tee" ? "model" : null;
  const tee = bundle.evidence.find(
    (e) =>
      !!signer &&
      (scope === null || e.scope === scope) &&
      (e.scope === "gateway" || e.model === bundle.summaryModel) &&
      e.signingAddress === strip0x(signer) &&
      e.nonce === bundle.attestationNonce.summary &&
      bound(e),
  );
  return { signer, coversExchange, tee };
}

const algoName = (b: ProofBundleV2 | ProofBundleV3) => (b.signingAlgo === "ed25519" ? "Ed25519" : "ECDSA");

/** "Signer's setup file matches its hardware", for one TEE that signed. Not that the images in it are NEAR's releases. */
function composeCheck(tee: ProofBundleV2["evidence"][number]): Check {
  return {
    id: "compose",
    label: "Signer's setup file matches its hardware",
    ok: tee.composeHash.length === 64 && tee.mrConfigId === expectedMrConfig(tee.composeHash),
    detail: `Recorded mr_config is 01 + sha256 of the attested Docker compose (${tee.composeHash.slice(0, 12)}…); its images aren't checked against a list of NEAR's releases`,
  };
}

/** "Transcript encrypted to the attested model": the key recorded is bound in the summary TEE's recorded report data. */
function e2eeCheck(bundle: ProofBundleV2 | ProofBundleV3): Check {
  const e2eeTee = bundle.e2ee.used ? bundle.evidence.find((e) => e.scope === "model" && e.model === bundle.summaryModel && e.signingAddress === strip0x(bundle.e2ee.modelKey ?? "")) : undefined;
  return {
    id: "e2ee",
    label: "Transcript encrypted to the attested model",
    ok: !!e2eeTee && bound(e2eeTee),
    detail: bundle.e2ee.used
      ? e2eeTee
        ? "The key the app encrypted to is bound in the summary TEE's recorded report data"
        : "The key the app encrypted to isn't one the app recorded"
      : `Not end to end: ${bundle.e2ee.reason ?? "unavailable"}`,
  };
}

function signatureChecksV2(bundle: ProofBundleV2): Check[] {
  const { signer, coversExchange, tee } = signedCall(bundle, bundle.signature, bundle.requestHash, bundle.responseHash);
  const algo = algoName(bundle);
  const checks: Check[] = [
    {
      id: "signed",
      label: "Summary signed inside secure hardware",
      ok: !!signer && coversExchange,
      detail: !signer ? `${algo} signature didn't verify` : coversExchange ? `${algo} signature by ${signer.slice(0, 10)}… over the exact request and response` : "The signature doesn't cover this request and response",
    },
    {
      id: "attested",
      label: "Signer was attested",
      ok: !!tee && tee.verified,
      detail: tee
        ? `The key is in the report data of the ${tee.scope === "gateway" ? "gateway" : "model"} TEE's quote, next to this meeting's nonce${tee.verified ? "" : "; the app recorded a failed check for that TEE"}`
        : "The signer isn't bound in any quote the app recorded",
    },
  ];
  if (tee) checks.push(composeCheck(tee));
  checks.push(e2eeCheck(bundle));
  return checks;
}

/**
 * A long call's proof: the same checks as version 2, each over every request. One
 * failing request fails the line, and the line says which.
 */
function signatureChecksV3(bundle: ProofBundleV3): Check[] {
  const calls = Array.isArray(bundle.calls) ? bundle.calls : [];
  const name = (c: ProofBundleV3["calls"][number]) => (c.role === "overall" ? "the overall summary" : `part ${c.part ?? "?"}`);
  const results = calls.map((c) => ({ c, ...signedCall(bundle, c.signature, c.requestHash, c.responseHash) }));
  const algo = algoName(bundle);
  const n = calls.length;
  const unsigned = results.find((r) => !r.signer);
  const uncovered = results.find((r) => r.signer && !r.coversExchange);
  const unbound = results.find((r) => !r.tee);
  const failedTee = results.find((r) => r.tee && !r.tee.verified);
  const signers = [...new Set(results.map((r) => r.signer).filter((s): s is string => !!s))];
  const checks: Check[] = [
    {
      id: "signed",
      label: "Summary signed inside secure hardware",
      ok: n > 0 && !unsigned && !uncovered,
      detail:
        n === 0
          ? "The proof lists no signed requests"
          : unsigned
            ? `The ${algo} signature for ${name(unsigned.c)} didn't verify`
            : uncovered
              ? `The signature for ${name(uncovered.c)} doesn't cover its request and response`
              : `${algo} signatures by ${signers.map((s) => `${s.slice(0, 10)}…`).join(", ")} over the exact request and response of all ${n} requests`,
    },
    {
      id: "attested",
      label: "Signer was attested",
      ok: n > 0 && !unbound && !failedTee,
      detail: unbound
        ? `The signer of ${name(unbound.c)} isn't bound in any quote the app recorded`
        : failedTee
          ? `The signer of ${name(failedTee.c)} is in a quote the app recorded a failed check for`
          : `Every signing key is in the report data of a TEE quote, next to this meeting's nonce`,
    },
  ];
  const tees = [...new Map(results.filter((r) => r.tee).map((r) => [r.tee!.signingAddress, r.tee!])).values()];
  if (tees.length) {
    const bad = tees.find((t) => !composeCheck(t).ok);
    checks.push(bad ? composeCheck(bad) : composeCheck(tees[0]));
  }
  checks.push(e2eeCheck(bundle));
  return checks;
}

/**
 * Re-checks NVIDIA's platform token kept in a v2 proof against NVIDIA's keys
 * (fetched by the caller; NVIDIA serves them to browsers). Not expiry: the token
 * expired an hour after the meeting, but it is still NVIDIA's signed statement.
 */
export async function verifyProofGpu(bundle: ProofBundle, jwks: Jwks | null): Promise<Check | null> {
  if (!hasFullChecks(bundle)) return null;
  const tee = bundle.evidence.find((e) => e.nvidiaToken);
  if (!tee?.nvidiaToken) return null;
  const label = "NVIDIA attested the signer's GPUs";
  if (!jwks) return { id: "gpu", label, ok: false, detail: "Couldn't get NVIDIA's signing keys" };
  const v = await verifyNrasJwt(tee.nvidiaToken, jwks);
  if (!v.ok) return { id: "gpu", label, ok: false, detail: `NVIDIA's token didn't verify: ${v.error}` };
  const fresh = strip0x(String(v.claims.eat_nonce ?? "")) === tee.nonce;
  const passed = v.claims["x-nvidia-overall-att-result"] === true;
  const at = typeof v.claims.iat === "number" ? new Date(v.claims.iat * 1000).toISOString().replace("T", " ").slice(0, 16) : "?";
  return {
    id: "gpu",
    label,
    ok: fresh && passed,
    detail: `Token signed by NVIDIA at ${at} UTC; ${passed ? "overall result pass" : "overall result fail"}; ${fresh ? "carries this meeting's nonce" : "nonce doesn't match"}`,
  };
}

/** The app's own checks from a v2 or v3 proof, as recorded when the meeting was processed. */
export function recordedChecks(bundle: ProofBundle): TeeCheck[] | null {
  return hasFullChecks(bundle) ? bundle.checks : null;
}

export interface CheckGroup {
  key: "gateway" | "whisper" | "summary" | "response";
  title: string;
  checks: TeeCheck[];
}

/** The app's checks grouped as the Verified panel shows them: Gateway, Whisper TEE, summary TEE, Response. */
export function groupChecks(checks: TeeCheck[], models: { whisperModel: string; summaryModel: string }): CheckGroup[] {
  const summaryTitle = models.summaryModel.startsWith("Qwen/") ? "Qwen TEE" : `${models.summaryModel.split("/").pop()} TEE`;
  const groups: CheckGroup[] = [
    { key: "gateway", title: "Gateway", checks: checks.filter((c) => c.scope === "gateway") },
    { key: "whisper", title: "Whisper TEE", checks: checks.filter((c) => c.scope === "model" && c.model === models.whisperModel) },
    { key: "summary", title: summaryTitle, checks: checks.filter((c) => c.scope === "model" && c.model !== models.whisperModel) },
    { key: "response", title: "Response", checks: checks.filter((c) => c.scope === "response") },
  ];
  return groups.filter((g) => g.checks.length > 0);
}

/** Shown with the Whisper checks: what attestation can and can't say about transcription. */
export const WHISPER_NOTE =
  "Transcription runs in an attested TEE but isn't signed per response. The audio isn't end-to-end encrypted: it travels over TLS, uploaded only on a connection whose certificate key is the one bound in the gateway's attestation.";

/** What the proof does not show; shown under the checks so nobody reads more into them. */
export const NOT_PROVEN = [
  "That the transcript is accurate: Whisper can mishear names and numbers.",
  "That this transcription came from the attested Whisper TEE: NEAR AI signs chat responses, not transcriptions.",
  "That everyone on the call agreed to be recorded: Aftercall asks you to confirm it, and can't check it.",
  "Who said what: “You” is your microphone and the rest is the call's audio; a name on the call's side comes from your calendar or, marked “likely”, from the model reading what was said (an introduction, someone addressed by name), never from the voice, and isn't checked like quotes.",
  "When your notes were typed: the proof shows they haven't changed since the notes were made, not that you typed them during the call.",
  "What NEAR AI keeps or trains on: that is set by NEAR AI's own policy, not shown by these checks.",
  "That every older meeting's transcript was end-to-end encrypted: earlier versions of the app could send it over TLS when encryption wasn't available, and such a meeting's proof says so.",
];

/**
 * What the app dropped from the model's notes, for the Verify sheet and /verify. A
 * statement the app recorded and the hash on NEAR covers, not a check anyone can
 * re-run (the transcript isn't public). Null for bundles made before it was recorded.
 */
export function droppedLine(bundle: ProofBundle): string | null {
  if (!hasFullChecks(bundle) || !bundle.dropped) return null;
  const { decisions, actionItems, followUps } = bundle.dropped;
  const total = decisions + actionItems + followUps;
  if (total === 0) return "Every item the model proposed had an exact quote in the transcript.";
  const parts = [
    [decisions, "decision", "decisions"],
    [actionItems, "action item", "action items"],
    [followUps, "follow-up", "follow-ups"],
  ] as const;
  const which = parts.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  return total === 1
    ? `The app dropped 1 item the model proposed (${which[0]}) because its quote wasn't in the transcript.`
    : `The app dropped ${total} items the model proposed (${which.join(", ")}) because their quotes weren't in the transcript.`;
}

const HOW: Record<NonNullable<NoticeLog["how"]>, string> = {
  aloud: "aloud",
  chat: "in chat",
  invite: "in the invite",
  email: "by email",
};

/**
 * The notice the person who recorded logged, as the Verify sheet and /verify show it:
 * "Stated by the person who recorded at 14:02: they told everyone in chat. Aftercall
 * can't check this." The time is when they ticked the box, not when they told people
 * (an invite went out earlier). 24-hour, in `timeZone` (the viewer's own by default).
 */
export function noticeLine(notice: NoticeLog | undefined, opts: { timeZone?: string } = {}): string {
  if (!notice) return "No notice logged";
  const at = new Date(notice.at);
  const time = Number.isNaN(at.getTime())
    ? ""
    : ` at ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: opts.timeZone }).format(at)}`;
  const how = notice.how ? ` ${HOW[notice.how]}` : "";
  return `Stated by the person who recorded${time}: they told everyone${how}. Aftercall can't check this.`;
}

/**
 * Whether the proof carries the app's statements (the dropped count, and the notice
 * when one was logged). Proofs made before Aftercall recorded them have neither, so
 * their missing notice means "not kept then", not "nobody was told".
 */
export function hasStatements(bundle: ProofBundle): bundle is ProofBundleV2 | ProofBundleV3 {
  return hasFullChecks(bundle) && (bundle.dropped !== undefined || bundle.notice !== undefined);
}

/** Public link payload: everything the Verify page needs, base64url in the URL fragment. */
export interface PublicProof {
  network: Network;
  contract: string;
  owner: string;
  bundle: ProofBundle;
}

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** A value as a link fragment: canonical JSON, UTF-8, base64url without padding. */
export function encodeLinkPayload(value: unknown): string {
  return toBase64Url(utf8ToBytes(canonicalJson(value)));
}

/** The value `encodeLinkPayload` made. Throws on anything that isn't base64url JSON. */
export function decodeLinkPayload(text: string): unknown {
  return JSON.parse(new TextDecoder().decode(fromBase64Url(text)));
}

export function encodePublicProof(p: PublicProof): string {
  return encodeLinkPayload(p);
}

export function decodePublicProof(fragment: string): PublicProof {
  const p = decodeLinkPayload(fragment.replace(/^#/, "")) as PublicProof;
  if (!isNetwork(p.network)) throw new Error("BAD_NETWORK");
  return p;
}
