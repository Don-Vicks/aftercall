import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIp } from "./clientIp";

const req = (headers: Record<string, string | string[]>, remoteAddress?: string) => ({ headers, socket: { remoteAddress } });

test("the caller's IP: Vercel's own headers first, then the first forwarded address, then the socket", () => {
  const spoofed = { "x-forwarded-for": "6.6.6.6, 7.7.7.7" };
  assert.equal(clientIp(req({ ...spoofed, "x-real-ip": "8.8.8.8", "x-vercel-forwarded-for": "9.9.9.9" }, "10.0.0.1")), "9.9.9.9");
  assert.equal(clientIp(req({ ...spoofed, "x-real-ip": "8.8.8.8" }, "10.0.0.1")), "8.8.8.8");
  assert.equal(clientIp(req({ ...spoofed, "x-vercel-forwarded-for": "", "x-real-ip": " " }, "10.0.0.1")), "6.6.6.6", "an empty header counts as none");
  assert.equal(clientIp(req({ "x-forwarded-for": ["5.5.5.5", "6.6.6.6"] }, "10.0.0.1")), "5.5.5.5");
  assert.equal(clientIp(req({}, "10.0.0.1")), "10.0.0.1", "no proxy: the socket's address");
  assert.equal(clientIp(req({})), "unknown");
});
