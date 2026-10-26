import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Meeting } from "@aftercall/core";

/** A temp data dir laid out like the app's: projects.json and two processed meetings, one unprocessed. */
export async function makeDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aftercall-mcp-"));
  await writeFile(join(dir, "projects.json"), JSON.stringify([{ id: "general", name: "General" }, { id: "fundraise-k3x", name: "Fundraise" }]));

  const ada: Meeting = {
    id: "1761000000",
    project: "Fundraise",
    title: "Sync with Ada",
    startedAt: "2026-10-21T10:00:00.000Z",
    durationSec: 754,
    verified: true,
    summary: "Ada will send the term sheet; we agreed on a pilot.",
    decisions: ["Run a two-week pilot with Ada's team"],
    actionItems: [
      { id: "a1", text: "Send Ada the pilot plan", owner: "You", due: "Friday", done: false },
      { id: "a2", text: "Share the term sheet", owner: "Ada", done: false },
      { id: "a3", text: "Book the follow-up call", owner: "You", done: true },
    ],
    followUps: [
      { id: "f1", kind: "email", status: "proposed", evidence: { quote: "send me a recap", at: 600 }, to: "", toName: "Ada", subject: "Pilot recap" },
      {
        id: "f2",
        kind: "payment",
        status: "paid",
        evidence: { quote: "I'll pay you twelve fifty for the design", at: 640 },
        payeeName: "Ada",
        payeeAccount: "ada.testnet",
        amount: { $bigint: "12500000" } as unknown as bigint,
        heard: "twelve fifty",
        payeeListed: true,
        doneAt: "10:15",
      },
    ],
    transcript: [
      { at: 12, speaker: "you", text: "Thanks for making time for the pilot today" },
      { at: 600, speaker: "others", text: "Please send me a recap of the pilot plan" },
    ],
  };
  const standup: Meeting = {
    ...ada,
    id: "1761100000",
    project: "General",
    title: "Team standup",
    startedAt: "2026-10-22T09:00:00.000Z",
    summary: "Release on Thursday.",
    decisions: ["Ship the release on Thursday"],
    actionItems: [{ id: "a1", text: "Write the release notes", owner: "Sam", done: false }],
    followUps: [],
    transcript: [{ at: 5, speaker: "others", text: "The release goes out Thursday" }],
  };

  for (const m of [ada, standup]) {
    const rec = join(dir, "recordings", m.id);
    await mkdir(rec, { recursive: true });
    await writeFile(join(rec, "meeting.json"), JSON.stringify({ id: m.id, project: m.project, startedAt: Number(m.id), seconds: m.durationSec, chunks: 1, dir: rec }));
    await writeFile(join(rec, "notes.json"), JSON.stringify({ meeting: m, processedAt: m.startedAt, notes: { summary: m.summary }, proof: { notesHash: "abc" } }, null, 2));
  }
  // Recorded but not processed yet: no notes.json.
  const pending = join(dir, "recordings", "1761200000");
  await mkdir(pending, { recursive: true });
  await writeFile(join(pending, "meeting.json"), JSON.stringify({ id: "1761200000", project: "General", startedAt: 1761200000, seconds: 30, chunks: 1, dir: pending }));
  return dir;
}
