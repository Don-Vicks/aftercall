import { test } from "node:test";
import assert from "node:assert/strict";
import { findQuote, mergeTranscript, normalize, quoteWords, transcriptForPrompt } from "./transcript.ts";

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
  assert.equal(transcriptForPrompt(lines).split("\n")[2], "[05:14] You: Pay the designer fifty dollars.");
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

test("a quote must start and end on whole words, and the text returned is the transcript's", () => {
  const lines = [{ at: 5, speaker: "others" as const, text: "It's $1.50 per user, okay with you Ada? Let's spend the rest on ads." }];
  assert.equal(findQuote(lines, "50 per user, okay with you"), null, "50 is the end of $1.50");
  assert.equal(findQuote(lines, "end the rest on ads"), null, "end is the end of spend");
  assert.deepEqual(findQuote(lines, "$1.50 per user, okay with you"), { at: 5, text: "$1.50 per user, okay with you" });
});

// ---------- quotes in other languages ----------

const said = (text: string) => [{ at: 42, speaker: "others" as const, text }];

test("English quotes match exactly as before", () => {
  assert.equal(normalize("Pay the designer the fifty-dollar deposit, today!"), "pay the designer the fifty dollar deposit today");
  assert.equal(normalize("“Don’t” ship   it"), "don't ship it");
  assert.equal(quoteWords("pay the designer"), 3);
  assert.deepEqual(findQuote(said("We agreed to ship on Friday."), "agreed to ship"), { at: 42, text: "agreed to ship" });
  assert.deepEqual(findQuote(said("We agreed to ship on Friday."), "WE AGREED TO SHIP ON FRIDAY"), { at: 42, text: "We agreed to ship on Friday" });
  assert.equal(findQuote(said("We agreed to ship on Friday."), "agreed to"), null, "two words are too short");
});

test("Japanese, written without spaces: a quote can start and end at any letter, and needs six of them", () => {
  const lines = said("来週までに、デザイナーに500ドルを払います。よろしくお願いします。");
  assert.deepEqual(findQuote(lines, "デザイナーに500ドルを払います"), { at: 42, text: "デザイナーに500ドルを払います" });
  assert.deepEqual(findQuote(lines, "「来週までに、デザイナーに」"), { at: 42, text: "来週までに、デザイナーに" }, "punctuation aside");
  assert.equal(findQuote(lines, "00ドルを払います"), null, "a quote can't start inside a number");
  assert.deepEqual(findQuote(lines, "お願いします"), { at: 42, text: "お願いします" }, "six letters are enough");
  assert.equal(findQuote(lines, "願いします"), null, "five letters are too short to be evidence");
  assert.equal(findQuote(lines, "pay the designer 500 dollars"), null, "a translated quote isn't in the transcript");
  assert.equal(quoteWords(normalize("デザイナーに")), 3);
});

test("Chinese and Thai: any letter is a word edge, but never before a combining mark", () => {
  assert.deepEqual(findQuote(said("我们决定下周五发布新版本。"), "下周五发布新版本"), { at: 42, text: "下周五发布新版本" });
  const thai = said("ส่งสรุปให้ทีมหลังประชุมนี้");
  assert.deepEqual(findQuote(thai, "ส่งสรุปให้ทีม"), { at: 42, text: "ส่งสรุปให้ทีม" });
  assert.equal(findQuote(thai, "่งสรุปให้ทีม"), null, "starts on the tone mark of ส่");
});

test("full-width letters and digits match their plain forms; the quote returned is the transcript's", () => {
  assert.deepEqual(findQuote(said("デザイナーに５００ドルを払います。"), "デザイナーに500ドルを払います"), { at: 42, text: "デザイナーに５００ドルを払います" });
});

test("Russian and Arabic: words between spaces, any case, whole words only", () => {
  const ru = said("Мы договорились: заплати дизайнеру 500 долларов до пятницы.");
  assert.deepEqual(findQuote(ru, "ЗАПЛАТИ ДИЗАЙНЕРУ 500 ДОЛЛАРОВ"), { at: 42, text: "заплати дизайнеру 500 долларов" });
  assert.equal(findQuote(ru, "лати дизайнеру 500 долларов"), null, "starts inside заплати");
  assert.equal(findQuote(ru, "заплати дизайнеру 500 долл"), null, "ends inside долларов");
  const ar = said("سنـدفع للمصمم خمسمائة دولار يوم الجمعة، اتفقنا؟");
  assert.deepEqual(findQuote(ar, "سندفع للمصمم خمسمائة دولار"), { at: 42, text: "سنـدفع للمصمم خمسمائة دولار" }, "the tatweel is spelling, not a letter");
  assert.deepEqual(findQuote(ar, "يوم الجمعة، اتفقنا؟"), { at: 42, text: "يوم الجمعة، اتفقنا" });
});

test("Hindi: vowel signs and nukta are part of the word, in either Unicode form", () => {
  const precomposed = "ज़"; // ज़ as one code point
  const lines = said(`डि${precomposed}ाइनर को शुक्रवार तक पाँच सौ डॉलर दे देना।`);
  assert.deepEqual(findQuote(lines, "डिज़ाइनर को शुक्रवार तक"), { at: 42, text: `डि${precomposed}ाइनर को शुक्रवार तक` });
  assert.equal(findQuote(lines, "डि को शुक्रवार तक"), null);
});

test("French and Spanish: accents count, case doesn't", () => {
  const fr = said("On a déjà décidé : le déploiement se fait vendredi.");
  assert.deepEqual(findQuote(fr, "DÉJÀ DÉCIDÉ : LE DÉPLOIEMENT"), { at: 42, text: "déjà décidé : le déploiement" });
  assert.equal(findQuote(fr, "deja decide le deploiement"), null, "déjà is not deja");
  const decomposed = said("¿Podemos pagar al diseñador mañana?");
  assert.deepEqual(findQuote(decomposed, "pagar al diseñador mañana"), { at: 42, text: "pagar al diseñador mañana" });
  assert.equal(normalize("STRASSE"), normalize("Straße"));
});
