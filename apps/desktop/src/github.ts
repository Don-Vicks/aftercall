import { invoke } from "@tauri-apps/api/core";
import type { GithubRepoDetails } from "@aftercall/core";
import { isDesktop } from "./recorder";

/**
 * "Fill from GitHub": the repo's public details, through the GitHub CLI or GitHub's
 * public API (src-tauri/src/github.rs). The browser preview answers from a fixture
 * for `moonbeam/web` and says "not found" for anything else; it never calls GitHub.
 */
export const githubApi = {
  /** Whether the GitHub CLI is on this Mac (looked for, not run). */
  cli: (): Promise<boolean> => (isDesktop ? invoke<boolean>("github_cli") : Promise.resolve(true)),
  repo: (repo: string): Promise<GithubRepoDetails> => (isDesktop ? invoke<GithubRepoDetails>("github_repo", { repo }) : previewRepo(repo)),
};

/** The words GitHub sees, said wherever a lookup can start. */
export const GITHUB_PRIVACY =
  "Aftercall asks GitHub for this repo's public details (with gh, using your own GitHub sign-in). GitHub sees which repo. Nothing from your meetings is sent.";

let previewLookups = 0;

const PREVIEW_README = `# Moonbeam Bikes

[![CI](https://github.com/moonbeam/web/actions/workflows/ci.yml/badge.svg)](https://github.com/moonbeam/web/actions)

The booking site for **Moonbeam Bikes**: riders pick a bike and a time slot, then pay with [Stripe](https://stripe.com).
`;

/** The preview's fake repo. From the second lookup on (Refresh), GitHub "has changed": a new description, person and topic. */
function previewRepo(repo: string): Promise<GithubRepoDetails> {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      if (repo.toLowerCase() !== "moonbeam/web") {
        reject("GitHub has no repo by that name, or your GitHub account can't see it.");
        return;
      }
      const later = previewLookups++ > 0;
      resolve({
        repo: "moonbeam/web",
        via: "gh",
        name: "web",
        description: later ? "Booking and rentals for Moonbeam Bikes: bikes, time slots and Stripe payments" : "Booking site for Moonbeam Bikes: bikes, time slots and Stripe payments",
        homepage: "https://moonbeam.bike",
        topics: ["booking", "stripe", "nextjs", "hacktoberfest", "booking-flow", ...(later ? ["rentals"] : [])],
        language: "TypeScript",
        private: true,
        readme: PREVIEW_README,
        contributors: [
          { login: "olamide-a", name: "Olamide Adebayo", contributions: 212, bot: false },
          { login: "dependabot[bot]", name: "", contributions: 140, bot: true },
          { login: "jkim", name: "John Kim", contributions: 87, bot: false },
          ...(later ? [{ login: "tolu-b", name: "Tolu Bello", contributions: 9, bot: false }] : []),
        ],
        codeowners: "* @olamide-a\n",
        packageJson: '{ "name": "@moonbeam/booking-web" }',
        cargoToml: "",
      });
    }, 650),
  );
}
