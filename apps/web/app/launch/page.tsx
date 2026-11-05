import { timingSafeEqual } from "node:crypto";
import { notFound } from "next/navigation";
import { KINDS, readMetrics, redis, type Kind } from "../metrics";

export const dynamic = "force-dynamic";
export const metadata = { title: "Launch · Aftercall", robots: { index: false, follow: false } };

const LABEL: Record<Kind, string> = { visit: "Visits", demo: "Demo opens", download: "DMG downloads", install: "Terminal installs" };

/** Only with ?key= matching LAUNCH_STATS_KEY; anything else is a plain 404. */
function allowed(key: string | undefined): boolean {
  const want = process.env.LAUNCH_STATS_KEY;
  if (!want || !key) return false;
  const a = Buffer.from(key);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

const sum = (o: Record<string, number>) => Object.values(o).reduce((n, v) => n + Number(v), 0);

/**
 * Private launch numbers (proxy.ts and the waitlist): visits, DMG downloads and Terminal
 * installs by channel and day, and the waitlist by channel and what people are waiting for.
 * Not the public /stats page, which counts app usage.
 */
export default async function Launch({ searchParams }: { searchParams: Promise<{ key?: string }> }) {
  if (!allowed((await searchParams).key)) notFound();
  const m = await readMetrics(14);
  if (!m || !redis) return <main style={{ padding: 40 }}>No store connected yet (KV_REST_API_URL / KV_REST_API_TOKEN).</main>;

  const emails = await redis.smembers("w:all");
  const wants: Record<string, number> = {};
  const byRef: Record<string, number> = {};
  for (const email of emails) {
    const row = await redis.hgetall<{ wants?: string; ref?: string }>(`w:${email}`);
    for (const w of (row?.wants ?? "").split(",").filter(Boolean)) wants[w] = (wants[w] ?? 0) + 1;
    const r = row?.ref ?? "direct";
    byRef[r] = (byRef[r] ?? 0) + 1;
  }
  const channels = [...new Set([...KINDS.flatMap((k) => Object.keys(m[k].total)), ...Object.keys(byRef)])].sort();

  const cell: React.CSSProperties = { padding: "6px 12px", borderBottom: "1px solid var(--hairline)", textAlign: "right", fontVariantNumeric: "tabular-nums" };
  const head: React.CSSProperties = { ...cell, color: "var(--muted)", fontWeight: 500 };

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "40px 16px", display: "flex", flexDirection: "column", gap: 32 }}>
      <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 40 }}>Launch numbers</h1>

      <section>
        <h2 style={{ fontSize: 20, marginBottom: 10 }}>By channel, all time</h2>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...head, textAlign: "left" }}>Channel</th>
              {KINDS.map((k) => (
                <th key={k} style={head}>
                  {LABEL[k]}
                </th>
              ))}
              <th style={head}>Waitlist</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((c) => (
              <tr key={c}>
                <td style={{ ...cell, textAlign: "left" }}>{c}</td>
                {KINDS.map((k) => (
                  <td key={k} style={cell}>
                    {Number(m[k].total[c] ?? 0)}
                  </td>
                ))}
                <td style={cell}>{byRef[c] ?? 0}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...cell, textAlign: "left", fontWeight: 600 }}>Total</td>
              {KINDS.map((k) => (
                <td key={k} style={{ ...cell, fontWeight: 600 }}>
                  {sum(m[k].total)}
                </td>
              ))}
              <td style={{ ...cell, fontWeight: 600 }}>{emails.length}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2 style={{ fontSize: 20, marginBottom: 10 }}>Last 14 days</h2>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...head, textAlign: "left" }}>Day</th>
              {KINDS.map((k) => (
                <th key={k} style={head}>
                  {LABEL[k]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.visit.byDay.map((row, i) => (
              <tr key={row.date}>
                <td style={{ ...cell, textAlign: "left" }}>{row.date}</td>
                {KINDS.map((k) => (
                  <td key={k} style={cell}>
                    {sum(m[k].byDay[i].counts)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 style={{ fontSize: 20, marginBottom: 10 }}>Waitlist: {emails.length}</h2>
        <p className="muted">
          {Object.entries(wants)
            .map(([w, n]) => `${w} ${n}`)
            .join(" · ") || "Nobody yet."}
        </p>
      </section>
    </main>
  );
}
