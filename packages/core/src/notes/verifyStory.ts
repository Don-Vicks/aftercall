import type { Check } from "./proof.ts";
import type { VerifyLink } from "./disclosure.ts";

/**
 * What /verify can say in plain words, each statement resting on checks the page has just run.
 * `holds` is true when every one of those checks that ran passed, false when one failed, and
 * null when the link has none of them (an older proof) or none could be re-run.
 */
export interface ProvenClaim {
  text: string;
  rests: Check["id"][];
  holds: boolean | null;
}

/** The statements, in the order a judge reads them: who wrote it, how it got there, who signed it, whether it changed. */
export function provenClaims(link: VerifyLink, checks: readonly Check[]): ProvenClaim[] {
  const { bundle, owner } = link.proof;
  const claim = (text: string, rests: Check["id"][]): ProvenClaim => {
    const ran = checks.filter((c) => rests.includes(c.id) && !c.cantRecheck);
    return { text, rests, holds: ran.length === 0 ? null : ran.every((c) => c.ok) };
  };
  return [
    claim(`The notes were written by ${bundle.summaryModel} running on NEAR AI's confidential hardware, which Intel and NVIDIA attested.`, ["confidential", "attested", "gpu", "compose"]),
    claim("The meeting's text was encrypted to that hardware's own key before it left the Mac, so NEAR AI's servers in between couldn't read it.", ["e2ee"]),
    claim("That hardware signed exactly this request and this reply, with a key its attestation names.", ["signed"]),
    claim(`Not one character of this proof has changed since ${owner} recorded its hash on NEAR.`, ["on-chain", "matches"]),
    claim("The record was read from Aftercall's own contract, not from a look-alike.", ["contract"]),
  ].filter((c) => checks.some((k) => c.rests.includes(k.id)));
}

/** Changes one hex character: the last one, to a different digit. */
function flip(hex: string): string {
  const last = hex.slice(-1);
  return hex.slice(0, -1) + (last === "0" ? "1" : "0");
}

/**
 * The same link with one character changed: the fingerprint of the summary's reply, as if the
 * notes had been edited after the hardware signed them. The page runs its usual checks on it,
 * so a judge sees which ones catch the change. Nothing leaves the browser.
 */
export function tamperedLink(link: VerifyLink): { link: VerifyLink; what: string } {
  const bundle = structuredClone(link.proof.bundle);
  if (bundle.version === 3) {
    const last = bundle.calls[bundle.calls.length - 1];
    last.responseHash = flip(last.responseHash);
  } else {
    bundle.responseHash = flip(bundle.responseHash);
  }
  const proof = { ...link.proof, bundle };
  return {
    link: link.kind === "line" ? { ...link, proof } : { kind: "proof", proof },
    what: "One character of the summary's reply fingerprint changed, as if someone edited the notes after the hardware signed them.",
  };
}
