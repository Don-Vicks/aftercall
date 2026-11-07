/** The parts of Express's request this reads. */
export type IpRequest = { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } };

/**
 * The caller's address, for per-IP limits. On Vercel, the platform's own headers: it sets
 * `x-vercel-forwarded-for` and `x-real-ip` from the connection and overwrites any
 * `x-forwarded-for` a caller sends (vercel.com/docs/headers/request-headers). Behind another
 * proxy, the first `x-forwarded-for` address; with no proxy, the socket's.
 */
export function clientIp(req: IpRequest): string {
  for (const name of ["x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"]) {
    const value = req.headers[name];
    const first = (Array.isArray(value) ? value[0] : value)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress || "unknown";
}
