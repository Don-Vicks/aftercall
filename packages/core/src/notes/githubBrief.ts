// Filling a project brief from a GitHub repository, without AI. The desktop app fetches
// the repo's public details (`github_repo`, apps/desktop/src-tauri/src/github.rs); these
// pure functions turn them into suggestions that the user reviews before anything is
// saved. Everything suggested is copied from the repo as GitHub has it: the description
// or the README's first paragraph, names from the topics, package files and README title,
// and contributors' names. Roles are never guessed: a person gets "code owner" only when
// the repo's CODEOWNERS file names them, and no role otherwise.

import { BRIEF_LIMITS, cleanBrief, type BriefPerson } from "./pipeline.ts";

/** A repo's details as `github_repo` returns them (through `gh`, or GitHub's public API). */
export interface GithubRepoDetails {
  /** "owner/name", as GitHub spells it. */
  repo: string;
  /** "gh": the GitHub CLI, with your own sign-in. "web": GitHub's public API, signed out. */
  via: "gh" | "web";
  name: string;
  description: string;
  homepage: string;
  topics: string[];
  language: string;
  private: boolean;
  /** The README's text (capped), "" without one. */
  readme: string;
  /** Most commits first. */
  contributors: GithubContributor[];
  /** The CODEOWNERS file, "" without one. */
  codeowners: string;
  /** package.json and Cargo.toml at the root, "" when absent. */
  packageJson: string;
  cargoToml: string;
}

export interface GithubContributor {
  login: string;
  /** Their profile name, "" when they haven't set one (or it wasn't looked up). */
  name: string;
  contributions: number;
  bot: boolean;
}

/** What a repo suggests for a brief, already within `BRIEF_LIMITS`. */
export interface GithubSuggestion {
  repo: string;
  /** A project name to offer when none was typed: "moonbeam-web" → "Moonbeam Web". */
  name: string;
  about: string;
  /** Where About came from. */
  aboutFrom: "description" | "readme" | "";
  people: BriefPerson[];
  words: string[];
}

/** Where a brief came from, saved (sealed) with the project. Absent: you wrote it. */
export interface BriefSource {
  kind: "github";
  /** "owner/name". */
  repo: string;
  /** Unix seconds of the last import or refresh. */
  fetchedAt: number;
  /**
   * What GitHub suggested at that time (About, people's names, words), so Refresh can
   * show only what changed on GitHub, and never brings back what you removed or changes
   * what you edited.
   */
  seen?: { about?: string; people?: string[]; words?: string[] };
}

/** At most this many people come from a repo. */
export const GITHUB_PEOPLE_MAX = 8;
/** At most this many words come from a repo. */
export const GITHUB_WORDS_MAX = 15;

const REPO_RE = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/;

/** True for "owner/name" as GitHub allows it. */
export function isRepoSlug(slug: string): boolean {
  const m = REPO_RE.exec(slug);
  return Boolean(m) && m![2] !== "." && m![2] !== "..";
}

/**
 * "owner/name" from what you paste: a github.com URL (any page in the repo), "owner/name",
 * or an SSH remote; null when it isn't a GitHub repo.
 */
