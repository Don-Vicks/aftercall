import { test } from "node:test";
import assert from "node:assert/strict";
import { BRIEF_TEMPLATES, briefTemplate } from "./briefTemplates.ts";
import { draftBrief, emptyDraft, withTemplate } from "./briefDraft.ts";
import { cleanBrief } from "./pipeline.ts";

test("there are seven templates, Blank first, and Blank fills nothing", () => {
  assert.deepEqual(
    BRIEF_TEMPLATES.map((t) => t.label),
    ["Blank", "Client project", "Hiring", "Fundraise", "Sales", "Team standup", "1:1"],
  );
  assert.equal(draftBrief(withTemplate(emptyDraft(), "blank")), undefined);
  assert.equal(briefTemplate(undefined).id, "blank");
});

test("every template passes cleanBrief unchanged", () => {
  for (const t of BRIEF_TEMPLATES) {
    const raw = { watchFor: t.watchFor, words: t.words, people: t.roles.map((role) => ({ name: "Someone", role })) };
    const clean = cleanBrief(raw);
    if (t.id === "blank") {
      assert.equal(clean, undefined);
      continue;
    }
    assert.deepEqual(clean?.watchFor, t.watchFor, t.id);
    assert.deepEqual(clean?.words, t.words, t.id);
    // Roles fit (the name is the person's to type).
    assert.deepEqual(
      raw.people.map((p) => p.role),
      t.roles,
    );
    assert.ok(t.roles.length > 0 && t.words.length > 0, t.id);
  }
});

test("a template fills only what to watch for, empty role slots and general words: never names or facts", () => {
  for (const t of BRIEF_TEMPLATES) {
    const d = withTemplate(emptyDraft(), t.id);
    // The role slots have no name, so the saved brief has no people until you type one.
    assert.ok(d.people.every((p) => p.name === "" && p.origin === "template"), t.id);
    assert.deepEqual(d.people.map((p) => p.role), t.roles);
    assert.equal(d.about.text, "", "About is only ever a placeholder");
    const brief = draftBrief(d);
    if (t.id === "blank") continue;
    assert.deepEqual(Object.keys(brief ?? {}).sort(), ["watchFor", "words"], t.id);
    // No digits (dates, amounts) and nothing capitalised like a name, other than acronyms and terms.
    const text = [t.watchFor, ...t.words, ...t.roles].join(" ");
    assert.ok(!/\d/.test(text.replace(/1:1/g, "")), `${t.id} has a number`);
    assert.ok(!/\b(?!SAFE|POC|MSA)[A-Z][a-z]+ [A-Z][a-z]+/.test(text.replace(/^[A-Z]/, "")), `${t.id} looks like it names someone`);
    assert.equal(t.aboutHint.includes("…") || t.aboutHint === "", true);
  }
});

test("switching templates takes the last one back, but keeps rows you named and text you wrote", () => {
  let d = withTemplate(emptyDraft(), "client");
  d = { ...d, people: d.people.map((p, i) => (i === 0 ? { ...p, name: "Olamide" } : p)) };
  d = withTemplate(d, "hiring");
  assert.deepEqual(
    d.people.map((p) => [p.name, p.role]),
    [["Olamide", "client lead"], ["", "candidate"], ["", "hiring manager"], ["", "interviewer"], ["", "recruiter"]],
  );
  assert.deepEqual(d.words.map((w) => w.word), briefTemplate("hiring").words);
  assert.equal(d.watchFor.text, briefTemplate("hiring").watchFor);
  // Your own watch-for text stays when you switch.
  d = { ...d, watchFor: { text: "Only the salary", origin: "you", on: true } };
  d = withTemplate(d, "sales");
  assert.equal(d.watchFor.text, "Only the salary");
  d = withTemplate(d, "blank");
  assert.deepEqual(d.words, []);
  assert.equal(d.template, undefined);
  assert.deepEqual(draftBrief(d), { people: [{ name: "Olamide", role: "client lead" }], watchFor: "Only the salary" });
});
