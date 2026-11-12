/**
 * Keeps the NVIDIA NRAS keys behind published proofs, so /verify can still re-check their
 * GPU tokens after NVIDIA stops listing a key (about two days after making it). Reads the
 * /verify links in the given files (default: every docs/proof-* file), looks up each GPU
 * token's key in NVIDIA's JWKS, checks its certificate chain and the token as /verify
 * will, and adds it to src/tee/nvidia-archive.json. Keys already archived stay; nothing
 * is removed. Run it within two days of publishing a proof.
 *
 *   pnpm --filter @aftercall/core nvidia:archive
 *   pnpm --filter @aftercall/core nvidia:archive -- --jwks saved-jwks.json docs/proof-run.md
 *   pnpm --filter @aftercall/core nvidia:archive -- --kid nv-eat-kid-prod-…   (a key with no published proof yet)
 *
 * --jwks reads a saved copy of NVIDIA's JWKS instead of fetching it. Exits 1 when a key
 * fails its checks (it isn't added).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { hasFullChecks } from "../src/notes/bundle.ts";
import { decodeVerifyLink } from "../src/notes/disclosure.ts";
import { NVIDIA_JWKS_URL } from "../src/notes/proofLink.ts";
import { decodeJwt, jwtKid, verifyNrasJwt, type Jwk, type Jwks } from "../src/tee/nvidia.ts";
import { parseCertificate, verifyKeyChain } from "../src/tee/nvidiaChain.ts";

const ARCHIVE = new URL("../src/tee/nvidia-archive.json", import.meta.url);
const DOCS = new URL("../../../docs/", import.meta.url);

interface Wanted {
  kid: string;
  /** The proof's token, when the key came from one: the chain is checked at its issue time and the token with the key. */
  token?: string;
  from: string;
}

function parseArgs(argv: string[]): { jwks?: string; kids: string[]; files: string[] } {
  const out: { jwks?: string; kids: string[]; files: string[] } = { kids: [], files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    if (a === "--jwks") out.jwks = argv[++i];
    else if (a === "--kid") out.kids.push(argv[++i]);
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else out.files.push(a);
  }
  return out;
}

/** The GPU tokens in every /verify link in `text`, with their key ids. */
function tokensIn(text: string, from: string): Wanted[] {
  const found: Wanted[] = [];
  for (const m of text.matchAll(/\/verify#([A-Za-z0-9_=-]{40,})/g)) {
    let bundle;
    try {
      bundle = decodeVerifyLink(`#${m[1]}`).proof.bundle;
    } catch {
      console.warn(`skipped   a link in ${from} that isn't a proof link`);
      continue;
    }
    if (!hasFullChecks(bundle)) continue;
    for (const e of bundle.evidence) {
      const kid = e.nvidiaToken ? jwtKid(e.nvidiaToken) : undefined;
      if (kid) found.push({ kid, token: e.nvidiaToken, from });
    }
  }
  return found;
}

const base64Bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Why `key` can't be archived for `w`, or null when it can. */
async function refusal(key: Jwk, w: Wanted): Promise<string | null> {
  let at: number;
  if (w.token) at = Number(decodeJwt(w.token)?.iat);
  else {
    try {
      at = parseCertificate(base64Bytes(key.x5c?.[0] ?? "")).notBefore;
    } catch {
      return "its certificate can't be read";
    }
  }
  const chain = await verifyKeyChain(key, at);
  if (!chain.ok) return chain.error;
  if (w.token) {
    const v = await verifyNrasJwt(w.token, { keys: [key] });
    if (!v.ok) return `the token in ${w.from} doesn't verify with it: ${v.error}`;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // Paths are relative to where the command was typed (pnpm runs the script from packages/core).
  const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p);
  if (args.jwks) args.jwks = here(args.jwks);
  const files = args.files.length
    ? args.files.map(here)
    : readdirSync(DOCS)
        .filter((f) => f.startsWith("proof-"))
        .sort()
        .map((f) => new URL(f, DOCS).pathname);
  const wanted = [...files.flatMap((f) => tokensIn(readFileSync(f, "utf8"), f.replace(/^.*\/docs\//, "docs/"))), ...args.kids.map((kid) => ({ kid, from: "--kid" }))];

  const live = (args.jwks ? JSON.parse(readFileSync(args.jwks, "utf8")) : await (await fetch(NVIDIA_JWKS_URL)).json()) as Jwks;
  if (!Array.isArray(live?.keys)) throw new Error("NVIDIA's JWKS has no keys list");
  const archive = JSON.parse(readFileSync(ARCHIVE, "utf8")) as { keys: Jwk[] } & Record<string, unknown>;
  const archived = new Set(archive.keys.map((k) => k.kid));

  let failed = 0;
  for (const w of wanted) {
    if (archived.has(w.kid)) {
      console.log(`archived  ${w.kid} (${w.from})`);
      continue;
    }
    const key = live.keys.find((k) => k.kid === w.kid);
    if (!key) {
      console.log(`retired   ${w.kid} (${w.from}): NVIDIA no longer lists it, so /verify can't re-check that token`);
      continue;
    }
    const why = await refusal(key, w);
    if (why) {
      failed++;
      console.error(`refused   ${w.kid} (${w.from}): ${why}`);
      continue;
    }
    // Only the fields NVIDIA serves for a key.
    const { kty, crv, kid, x, y, x5c } = key;
    archive.keys.push({ kty, crv, kid, x, y, x5c });
    archived.add(w.kid);
    console.log(`added     ${w.kid} (${w.from})`);
  }
  archive.keys.sort((a, b) => ((a.kid ?? "") < (b.kid ?? "") ? -1 : 1));
  writeFileSync(ARCHIVE, `${JSON.stringify(archive, null, 2)}\n`);
  console.log(`${archive.keys.length} key${archive.keys.length === 1 ? "" : "s"} in src/tee/nvidia-archive.json`);
  if (failed) process.exitCode = 1;
}

await main();
