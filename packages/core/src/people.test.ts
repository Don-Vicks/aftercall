import { test } from "node:test";
import assert from "node:assert/strict";
import { PERSON_HUES, initials, isYou, othersOn, personHue, speakerLabel } from "./people.ts";

test("personHue is stable and ignores case, spacing and a company suffix", () => {
  const hue = personHue("Ines Rocha");
  assert.equal(personHue("Ines Rocha"), hue);
  assert.equal(personHue("  ines   ROCHA "), hue);
  assert.equal(personHue("Ines Rocha (Paper Kite Studio)"), hue);
});

test("personHue lands in 1..6 and uses every slot across a set of names", () => {
  const names = ["Ada", "Designer", "Ines Rocha", "Theo Moss", "Mara Kade", "Sam Obi", "Tobias", "Priya Nair", "Kwame Mensah", "Lena Fischer", "Omar Haddad", "Yuki Tanaka", "Chen Wei", "Zoë Martin", "José Álvarez", "Ngozi Okafor"];
  const seen = new Set<number>();
  for (const n of names) {
    const h = personHue(n);
    assert.ok(Number.isInteger(h) && h >= 1 && h <= PERSON_HUES, `${n} -> ${h}`);
    seen.add(h);
  }
  assert.equal(seen.size, PERSON_HUES);
});

test("personHue gives an email or NEAR account the same colour as the name before it", () => {
  assert.equal(personHue("designer.near"), personHue("designer"));
  assert.equal(personHue("ada@example.com"), personHue("Ada"));
});

test("initials: first and last word, one for a single word", () => {
  assert.equal(initials("Ines Rocha"), "IR");
  assert.equal(initials("Ada"), "A");
  assert.equal(initials("Mara de la Kade"), "MK");
  assert.equal(initials("ines varga (Paper Kite Studio)"), "IV");
  assert.equal(initials("Zoë Østergaard"), "ZØ");
});

test("initials: emails, NEAR accounts and empty names", () => {
  assert.equal(initials("designer.near"), "D");
  assert.equal(initials("ada.lovelace@example.com"), "AL");
  assert.equal(initials("sam-obi.testnet"), "SO");
  assert.equal(initials(""), "?");
  assert.equal(initials("  ()  "), "?");
});

test("isYou: the words the notes use for the person recording", () => {
  for (const o of ["You", "you", "YOU", "Me", "you (Victor)", "Victor (you)", " You. "]) assert.equal(isYou(o), true, o);
  for (const o of ["Ada", "Unassigned", "Your designer", "Others", ""]) assert.equal(isYou(o), false, o);
});

test("isYou: the user's own name, first name or NEAR account", () => {
  assert.equal(isYou("Victor", "Victor"), true);
  assert.equal(isYou("victor", ["Victor Shallangwa"]), true);
  assert.equal(isYou("Victor Shallangwa", "victor shallangwa"), true);
  assert.equal(isYou("Victor", "victor.near"), true);
  assert.equal(isYou("Victor", "victor@example.com"), true);
  assert.equal(isYou("Ada", ["Victor", "victor.near"]), false);
  assert.equal(isYou("Victor"), false);
});

test("speakerLabel names the other side only when exactly one other person was invited", () => {
  const ada = { name: "Ada Lovelace", email: "ada@example.com" };
  assert.equal(speakerLabel("you", [ada]), "You");
  assert.equal(speakerLabel("others", [ada]), "Ada Lovelace");
  assert.equal(speakerLabel("others", [{ name: "", email: "charles@example.com" }]), "charles@example.com");
  assert.equal(speakerLabel("others", []), "Others");
  assert.equal(speakerLabel("others"), "Others");
  assert.equal(speakerLabel("others", [ada, { name: "Theo Moss", email: "" }]), "Others", "two or more: never guess who spoke");
});

test("othersOn falls back to invited for notes saved before attendees existed", () => {
  const ada = { name: "Ada", email: "ada@example.com" };
  const theo = { name: "Theo", email: "" };
  assert.deepEqual(othersOn({ attendees: [ada, theo], invited: [ada] }), [ada, theo]);
  assert.deepEqual(othersOn({ invited: [ada] }), [ada]);
  assert.deepEqual(othersOn({}), []);
});
