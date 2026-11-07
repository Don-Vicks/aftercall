import { test } from "node:test";
import assert from "node:assert/strict";
import { WORK_LINK_MAX, workLink, workLinkLabel } from "./work.ts";

test("a work link is a plain http or https URL, as given", () => {
  assert.equal(workLink("https://github.com/acme/api/pull/42"), "https://github.com/acme/api/pull/42");
  assert.equal(workLink("  http://docs.example.com/plan?v=2#top \n"), "http://docs.example.com/plan?v=2#top");
  assert.equal(workLink("HTTPS://example.com"), "HTTPS://example.com");
  assert.equal(workLink(`https://example.com/${"a".repeat(WORK_LINK_MAX - 20)}`)?.length, WORK_LINK_MAX);
});

test("anything else is no link", () => {
  for (const bad of [
    "javascript:alert(1)",
    "data:text/html,<b>x</b>",
    "file:///etc/passwd",
    "mailto:ada@example.com",
    "ftp://example.com",
    "https://",
    "https:///path",
    "https://user:pass@example.com/",
    "https://ada@example.com/",
    "https://example.com/a b",
    "https://example.com/\nnext",
    "https://exämple.com/",
    "//example.com/x",
    "github.com/acme/api/pull/42",
    `https://example.com/${"a".repeat(WORK_LINK_MAX)}`,
    "",
    42,
    null,
  ]) {
    assert.equal(workLink(bad), null, String(bad));
  }
});

test("a short label for the links agents give most", () => {
  assert.equal(workLinkLabel("https://github.com/acme/api/pull/42"), "PR #42");
  assert.equal(workLinkLabel("https://github.com/acme/api/pull/42/files"), "PR #42");
  assert.equal(workLinkLabel("https://github.com/acme/api/commit/1a2b3c4d5e6f"), "commit 1a2b3c4");
  assert.equal(workLinkLabel("https://github.com/acme/api/issues/7"), "issue #7");
  assert.equal(workLinkLabel("https://gitlab.com/acme/api/-/merge_requests/12"), "MR !12");
  assert.equal(workLinkLabel("https://www.notion.so/Plan-123"), "notion.so");
  assert.equal(workLinkLabel("https://github.com/acme"), "github.com");
});
