/** The parts of Express's request this reads. */
export type IpRequest = { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } };

/** The caller's address, for per-IP limits: the first hop Vercel's proxy saw, else the socket's. */
export function clientIp(req: IpRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first || req.socket.remoteAddress || "unknown";
}
