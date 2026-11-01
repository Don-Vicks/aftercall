import { strict as assert } from "node:assert";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WRITES_OFF, startFakeApp } from "./fixture.ts";
import { TOOL_NAMES } from "./server.ts";

const main = fileURLToPath(new URL("./main.ts", import.meta.url));
/** What the app ships (scripts/build.mjs); `pnpm test` builds it first. */
const bundle = fileURLToPath(new URL("../dist/aftercall-mcp.mjs", import.meta.url));

async function connect(args: string[], env: Record<string, string>, entry = main) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry, ...args], env: { PATH: process.env.PATH ?? "", ...env }, stderr: "pipe" });
  const client = new Client({ name: "aftercall-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

const text = (r: Record<string, unknown>) => (r.content as { type: string; text: string }[])[0].text;

/** Starts the real server as a child process and talks MCP to it over stdio, as Claude Code and Codex do. */
test("the server starts over stdio, lists its tools and answers a call through the app's socket", async () => {
  const seen: { op: string; agent?: string }[] = [];
  const fake = await startFakeApp({ onRequest: (s) => seen.push(s) });
  const client = await connect(["--socket", fake.socketPath], { AFTERCALL_TOKEN: fake.token });
  try {
    assert.match(client.getInstructions() ?? "", /can't send emails, make payments, record proofs/);
    assert.match(client.getInstructions() ?? "", /off by default/);

    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOL_NAMES].sort());
    for (const t of tools) assert.match(t.description ?? "", /can't send emails, make payments, record proofs on NEAR/);
    assert.equal(tools.find((t) => t.name === "get_meeting")?.annotations?.readOnlyHint, true);

    // Read-only until the user allows writes: the agent gets the app's reason.
    const refused = await client.callTool({ name: "claim_action_item", arguments: { meetingId: "1761000000", itemId: "a1", agent: "Codex" } });
    assert.equal(refused.isError, true);
    assert.equal(text(refused), WRITES_OFF);
    // reads carry the client's own name for the app's activity list
    await client.callTool({ name: "list_meetings", arguments: {} });
    assert.equal(seen.find((s) => s.op === "meetings")?.agent, "aftercall-test");

    fake.setAllowWrites(true);
    const claim = await client.callTool({ name: "claim_action_item", arguments: { meetingId: "1761000000", itemId: "a1", agent: "Codex" } });
    assert.equal(claim.isError, undefined);
    const list = await client.callTool({ name: "list_action_items", arguments: { includeClaimed: true, owner: "You", project: "Fundraise" } });
    assert.equal(JSON.parse(text(list)).items[0].claimed.agent, "Codex");

    const bad = await client.callTool({ name: "get_meeting", arguments: { id: "nope" } });
    assert.equal(bad.isError, true);
  } catch (e) {
    await fake.close();
    throw e;
  } finally {
    await client.close();
  }

  // The same server with the app closed: still starts, and each tool says what to do.
  const dataDir = fake.dataDir;
  await fake.close();
  const offline = await connect(["--data-dir", dataDir], { AFTERCALL_TOKEN: "x" });
  try {
    const r = await offline.callTool({ name: "list_meetings", arguments: {} });
    assert.equal(r.isError, true);
    assert.match(text(r), /Open Aftercall and turn on Connected agents/);
  } finally {
    await offline.close();
  }
});

/** The single file the app ships: copied away from node_modules, it still answers initialize and tools/list. */
test("the bundled server runs on its own with plain node", async () => {
  const first = (await readFile(bundle, "utf8")).split("\n", 1)[0];
  assert.equal(first, "#!/usr/bin/env node");
  const dir = await mkdtemp(join(tmpdir(), "ac-bundle-"));
  const alone = join(dir, "aftercall-mcp.mjs");
  await copyFile(bundle, alone);
  const fake = await startFakeApp();
  const client = await connect(["--socket", fake.socketPath], { AFTERCALL_TOKEN: fake.token }, alone);
  try {
    assert.equal(client.getServerVersion()?.name, "aftercall");
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOL_NAMES].sort());
    const list = await client.callTool({ name: "list_action_items", arguments: { owner: "you" } });
    assert.equal(JSON.parse(text(list)).canClaim, false);
  } finally {
    await client.close();
    await fake.close();
    await rm(dir, { recursive: true, force: true });
  }
});
