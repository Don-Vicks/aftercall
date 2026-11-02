import { verifyProof, type Check, type Notes, type ProofBundleV2 } from "@aftercall/core";
import fixture from "./sampleProof.json";

/**
 * The proof the sample meeting's Verify sheet re-checks. The sample meeting is made up, so
 * it has no proof of its own. This one was made by the real notes pipeline run against the
 * core test kit's stand-in for NEAR AI (apps/desktop/scripts/make-sample-proof.ts): test
 * TEE keys, test Intel quotes and a stand-in for NVIDIA. Nothing in it came from NEAR AI,
 * and the sheet says so. What it does show: the app's real verification code passing on a
 * real signature and real hashes, offline, on this Mac.
 */
export const sampleProof = {
  source: fixture.source as "test-kit",
  madeAt: fixture.madeAt,
  bundle: fixture.bundle as unknown as ProofBundleV2,
  notes: fixture.notes as unknown as Notes,
  yourNotes: fixture.yourNotes,
  yourNotesSalt: fixture.yourNotesSalt,
};

/** "2 Nov 2026": the day the test proof was made. */
export const sampleProofDay = new Date(sampleProof.madeAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** What the sheet says above the checks, so nobody reads more into them. */
export const SAMPLE_PROOF_NOTE = `This meeting is made up, so it has no proof. These are Aftercall's real verification checks, re-run on this Mac just now against a test proof made on ${sampleProofDay} by the app's test kit: test keys stand in for NEAR AI's secure hardware, Intel and NVIDIA. A pass shows the checks work, not that NEAR AI signed anything. Record a meeting to check a real one.`;

/** A re-run check, or one the sample can't run, with why. */
export type SampleCheck = Check & { skipped?: boolean };

/**
 * What a pass means for this test proof, in place of the check's own words where those
 * would read as a claim about NEAR AI or about the sample meeting. A failure keeps the
 * check's own words.
 */
const PASSED: Partial<Record<Check["id"], (c: Check) => string>> = {
  signed: (c) => `${c.detail.replace(/ over the exact request and response$/, "")} over the exact request and response, checked now. It's a test key`,
  attested: () => "The signing key and the proof's nonce are in the report data recorded with it. That's a test quote, not one Intel signed",
  compose: (c) => `${c.detail.replace(/attested compose/, "compose file recorded with it")}, the test kit's`,
  e2ee: () => "The key the transcript was encrypted to is bound in the recorded report data. It's a test key",
  confidential: () => "The proof names Qwen/Qwen3.8-27B as a NEAR AI Confidential TEE model. This check reads that name; this test proof wasn't made by that model",
  unchanged: () => "The notes saved with the test proof hash to the ones that were signed. They're the test proof's notes, not this meeting's",
  "your-notes": () => "The typed notes saved with the test proof match its salted hash. They're the test proof's, not this meeting's",
};

/**
 * Runs the real checks (`verifyProof` from @aftercall/core) on the test proof, offline, then
 * lists what can't be checked from it, as skipped and why. Nothing is read from NEAR.
 */
export function runSampleChecks(): SampleCheck[] {
  const p = sampleProof;
  const ran = verifyProof(p.bundle, null, p.notes, { text: p.yourNotes, salt: p.yourNotesSalt })
    // Not on NEAR: listed below as not checked, never as failed or passed.
    .filter((c) => c.id !== "on-chain" && c.id !== "matches")
    .map((c) => (c.ok && PASSED[c.id] ? { ...c, detail: PASSED[c.id]!(c) } : c));
  const skipped: SampleCheck[] = [
    {
      id: "on-chain",
      label: "Proof recorded on NEAR",
      ok: false,
      skipped: true,
      detail: "Not checked: a test proof never goes on NEAR",
    },
    {
      id: "gpu",
      label: "NVIDIA attested the GPUs",
      ok: false,
      skipped: true,
      detail: "Not checked: the token in this proof is from the test kit's stand-in, so NVIDIA's keys wouldn't verify it",
    },
  ];
  return [...ran, ...skipped];
}
