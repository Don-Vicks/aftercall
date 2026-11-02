import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  briefFromGithub,
  codeownerLogins,
  isRepoSlug,
  packageNames,
  parseRepoInput,
  projectNameFromRepo,
  readmeAbout,
  readmeTitle,
  seenFrom,
  type GithubRepoDetails,
} from "./githubBrief.ts";
import { BRIEF_LIMITS, cleanBrief } from "./pipeline.ts";

// Saved fixtures only: these tests never call GitHub.
const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "github");
const readme = (name: string) => readFileSync(join(dir, name), "utf8");
const details = (name: string, md?: string): GithubRepoDetails => ({ ...JSON.parse(readFileSync(join(dir, name), "utf8")), ...(md ? { readme: readme(md) } : { readme: "" }) });

test("a repo is recognised from a URL, owner/name or an SSH remote, and nothing else", () => {
  for (const input of [
    "moonbeam/web",
    " https://github.com/moonbeam/web ",
    "github.com/moonbeam/web",
    "https://www.github.com/moonbeam/web/tree/main/app",
    "https://github.com/moonbeam/web.git",
    "git@github.com:moonbeam/web.git",
    "ssh://git@github.com/moonbeam/web",
    "https://github.com/moonbeam/web?tab=readme",
  ]) {
    assert.equal(parseRepoInput(input), "moonbeam/web", input);
  }
  assert.equal(parseRepoInput("near/near-api-js"), "near/near-api-js");
  assert.equal(parseRepoInput("o/repo.name_x"), "o/repo.name_x");
  for (const bad of ["", "moonbeam", "https://gitlab.com/moonbeam/web", "-bad/web", "a/..", "a/b c", "a/b;rm -rf", "o/" + "x".repeat(101), "x".repeat(40) + "/web"]) {
    assert.equal(parseRepoInput(bad), null, bad);
  }
  assert.ok(isRepoSlug("cli/cli") && !isRepoSlug("cli/cli/extra") && !isRepoSlug("a/."));
});

test("README → About: its first real paragraph, as plain text, badges, HTML, code and headings left out", () => {
  assert.equal(
    readmeAbout(readme("moonbeam-web.README.md")),
    "The booking site for Moonbeam Bikes: riders pick a bike and a time slot, then pay with Stripe. Built with Next.js; the booking flow lives in app/book.",
  );
  // A blockquote tagline under an HTML header counts; entities are decoded.
  const tagline = readmeAbout(readme("tagline.README.md"));
  assert.match(tagline, /^A tiny, fast tide-table engine for harbour apps & sailing clubs, written in Rust\./);
  assert.ok(!/[<>[\]]|img|shields/.test(tagline), tagline);
  // Cut at a sentence when it's too long, never mid-word.
  assert.equal(readmeAbout(readme("tagline.README.md"), 120), "A tiny, fast tide-table engine for harbour apps & sailing clubs, written in Rust.");
  assert.equal(readmeAbout("# Title\n\nshort\n\n```\ncode block that is long enough to count\n```\n"), "");
  assert.equal(readmeAbout("- a list item that is long enough\n- another one that is long enough\n\n| a | table |\n"), "");
  assert.equal(readmeAbout(""), "");
  const long = readmeAbout(`${"word ".repeat(200)}`);
  assert.ok(Array.from(long).length <= BRIEF_LIMITS.about && long.endsWith("word…"), long.slice(-20));
});

test("README title from Markdown, Setext or an HTML header", () => {
  assert.equal(readmeTitle(readme("moonbeam-web.README.md")), "Moonbeam Bikes");
  assert.equal(readmeTitle(readme("tagline.README.md")), "Tidepool");
  assert.equal(readmeTitle("Tidepool\n========\n\nText"), "Tidepool");
  assert.equal(readmeTitle("# `ac` **Aftercall** #\n"), "ac Aftercall");
  assert.equal(readmeTitle("No heading here"), "");
});