export function parseRepoInput(text: string): string | null {
  let t = text.trim();
  if (!t) return null;
  t = t.replace(/^git@github\.com:/i, "").replace(/^(?:git\+)?(?:https?|ssh|git):\/\/(?:[^@/]+@)?/i, "");
  t = t.replace(/^(?:www\.)?github\.com\//i, "");
  if (/^[^/]+\.[a-z]{2,}\//i.test(t) && !/^github\.com\//i.test(t)) return null; // another host
  const [owner, name] = t.split(/[/?#]/).filter(Boolean);
  if (!owner || !name) return null;
  const slug = `${owner}/${name.replace(/\.git$/i, "")}`;
  return isRepoSlug(slug) ? slug : null;
}

/** "moonbeam-web" → "Moonbeam Web", "aftercall" → "Aftercall". */
export function projectNameFromRepo(name: string): string {
  return name
    .replace(/\.git$/i, "")
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((w) => (/[A-Z]/.test(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ")
    .slice(0, 60);
}

/** Markdown and HTML down to the words someone would read. */
function plainText(md: string): string {
  return md
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, " ") // linked badges
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[a-z][^>]*>/gi, " ") // other tags, keeping their text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → their text
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1") // reference links
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cuts to `max` characters at the end of a sentence, or else a word, with no half words. */
function cutTo(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const head = chars.slice(0, max).join("");
  const sentence = head.match(/^[\s\S]*[.!?](?=\s|$)/);
  if (sentence && sentence[0].length > max / 2) return sentence[0].trim();
  return `${head.replace(/\s+\S*$/, "").replace(/[,;:\s]+$/, "")}…`;
}

/** The README's blocks: paragraphs, headings and the rest, split on blank lines (code fences kept whole). */
function blocks(readme: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fence = false;
  const flush = () => {
    if (cur.length) out.push(cur.join("\n"));
    cur = [];
  };
  for (const line of readme.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (!fence) flush();
      fence = !fence;
      cur.push(line);
      if (!fence) flush();
      continue;
    }
    if (fence) {
      cur.push(line);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    // A heading always stands alone.
    if (/^\s{0,3}#{1,6}\s/.test(line) || /^\s*<h[1-6]\b/i.test(line)) {
      flush();
      out.push(line);
      continue;
    }
    cur.push(line);
  }
  flush();
  return out;
}

const isHeading = (b: string) => /^\s{0,3}#{1,6}\s/.test(b) || /^\s*<h[1-6]\b/i.test(b) || /^[^\n]+\n\s*(=+|-+)\s*$/.test(b);

/** The README's title: its first H1 (Markdown, Setext or HTML), as plain text. */
export function readmeTitle(readme: string): string {
  for (const b of blocks(readme)) {
    const md = /^\s{0,3}#\s+(.+?)\s*#*\s*$/.exec(b);
    if (md) return plainText(md[1]);
    const setext = /^([^\n]+)\n\s*=+\s*$/.exec(b);
    if (setext) return plainText(setext[1]);
    const html = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(b);
    if (html) return plainText(html[1]);
  }
  return "";
}

/**
 * What the README says the project is: its first real paragraph (after the title), as
 * plain text, cut to fit About. Badges, images, code, tables, lists and headings are
 * skipped; a blockquote counts (many READMEs put their tagline in one). "" when none.
 */
export function readmeAbout(readme: string, max: number = BRIEF_LIMITS.about): string {
  for (const b of blocks(readme)) {
    if (isHeading(b) || /^\s*(```|~~~)/.test(b)) continue;
    const lines = b.split("\n");
    if (lines.every((l) => /^\s*([-*+]|\d+[.)])\s/.test(l) || /^\s*\|/.test(l) || /^\s*[-=_*]{3,}\s*$/.test(l))) continue; // lists, tables, rules
    const text = plainText(lines.map((l) => l.replace(/^\s*>\s?/, "")).join(" "));
    // Only badges or links were there; or it's too short to say anything.
    if (Array.from(text).length < 20 || !/[a-z]{3}/i.test(text)) continue;
    return cutTo(text, max);
  }
  return "";
}

/** GitHub logins that a CODEOWNERS file names (`@user`; teams and emails are left out). */
export function codeownerLogins(codeowners: string): string[] {
  const out: string[] = [];
  for (const raw of codeowners.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    for (const owner of line.split(/\s+/).slice(1)) {
      const m = /^@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))$/.exec(owner);
      if (m && !out.some((o) => o.toLowerCase() === m[1].toLowerCase())) out.push(m[1]);
    }
  }
  return out;
}

/** The package names in package.json and Cargo.toml (`[package] name`), "@scope/x" as "x". */
export function packageNames(packageJson: string, cargoToml: string): string[] {
  const out: string[] = [];
  try {
    const name = (JSON.parse(packageJson || "null") as { name?: unknown } | null)?.name;
    if (typeof name === "string" && name.trim()) out.push(name.trim().replace(/^@[^/]+\//, ""));
  } catch {
    // Not JSON: no name from it.
  }
  const pkg = /^\s*\[package\]\s*$([\s\S]*?)(?=^\s*\[|(?![\s\S]))/m.exec(cargoToml);
  const crate = pkg && /^\s*name\s*=\s*"([^"]+)"/m.exec(pkg[1]);
  if (crate) out.push(crate[1].trim());
  return out;
}

/** Topics that say nothing about one project: languages, frameworks everyone uses, events. */
const GENERIC_TOPICS = new Set(
  [
    "hacktoberfest", "javascript", "typescript", "python", "python3", "go", "golang", "rust", "java", "kotlin", "swift", "ruby", "php", "c", "cpp", "c-plus-plus",
    "csharp", "html", "css", "shell", "bash", "react", "reactjs", "nodejs", "node", "npm", "web", "app", "api", "cli", "library", "framework", "open-source",
    "opensource", "awesome", "tool", "tools", "github", "git", "docker", "linux", "macos", "windows", "frontend", "backend", "fullstack", "website", "site",
    "docs", "server", "client", "core", "src", "main",
  ],
);

/** Languages too common to help spelling; a rarer one (Cairo, Move) is kept. */
const COMMON_LANGUAGES = new Set(["javascript", "typescript", "python", "go", "rust", "java", "kotlin", "swift", "ruby", "php", "c", "c++", "c#", "html", "css", "shell", "scss", "vue", "dart", "objective-c", "makefile", "dockerfile", "jupyter notebook"]);

/** "booking-flow" → "booking flow". */
const topicWord = (t: string) => t.replace(/-/g, " ").trim();

/**
 * The brief a repo suggests: About from its description (or the README's first
 * paragraph), people from its contributors (bots left out, most commits first, real
 * names when they have one), and words from its name, README title, package names,
 * topics and an uncommon language. Nothing is made up; everything fits `BRIEF_LIMITS`.
 */
export function briefFromGithub(d: GithubRepoDetails): GithubSuggestion {
  const description = plainText(d.description ?? "");
  const fromReadme = description ? "" : readmeAbout(d.readme ?? "");
  const about = description ? cutTo(description, BRIEF_LIMITS.about) : fromReadme;

  const owners = codeownerLogins(d.codeowners ?? "").map((o) => o.toLowerCase());
  const people: BriefPerson[] = [];
  const humans = (d.contributors ?? []).filter((c) => !c.bot && !/\[bot\]$/i.test(c.login) && !/-bot$/i.test(c.login));
  for (const c of humans) {
    const name = (c.name || "").trim() || c.login;
    people.push(owners.includes(c.login.toLowerCase()) ? { name, role: "code owner" } : { name });
  }
  // Code owners who aren't among the contributors listed.
  for (const login of codeownerLogins(d.codeowners ?? "")) {
    if (!humans.some((c) => c.login.toLowerCase() === login.toLowerCase())) people.push({ name: login, role: "code owner" });
  }
  // Code owners first, then by commits (the order GitHub lists contributors in).
  people.sort((a, b) => Number(Boolean(b.role)) - Number(Boolean(a.role)));

  const heading = readmeTitle(d.readme ?? "");
  // A README title short enough to be a name ("Moonbeam Bikes"), not a sentence.
  const title = heading && Array.from(heading).length <= BRIEF_LIMITS.word && heading.split(/\s+/).length <= 4 ? heading : "";
  const repoName = d.name || d.repo.split("/")[1] || "";
  const genericName = GENERIC_TOPICS.has(repoName.toLowerCase()) || repoName.length < 3;
  const words = [
    ...(title ? [title] : []),
    ...(genericName ? [] : [repoName]),
    ...packageNames(d.packageJson ?? "", d.cargoToml ?? ""),
    ...(d.topics ?? []).filter((t) => !GENERIC_TOPICS.has(t.toLowerCase())).map(topicWord),
    ...(d.language && !COMMON_LANGUAGES.has(d.language.toLowerCase()) ? [d.language] : []),
  ];

  const clean = cleanBrief({ about, people: people.slice(0, GITHUB_PEOPLE_MAX), words: words.slice(0, GITHUB_WORDS_MAX * 2) });
  return {
    repo: d.repo,
    name: genericName && title ? title : projectNameFromRepo(repoName),
    about: clean?.about ?? "",
    aboutFrom: clean?.about ? (description ? "description" : "readme") : "",
    people: clean?.people ?? [],
    words: (clean?.words ?? []).slice(0, GITHUB_WORDS_MAX),
  };
}

/** What a suggestion is remembered as, for the next Refresh. */
export function seenFrom(s: GithubSuggestion): NonNullable<BriefSource["seen"]> {
  return {
    ...(s.about ? { about: s.about } : {}),
    ...(s.people.length ? { people: s.people.map((p) => p.name) } : {}),
    ...(s.words.length ? { words: [...s.words] } : {}),
  };
}
