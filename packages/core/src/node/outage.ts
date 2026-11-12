/**
 * Telling "a service was down" from "a check failed". Intel's collateral service,
 * NVIDIA NRAS, NEAR AI and NEAR's RPC can each be down or rate-limited; a check that
 * couldn't run because of that hasn't failed, and `pnpm check:live` says so.
 *
 * The attestation code turns a transport's error into a check's detail text, so the
 * marker travels in the message, as TLS_PIN_MISMATCH does.
 */

export const SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE";

/** An HTTP status that means the service, not the claim: rate-limited (429) or a server error (5xx). */
export const isOutageStatus = (status: number) => status === 429 || status >= 500;

/** An error that marks `service` as unavailable, with what it answered. */
export const serviceUnavailable = (service: string, detail: string) => new Error(`${SERVICE_UNAVAILABLE}: ${service}: ${detail}`);

/** The service and its error from a text that carries the marker, or null. */
export function unavailableIn(text: string): { service: string; error: string } | null {
  const m = new RegExp(`${SERVICE_UNAVAILABLE}: ([^:]+): (.*)$`, "s").exec(text);
  return m ? { service: m[1], error: m[2].trim() } : null;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error: /, "");

/**
 * `fetch`, with network failures, timeouts and 429/5xx answers turned into
 * SERVICE_UNAVAILABLE errors naming `service`. Any other answer comes back as is.
 */
export async function fetchOrUnavailable(doFetch: typeof fetch, service: string, url: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await doFetch(url, init);
  } catch (e) {
    throw serviceUnavailable(service, errorText(e));
  }
  if (isOutageStatus(res.status)) {
    const body = await res.text().catch(() => "");
    throw serviceUnavailable(service, `HTTP ${res.status}${body ? ` ${body.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
  }
  return res;
}
