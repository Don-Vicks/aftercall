#!/usr/bin/env node
// Screenshots the desktop interface in a browser, light and dark (node scripts/screens.mjs).
//
// Runs against the Vite dev UI (the same React app the Mac app shows, in browser-preview
// mode with sample data). Starts its own on a free port unless --url points at one
// that is already running. Every shot is 1280×820 with reduced motion, so nothing is
// caught mid-animation.
//
//   node scripts/screens.mjs                       # every view, both themes → artifacts/screens/{theme}/
//   node scripts/screens.mjs --out artifacts/screens/baseline
//   node scripts/screens.mjs --url http://localhost:1420 --only home,wallet --themes dark
//
// Uses the Chromium Playwright already installed in ~/Library/Caches/ms-playwright;
// if there is none, it runs `npx playwright install chromium` once.

import { spawn, execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VIEWPORT = { width: 1280, height: 820 };

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = join(ROOT, opt("out", "artifacts/screens"));
const THEMES = opt("themes", "dark,light").split(",");
const ONLY = opt("only", "") ? new Set(opt("only", "").split(",")) : null;

/** Clicks a sidebar row or button by its accessible name (a string matches exactly). */
const click = (page, role, name) => page.getByRole(role, { name, exact: typeof name === "string" }).first().click();

/** Opens a project's options menu, which shows on hover. */
async function projectMenu(page, project) {
  const button = page.locator(`[aria-label="${project} options"]`);
  await page.locator(".group", { has: button }).hover();
  await button.click();
}

/**
 * Each view: how to reach it from a fresh load. `onboarding: true` leaves the
 * first-run flag unset. `wait` names something that only exists in v2; when it
 * doesn't show, the shot is skipped instead of failing (baseline runs).
 */
const SHOTS = [
  { name: "home", go: async () => {} },
  { name: "search", go: (p) => click(p, "button", /^Search/) },
  { name: "meeting", go: (p) => click(p, "button", /^Sync with Ada/) },
  {
    name: "transcript",
    go: async (p) => {
      await click(p, "button", /^Sync with Ada/);
      await click(p, "tab", /transcript/i);
    },
  },
  { name: "wallet", go: (p) => click(p, "button", "Agent wallet") },
  { name: "settings", go: (p) => click(p, "button", "Settings") },
  { name: "agents", go: (p) => click(p, "button", "Connected agents") },
  { name: "record", go: (p) => click(p, "button", /^New recording/) },
  { name: "new-project", go: (p) => click(p, "button", "New project") },
  { name: "onboarding", onboarding: true, go: async () => {} },
  {
    // Deleting the only project explains why it can't, in a toast.
    name: "toast",
    wait: "[data-toast]",
    go: async (p) => {
      p.once("dialog", (d) => d.dismiss());
      await projectMenu(p, "General");
      await click(p, "menuitem", /^Delete/);
    },
  },
  {
    // A second project can be deleted, after a confirm dialog.
    name: "confirm",
    wait: "[role=alertdialog]",
    go: async (p) => {
      p.once("dialog", (d) => d.dismiss());
      await click(p, "button", "New project");
      await p.getByLabel("Name").fill("Fundraise");
      await click(p, "button", "Create project");
      await projectMenu(p, "Fundraise");
      await click(p, "menuitem", /^Delete/);
    },
  },
];

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitFor(url, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} didn't answer within ${ms / 1000} s`);
}

/** Starts the Vite dev UI on a free port (never 1420, which `tauri dev` may hold). */
async function startVite() {
  const port = await freePort();
  const child = spawn("pnpm", ["--filter", "@aftercall/desktop", "exec", "vite", "--port", String(port), "--strictPort"], {
    cwd: ROOT,
    stdio: "ignore",
    detached: true,
  });
  const url = `http://localhost:${port}`;
  await waitFor(url);
  return { url, stop: () => process.kill(-child.pid, "SIGTERM") };
}

async function launch() {
  try {
    return await chromium.launch();
  } catch (e) {
    if (!String(e).includes("Executable doesn't exist")) throw e;
    console.log("No Playwright Chromium found; installing it once…");
    execFileSync("npx", ["playwright", "install", "chromium"], { cwd: ROOT, stdio: "inherit" });
    return chromium.launch();
  }
}

const server = opt("url", "") ? { url: opt("url", ""), stop: () => {} } : await startVite();
const browser = await launch();
let failed = 0;
try {
  for (const theme of THEMES) {
    mkdirSync(join(OUT, theme), { recursive: true });
    for (const shot of SHOTS) {
      if (ONLY && !ONLY.has(shot.name)) continue;
      const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: theme, reducedMotion: "reduce" });
      if (!shot.onboarding) await context.addInitScript(() => localStorage.setItem("aftercall.onboarded", "1"));
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      const file = join(OUT, theme, `${shot.name}.png`);
      try {
        // Not "networkidle": the app keeps polling while it's open.
        await page.goto(server.url, { waitUntil: "load" });
        await page.locator(shot.onboarding ? "text=Step 1 of" : "nav").first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        await shot.go(page);
        if (shot.wait) {
          const shown = await page
            .locator(shot.wait)
            .first()
            .waitFor({ timeout: 2000 })
            .then(() => true)
            .catch(() => false);
          if (!shown) {
            console.log(`- ${theme}/${shot.name}: skipped (${shot.wait} not on screen)`);
            continue;
          }
        }
        await page.waitForTimeout(300);
        await page.screenshot({ path: file });
        console.log(`✓ ${relative(ROOT, file)}`);
      } catch (e) {
        failed++;
        console.log(`✗ ${theme}/${shot.name}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  server.stop();
}
process.exit(failed ? 1 : 0);