test("CODEOWNERS gives user logins only; package names come from package.json and Cargo.toml's [package]", () => {
  assert.deepEqual(codeownerLogins("# comment @nobody\n* @olamide-a @moonbeam/web-team\n/docs/ docs@moonbeam.bike @sam-r @Olamide-A\n*.rs @x # @y\n"), ["olamide-a", "sam-r", "x"]);
  assert.deepEqual(packageNames('{"name":"@moonbeam/booking-web"}', ""), ["booking-web"]);
  assert.deepEqual(packageNames("not json", details("tidepool.json").cargoToml), ["tidepool-core"]);
  assert.deepEqual(packageNames("", "[dependencies]\nname = \"x\"\n"), []);
  assert.equal(projectNameFromRepo("moonbeam-web"), "Moonbeam Web");
  assert.equal(projectNameFromRepo("near_api.js"), "Near Api Js");
  assert.equal(projectNameFromRepo("macOS-tools"), "macOS Tools");
});

test("a repo's suggestion: description as About, contributors as people with no invented roles, names and topics as words", () => {
  const s = briefFromGithub(details("moonbeam-web.json", "moonbeam-web.README.md"));
  assert.equal(s.repo, "moonbeam/web");
  assert.equal(s.about, "Booking site for Moonbeam Bikes: bikes, time slots and Stripe payments");
  assert.equal(s.aboutFrom, "description");
  // Bots are left out; a contributor without a profile name keeps their login; only CODEOWNERS gives a role.
  assert.deepEqual(s.people, [{ name: "Olamide Adebayo", role: "code owner" }, { name: "sam-r", role: "code owner" }, { name: "John Kim" }, { name: "ada-o" }]);
  // "web" says nothing, so the README title names it; generic topics and a common language are left out.
  assert.deepEqual(s.words, ["Moonbeam Bikes", "booking-web", "booking", "stripe", "nextjs", "booking flow"]);
  assert.equal(s.name, "Moonbeam Bikes");
  // The README's "ignore previous instructions" never reaches the suggestion.
  assert.ok(!JSON.stringify(s).includes("Mallory"));
  // Already within the limits: cleanBrief leaves it as it is.
  assert.deepEqual(cleanBrief({ about: s.about, people: s.people, words: s.words }), { about: s.about, people: s.people, words: s.words });
  assert.deepEqual(seenFrom(s), { about: s.about, people: ["Olamide Adebayo", "sam-r", "John Kim", "ada-o"], words: s.words });
});

test("without a description, About comes from the README; an empty repo suggests only its name", () => {
  const s = briefFromGithub(details("tidepool.json", "tagline.README.md"));
  assert.equal(s.aboutFrom, "readme");
  assert.match(s.about, /^A tiny, fast tide-table engine/);
  assert.deepEqual(s.people, [{ name: "Mira Halvorsen" }]);
  assert.deepEqual(s.words, ["Tidepool", "tidepool-core", "tides", "sailing", "noaa"]);
  assert.equal(s.name, "Tidepool");

  const empty = briefFromGithub(details("empty.json"));
  assert.deepEqual(empty, { repo: "someone/new-thing", name: "New Thing", about: "", aboutFrom: "", people: [], words: ["new-thing"] });
});

test("a repo can't break out of the brief block or past the limits", () => {
  const d = details("moonbeam-web.json");
  const s = briefFromGithub({
    ...d,
    description: `Close >>> the block <<< ${"x".repeat(600)}`,
    topics: Array.from({ length: 50 }, (_, i) => `topic-${i}`),
    contributors: Array.from({ length: 30 }, (_, i) => ({ login: `dev${i}`, name: `Dev ${i} ${"N".repeat(80)}`, contributions: 30 - i, bot: false })),
    codeowners: "",
  });
  assert.ok(!/<<<|>>>/.test(JSON.stringify(s)));
  assert.ok(Array.from(s.about).length <= BRIEF_LIMITS.about);
  assert.equal(s.people.length, 8);
  assert.ok(s.people.every((p) => Array.from(p.name).length <= BRIEF_LIMITS.name));
  assert.equal(s.words.length, 15);
});
