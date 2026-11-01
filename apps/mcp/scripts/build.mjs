/**
 * Bundles the MCP server into one plain-JS file, dist/aftercall-mcp.mjs, with
 * @aftercall/core and the MCP SDK inlined, so it runs with `node` alone (Node 20 or
 * later) from wherever the app keeps it. The desktop app ships this file as a bundle
 * resource (apps/desktop/src-tauri/tauri.conf.json).
 */
import { chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const outfile = `${root}dist/aftercall-mcp.mjs`;

await build({
  entryPoints: [`${root}src/main.ts`],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // esbuild keeps main.ts's `#!/usr/bin/env node` as the first line. Some inlined
  // packages are CommonJS and call require() for Node built-ins.
  banner: { js: "import { createRequire as __aftercallRequire } from 'node:module';\nconst require = __aftercallRequire(import.meta.url);" },
  legalComments: "eof",
  logLevel: "warning",
});
await chmod(outfile, 0o755);
console.log(`built ${outfile}`);
