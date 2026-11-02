#!/usr/bin/env node
/**
 * Aftercall's local MCP server, over stdio. The app ships it as one plain-JS file
 * (`pnpm build` → dist/aftercall-mcp.mjs, Node 20 or later); from a checkout, Node 24
 * runs this source directly:
 *
 *   AFTERCALL_TOKEN=<token> node apps/mcp/dist/aftercall-mcp.mjs [--data-dir <path>] [--socket <path>]
 *   AFTERCALL_TOKEN=<token> node apps/mcp/src/main.ts [--data-dir <path>] [--socket <path>]
 *
 * Meetings are encrypted on disk, so this server asks the running Aftercall app for
 * them over a Unix socket the app opens only while Coding agents is on (in the sidebar)
 * (default `<data dir>/agents/aftercall.sock`; data dir defaults to
 * ~/Library/Application Support/dev.aftercall.app, or AFTERCALL_DATA_DIR). The token
 * comes from that screen. Nothing leaves this Mac: there is no network access here.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.ts";
import { connectApp, defaultDataDir, socketPathFor } from "./store.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const socketPath = arg("--socket") ?? process.env.AFTERCALL_SOCKET ?? socketPathFor(arg("--data-dir") ?? defaultDataDir());

await createServer(connectApp({ socketPath, token: process.env.AFTERCALL_TOKEN })).connect(new StdioServerTransport());
