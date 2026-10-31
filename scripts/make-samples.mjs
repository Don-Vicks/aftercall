#!/usr/bin/env node
// Builds the fictional sample recordings in samples/ (pnpm samples:make, macOS only).
//
// Every person, company and amount here is made up. Each call becomes two stems,
// exactly like a real Aftercall recording (apps/desktop/src-tauri/src/recorder.rs):
//   mic-000.wav     "You", the person who recorded the call
//   system-000.wav  everyone else on the call
// both 16 kHz, mono, 16-bit PCM WAV. Each line is spoken with macOS `say` in its
// speaker's voice and placed at its timestamp on its stem, with silence elsewhere,
// so Whisper hears the two sides apart just as it does on a real call.
//
// Also writes, per sample:
//   meeting.json  the recorder's metadata file, with a "Sample" label (the app fills in id, time, folder)
//   script.json   the exact lines and timestamps, so you can compare the notes against what was said

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 16_000;
const FIRST_LINE_AT = 1.0; // seconds
const GAP = 0.6; // seconds of silence between turns
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "samples");

const YOU = { name: "You", voice: "Samantha", stem: "mic" };

export const SAMPLES = [
  {
    id: "designer-kickoff",
    title: "Kickoff with Ines, freelance designer",
    project: "Sample: Moonbeam Bikes website",
    payees: [{ name: "Designer", account: "designer.near" }],
    vocabulary: ["Ines", "Paper Kite Studio", "Moonbeam Bikes", "Tobias", "Designer"],
    speakers: { you: YOU, ines: { name: "Ines Varga (Paper Kite Studio)", voice: "Moira", stem: "system" } },
    lines: [
      ["ines", "Hi, thanks for having me. I'm Ines from Paper Kite Studio, and I'll be your designer for the new shop website."],
      ["you", "Great to meet you, Ines. We run Moonbeam Bikes, a small repair shop, and our site hasn't changed in six years."],
      ["ines", "I had a look. I'd start with the home page and the booking page, then do the rest once you're happy with the style."],
      ["you", "That works. Let's agree the home page and the booking page come first, and the rest waits for phase two."],
      ["ines", "Perfect. I'll send you three style directions by Friday, and a first home page draft the week after."],
      ["you", "Lovely. I'll share our logo files and the workshop photos by Wednesday."],
      ["ines", "And for the deposit, forty dollars is enough to book the slot."],
      ["you", "Sure. I'll send the 40 dollar deposit to the designer today, and the rest when the home page is signed off."],
      ["ines", "Thanks. Last thing, who approves the designs on your side?"],
      ["you", "I do, and my business partner Tobias sees the final draft. I'll email you a short recap after this call."],
      ["ines", "Great. Talk Friday, bye for now."],
    ],
  },
  {
    id: "team-checkin",
    title: "Weekly check-in, Lantern Loop app team",
    project: "Sample: Lantern Loop launch",
    payees: [],
    vocabulary: ["Theo", "Mara", "Lantern Loop", "CSV"],
    speakers: {
      you: YOU,
      theo: { name: "Theo (engineer)", voice: "Daniel", stem: "system" },
      mara: { name: "Mara (marketing)", voice: "Karen", stem: "system" },
    },
    lines: [
      ["you", "Morning both. Quick weekly check-in. Theo, how is the export bug looking?"],
      ["theo", "I found it. The CSV export breaks on dates before the year two thousand. I'll have the fix merged by Thursday."],
      ["you", "Nice work. Can you also add a test for old dates, so it doesn't come back?"],
      ["theo", "Yes, the test goes in with the same fix."],
      ["you", "Great. Mara, where are we on the onboarding emails?"],
      ["mara", "The drafts are done. I need the final pricing before I can send them for review."],
      ["you", "Let's decide that now. We keep the price at nine dollars a month for the launch."],
      ["mara", "Okay. Then I'll send the onboarding emails for review by Tuesday."],
      ["theo", "One more thing. With the fix landing Thursday, should we still launch on the twelfth?"],
      ["you", "No, let's move the launch to the eighteenth, so we get a full week of testing."],
      ["mara", "Agreed. I'll update the launch checklist today."],
      ["you", "Perfect. I'll send the recap to both of you after this call. Thanks, everyone."],
    ],
  },
];

/** The PCM samples of a 16-bit mono WAV (finds the "data" chunk; `say` adds others). */
function readPcm(file) {
  const buf = readFileSync(file);
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "data") return new Int16Array(buf.buffer.slice(buf.byteOffset + off + 8, buf.byteOffset + off + 8 + size));
    off += 8 + size + (size % 2);
  }
  throw new Error(`no audio in ${file}`);
}

/** A canonical 44-byte-header WAV, as hound writes it in the recorder. */
function wav(samples) {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function speak(text, voice, tmp, n) {
  const out = join(tmp, `${n}.wav`);
  execFileSync("say", ["-v", voice, "-r", "175", "--file-format=WAVE", `--data-format=LEI16@${RATE}`, "-o", out, text]);
  return readPcm(out);
}

function build(sample) {
  const tmp = mkdtempSync(join(tmpdir(), "aftercall-sample-"));
  try {
    let t = FIRST_LINE_AT;
    const placed = sample.lines.map(([who, text], n) => {
      const speaker = sample.speakers[who];
      const pcm = speak(text, speaker.voice, tmp, n);
      const line = { at: Math.round(t * 10) / 10, speaker: speaker.stem === "mic" ? "you" : "others", name: speaker.name, voice: speaker.voice, text, pcm, stem: speaker.stem };
      t += pcm.length / RATE + GAP;
      return line;
    });
    const seconds = Math.ceil(t);
    const stems = {};
    for (const stem of ["mic", "system"]) {
      const mine = placed.filter((l) => l.stem === stem);
      // Each stem ends after its last line, as if the speaker went quiet; timestamps still line up.
      const last = mine[mine.length - 1];
      const length = Math.ceil((last.at + last.pcm.length / RATE + 0.5) * RATE);
      const out = new Int16Array(length);
      for (const l of mine) out.set(l.pcm, Math.round(l.at * RATE));
      stems[stem] = out;
    }

    const dir = join(ROOT, sample.id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "mic-000.wav"), wav(stems.mic));
    writeFileSync(join(dir, "system-000.wav"), wav(stems.system));
    // Same fields as the recorder's meeting.json (lib.rs MeetingMeta). id, startedAt and dir
    // are filled in when the app copies the sample into its recordings folder.
    const meeting = { id: "", project: sample.project, startedAt: 0, seconds, chunks: 1, dir: "", label: "Sample", title: sample.title };
    writeFileSync(join(dir, "meeting.json"), `${JSON.stringify(meeting, null, 2)}\n`);
    const script = {
      id: sample.id,
      title: sample.title,
      fictional: "Every person, company and amount in this call is made up. Voices are macOS text-to-speech.",
      seconds,
      payees: sample.payees,
      vocabulary: sample.vocabulary,
      lines: placed.map(({ at, speaker, name, voice, text }) => ({ at, speaker, name, voice, text })),
    };
    writeFileSync(join(dir, "script.json"), `${JSON.stringify(script, null, 2)}\n`);
    console.log(`${sample.id}: ${seconds} s, mic ${(stems.mic.length / RATE).toFixed(1)} s, system ${(stems.system.length / RATE).toFixed(1)} s`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.platform !== "darwin") {
  console.error("make-samples needs macOS (it uses `say`). The generated samples are already in samples/.");
  process.exit(1);
}
for (const s of SAMPLES) build(s);
