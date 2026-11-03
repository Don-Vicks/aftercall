import { NextResponse, type NextRequest } from "next/server";
import { cleanRef, redis } from "../../metrics";

/** What someone is waiting for (the form's boxes, app/download/Waitlist.tsx). */
const WANTS = ["intel", "windows", "mainnet", "updates"] as const;
type Want = (typeof WANTS)[number];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Sign-ups allowed per address per hour. */
const PER_HOUR = 10;

/**
 * Joins the waitlist: stores the name, email, what they're waiting for, the channel and the time.
 * The email is used only to say when that's ready, as the form says.
 */
export async function POST(req: NextRequest) {
  if (!redis) return NextResponse.json({ error: "The waitlist isn't open yet." }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { name?: unknown; email?: unknown; wants?: unknown; company?: unknown } | null;
  // The hidden "company" field is for bots; people never see it.
  if (!body || (typeof body.company === "string" && body.company)) return NextResponse.json({ ok: true });

  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 80) return NextResponse.json({ error: "Add your name (up to 80 characters)." }, { status: 400 });
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL.test(email)) return NextResponse.json({ error: "That email doesn't look right." }, { status: 400 });
  const wants = (Array.isArray(body.wants) ? body.wants : []).filter((w): w is Want => WANTS.includes(w as Want));
  if (wants.length === 0) wants.push("updates");

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = `rl:waitlist:${ip}`;
  const n = await redis.incr(rl);
  if (n === 1) await redis.expire(rl, 3600);
  if (n > PER_HOUR) return NextResponse.json({ error: "Too many tries. Try again in an hour." }, { status: 429 });

  const ref = cleanRef(req.cookies.get("ac_ref")?.value);
  const key = `w:${email}`;
  const prev = await redis.hgetall<{ wants?: string; at?: string; ref?: string }>(key);
  const merged = [...new Set([...(prev?.wants ? prev.wants.split(",") : []), ...wants])];
  // Keep when and where they first joined; add anything new they're waiting for.
  await redis
    .pipeline()
    .hset(key, { name, email, wants: merged.join(","), ref: prev?.ref ?? ref, at: prev?.at ?? new Date().toISOString() })
    .sadd("w:all", email)
    .exec();
  return NextResponse.json({ ok: true, already: Boolean(prev?.at) });
}
