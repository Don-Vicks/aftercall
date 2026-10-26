import { test } from "node:test";
import assert from "node:assert/strict";
import { findQuote, mergeTranscript, normalize, transcriptForPrompt } from "./transcript.ts";

test("merges both stems and all chunks into one timeline", () => {
  const lines = mergeTranscript(
    [
      { speaker: "others", index: 0, result: { text: "", segments: [{ start: 31, end: 36, text: " The API fix ships first." }] } },
      { speaker: "you", index: 0, result: { text: "", segments: [{ start: 4, end: 8, text: " Hi team." }, { start: 9, end: 12, text: " Quick one." }] } },
      { speaker: "you", index: 1, result: { text: "", segments: [{ start: 14, end: 20, text: " Pay the designer fifty dollars." }] } },
    ],
    300,
  );
  assert.deepEqual(lines, [
    { at: 4, speaker: "you", text: "Hi team. Quick one." },
    { at: 31, speaker: "others", text: "The API fix ships first." },
    { at: 314, speaker: "you", text: "Pay the designer fifty dollars." },
  ]);
  assert.equal(transcriptForPrompt(lines).split("\n")[2], "[05:14] YOU: Pay the designer fifty dollars.");
});

test("drops segments Whisper marks as probably not speech", () => {
  const lines = mergeTranscript(
    [{ speaker: "others", index: 0, result: { text: "", segments: [{ start: 1, end: 2, text: "Thank you.", no_speech_prob: 0.9 }] } }],
    300,
  );
  assert.deepEqual(lines, []);
});

test("finds quotes regardless of case, punctuation and curly quotes", () => {
  const lines = [
    { at: 134, speaker: "you" as const, text: "Send Ada the recap after this call, and pay the designer the fifty-dollar deposit today." },
  ];
  assert.deepEqual(findQuote(lines, "pay the designer the fifty dollar deposit today"), {
    at: 134,
    text: "pay the designer the fifty-dollar deposit today",
  });
  assert.equal(findQuote(lines, "Send Ada the recap")?.at, 134);
  assert.equal(normalize("It’s “Fifty”!"), "it's fifty");
});

test("refuses quotes that aren't in the transcript, or are too short to be evidence", () => {
  const lines = [{ at: 0, speaker: "others" as const, text: "We agreed to ship on Friday." }];
  assert.equal(findQuote(lines, "pay the designer five thousand"), null);
  assert.equal(findQuote(lines, "Friday"), null);
});
