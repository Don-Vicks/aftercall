/**
 * A demo of a coding agent on Aftercall's MCP server, without the Mac app: starts the
 * test stand-in for the app's agents socket (src/fixture.ts, the same protocol and
 * rules, over two sample meetings), read-only like the app's default, and prints what
 * an agent needs to reach it.
 *
 *   pnpm --filter @aftercall/mcp build      # the server file the app ships
 *   node apps/mcp/scripts/demo.ts [--allow-writes]
 *
 * It writes an MCP config for Claude Code that runs dist/aftercall-mcp.mjs with this
 * socket and token, and prints the `claude` command that uses it. Press Enter to let
 * agents claim and complete action items, as the app's second switch does; Ctrl-C stops.
 * Each request the stand-in answers is printed as it arrives (ids and names only).
 */
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { startFakeApp } from "../src/fixture.ts";

const bundle = fileURLToPath(new URL("../dist/aftercall-mcp.mjs", import.meta.url));
if (!existsSync(bundle)) {
  console.error("No dist/aftercall-mcp.mjs yet. Run `pnpm --filter @aftercall/mcp build` first.");
  process.exit(1);
}

let writes = process.argv.includes("--allow-writes");
const fake = await startFakeApp({
  allowWrites: writes,
  onRequest: (r) => {
    const ids = [r.meetingId, r.itemId].filter(Boolean).join("/");
    console.log(`  ${new Date().toISOString()}  ${r.agent ?? "?"}  ${r.op}${ids ? ` ${ids}` : ""}  ${r.allowed ? "allowed" : `refused: ${r.error}`}`);
  },
});

const config = join(fake.dataDir, "mcp-config.json");
await writeFile(
  config,
  JSON.stringify({ mcpServers: { aftercall: { command: "node", args: [bundle, "--socket", fake.socketPath], env: { AFTERCALL_TOKEN: fake.token } } } }, null, 2),
);

const mode = () => (writes ? "agents may claim and complete action items" : "read-only (press Enter to let agents claim and complete)");
console.log(`Stand-in for the Aftercall app, ${mode()}
socket: ${fake.socketPath}
token:  ${fake.token}
MCP config for Claude Code: ${config}

  claude -p "List my Aftercall meetings, then claim the open action item about the API fix as Claude Code." \\
    --mcp-config ${config} --strict-mcp-config --allowedTools "mcp__aftercall__*" --max-turns 8 --output-format text

Requests:`);

createInterface({ input: process.stdin }).on("line", () => {
  if (writes) return;
  writes = true;
  fake.setAllowWrites(true);
  console.log(`Now ${mode()}.`);
});

const stop = async () => {
  await fake.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
