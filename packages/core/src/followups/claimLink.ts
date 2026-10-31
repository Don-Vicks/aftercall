/**
 * Claim links carry their own details. The backend keeps only what the link needs
 * to work once (token hash, owner, amount, expiry, status); the payee's name, the
 * memo and the meeting title ride in the URL fragment (after "#"), which browsers
 * never send to any server. The claim page reads them in the payee's browser.
 *
 *   https://aftercall.app/claim#t=<token>&to=Kemi&for=Deck+deposit&in=Sync+with+Ada
 */

export interface ClaimDetails {
  /** Who the link is for, as the payer named them. */
  payeeName?: string;
  /** What the payment is for. */
  memo?: string;
  /** The meeting where it was agreed. */
  meeting?: string;
}

const LIMITS = { payeeName: 80, memo: 200, meeting: 120 } as const;
const KEYS = { payeeName: "to", memo: "for", meeting: "in" } as const;

const clip = (s: string | undefined, n: number) => {
  const t = s?.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, n) : undefined;
};

export function claimLink(claimPageUrl: string, token: string, details: ClaimDetails = {}): string {
  const q = new URLSearchParams({ t: token });
  for (const k of Object.keys(KEYS) as (keyof ClaimDetails)[]) {
    const v = clip(details[k], LIMITS[k]);
    if (v) q.set(KEYS[k], v);
  }
  return `${claimPageUrl}#${q.toString()}`;
}

/** Reads `location.hash` (with or without "#"). Links made before details moved here are a bare token. */
export function parseClaimFragment(hash: string): { token: string } & ClaimDetails {
  const h = hash.replace(/^#/, "");
  if (!h.includes("=")) return { token: h };
  const q = new URLSearchParams(h);
  const out: { token: string } & ClaimDetails = { token: q.get("t") ?? "" };
  for (const k of Object.keys(KEYS) as (keyof ClaimDetails)[]) {
    const v = clip(q.get(KEYS[k]) ?? undefined, LIMITS[k]);
    if (v) out[k] = v;
  }
  return out;
}
