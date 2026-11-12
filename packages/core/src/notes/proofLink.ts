import { hasFullChecks } from "./bundle.ts";
import { lineCheck, type VerifyLink } from "./disclosure.ts";
import { verifyProof, verifyProofGpu, type Check, type OnChainProof, type PublicProof } from "./proof.ts";
import { NETWORK_CONFIG } from "../network.ts";
import type { Jwks } from "../tee/nvidia.ts";

/**
 * What the public /verify page does with a link, minus the page: read the proof's hash
 * from the agent-wallet contract, fetch NVIDIA's keys, and run the checks. The page and
 * the receipts package both call this, so they check the same way.
 */

/** The part of `fetch` used here, so callers can pass their own. */
export type ProofFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const defaultFetch: ProofFetch = (url, init) => globalThis.fetch(url, init);

/** Where NVIDIA publishes its NRAS keys; it lets browsers read them. */
export const NVIDIA_JWKS_URL = "https://nras.attestation.nvidia.com/.well-known/jwks.json";

/** NVIDIA's NRAS signing keys, or null when they couldn't be fetched. */
export async function fetchNvidiaKeys(fetchFn: ProofFetch = defaultFetch): Promise<Jwks | null> {
  try {
    const res = await fetchFn(NVIDIA_JWKS_URL);
    return res.ok ? ((await res.json()) as Jwks) : null;
  } catch {
    return null;
  }
}

/**
 * The proof `get_proof(owner, meeting_id)` returns from the link's contract, at final
 * finality, over the network's public RPC. Null when there is none; throws when NEAR
 * can't be asked.
 */
export async function readOnChainProof(p: Omit<PublicProof, "bundle"> & { meetingId: string }, fetchFn: ProofFetch = defaultFetch): Promise<OnChainProof | null> {
  const args = btoa(JSON.stringify({ owner: p.owner, meeting_id: p.meetingId }));
  const res = await fetchFn(NETWORK_CONFIG[p.network].rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "verify",
      method: "query",
      params: { request_type: "call_function", finality: "final", account_id: p.contract, method_name: "get_proof", args_base64: args },
    }),
  });
  const body = (await res.json()) as { error?: RpcError; result?: { error?: RpcError | string; result?: number[] } };
  const err = body.error ?? body.result?.error;
  if (err) {
    if (typeof err === "string") throw new Error(err);
    if (err.cause?.name === "UNKNOWN_ACCOUNT") throw new Error(`the contract ${p.contract} doesn't exist on ${p.network}`);
    throw new Error(err.data ?? err.message ?? "unknown error");
  }
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(body.result?.result ?? []))) as OnChainProof | null;
}

interface RpcError {
  cause?: { name?: string };
  data?: string;
  message?: string;
}

export interface LinkChecks {
  /** The line check first (for a line link), the contract check when the link names another contract, then the proof's checks, then NVIDIA's token when the proof has one. */
  checks: Check[];
  onChain: OnChainProof | null;
  /** Why NEAR couldn't be read, when it couldn't; the NEAR checks then fail. */
  rpcError?: string;
}

/**
 * A failing check when the link names a contract other than Aftercall's on its network.
 * Aftercall's contract files a proof under the account that sent it, so "recorded by" is
 * NEAR's word; any other contract answers `get_proof` however its deployer wrote it, so a
 * link could name anyone as the owner. Null (no row) for Aftercall's own contract.
 */
export function contractCheck(p: Pick<PublicProof, "network" | "contract">): Check | null {
  const ours = NETWORK_CONFIG[p.network].agentWallet;
  if (p.contract === ours) return null;
  return {
    id: "contract",
    label: "Proof read from Aftercall's contract",
    ok: false,
    detail: ours
      ? `${p.contract} isn't Aftercall's contract on ${p.network} (${ours}): its deployer decides what it answers, so who recorded this proof isn't checked`
      : `Aftercall has no contract on ${p.network} yet: ${p.contract}'s deployer decides what it answers, so who recorded this proof isn't checked`,
  };
}

/** Every check /verify runs for a link, in the order it lists them. */
export async function runLinkChecks(link: VerifyLink, fetchFn: ProofFetch = defaultFetch): Promise<LinkChecks> {
  const { bundle } = link.proof;
  // Never left to reject unawaited: a token that can't be read fails its check instead.
  const gpu = verifyProofGpu(bundle, await fetchNvidiaKeys(fetchFn)).catch(
    (): Check => ({ id: "gpu", label: "NVIDIA attested the signer's GPUs", ok: false, detail: "NVIDIA's token in the proof can't be read" }),
  );
  const contract = contractCheck(link.proof);
  const line = link.kind === "line" ? [lineCheck(bundle, link.line)] : [];
  const withRest = async (checks: Check[]) => {
    const g = await gpu;
    return [...line, ...(contract ? [contract] : []), ...checks, ...(g ? [g] : [])];
  };
  try {
    const onChain = await readOnChainProof({ ...link.proof, meetingId: bundle.meetingId }, fetchFn);
    return { onChain, checks: await withRest(verifyProof(bundle, onChain)) };
  } catch (e) {
    return { onChain: null, checks: await withRest(verifyProof(bundle, null)), rpcError: String(e).replace(/^Error: /, "") };
  }
}

/**
 * Whether everything passed, as /verify's headline reads it: every check run now, and every
 * check the app recorded in the proof. The recorded end-to-end encryption line has its own
 * check above (`e2ee`), so it isn't counted twice. A check that can't be re-run
 * (`cantRecheck`) is left out, as the Intel quote is: the app's own check of the same thing
 * is among the recorded ones, and must have passed.
 */
export function allChecksPassed(bundle: PublicProof["bundle"], checks: readonly Check[]): boolean {
  const recorded = hasFullChecks(bundle) ? bundle.checks : [];
  const rerun = checks.filter((c) => !c.cantRecheck);
  return rerun.length > 0 && rerun.every((c) => c.ok) && recorded.every((c) => c.ok || c.id === "response-e2ee");
}
