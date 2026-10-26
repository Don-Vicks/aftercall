import { test } from "node:test";
import assert from "node:assert/strict";
import { formatClock, formatDuration } from "./meeting.ts";

test("formats transcript clock times", () => {
  assert.equal(formatClock(134), "02:14");
  assert.equal(formatClock(4), "00:04");
});

test("formats meeting durations", () => {
  assert.equal(formatDuration(192), "3 min 12 s");
  assert.equal(formatDuration(42), "42 s");
});
