#!/usr/bin/env node
/**
 * Aftercall's local MCP server, over stdio. Run it with Node 24:
 *
 *   node apps/mcp/src/main.ts [--data-dir <path>]
 *
 * It reads the app's data dir (default ~/Library/Application Support/dev.aftercall.app,
 * or AFTERCALL_DATA_DIR). Nothing leaves this Mac: there is no network access here.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.ts";
import { defaultDataDir } from "./store.ts";

const flag = process.argv.indexOf("--data-dir");
const dataDir = flag > 0 && process.argv[flag + 1] ? process.argv[flag + 1] : defaultDataDir();

await createServer(dataDir).connect(new StdioServerTransport());
