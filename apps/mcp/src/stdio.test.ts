import { strict as assert } from "node:assert";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { makeDataDir } from "./fixture.ts";
import { TOOL_NAMES } from "./server.ts";

/** Starts the real server as a child process and talks MCP to it over stdio, as Claude Code and Codex do. */
test("the server starts over stdio, lists its tools and answers a call", async () => {
  const dir = await makeDataDir();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("./main.ts", import.meta.url)), "--data-dir", dir],
    stderr: "pipe",
  });
  const client = new Client({ name: "aftercall-test", version: "0.0.0" });
  try {
    await client.connect(transport);
    assert.match(client.getInstructions() ?? "", /can't send emails, make payments, record proofs/);

    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOL_NAMES].sort());
    for (const t of tools) assert.match(t.description ?? "", /can't send emails, make payments, record proofs on NEAR/);
    assert.equal(tools.find((t) => t.name === "get_meeting")?.annotations?.readOnlyHint, true);

    const claim = await client.callTool({ name: "claim_action_item", arguments: { meetingId: "1761000000", itemId: "a1", agent: "Codex" } });
    assert.equal(claim.isError, undefined);
    const list = await client.callTool({ name: "list_action_items", arguments: { includeClaimed: true, owner: "You" } });
    const text = (list.content as { type: string; text: string }[])[0].text;
    assert.equal(JSON.parse(text).items[0].claimed.agent, "Codex");

    const bad = await client.callTool({ name: "get_meeting", arguments: { id: "nope" } });
    assert.equal(bad.isError, true);
  } finally {
    await client.close();
    await rm(dir, { recursive: true, force: true });
  }
});
