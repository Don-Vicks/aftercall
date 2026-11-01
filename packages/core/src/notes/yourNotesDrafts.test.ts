import { test } from "node:test";
import assert from "node:assert/strict";
import { YourNotesDrafts } from "./yourNotesDrafts.ts";

/** A save that records what reached "disk", and can be told to fail or wait. */
function fakeDisk() {
  const disk = new Map<string, string>();
  const writes: string[] = [];
  const ctl = { fail: false, gate: null as Promise<void> | null };
  const save = async (id: string, text: string) => {
    writes.push(text);
    if (ctl.gate) await ctl.gate;
    if (ctl.fail) throw new Error("disk full");
    disk.set(id, text);
  };
  return { disk, writes, ctl, save };
}

test("Make notes right after typing gets the latest text, saved first, not the stale one", async () => {
  const d = fakeDisk();
  const drafts = new YourNotesDrafts(d.save, 60_000);
  void drafts.edit("r1", "Push for the pilot");
  void drafts.edit("r1", "Push for the pilot, and the 40 USDC deposit");
  assert.equal(d.writes.length, 0, "still waiting out the delay");
  // The recording list still has what was saved at launch.
  const text = await drafts.forRun("r1", "old notes from disk");
  assert.equal(text, "Push for the pilot, and the 40 USDC deposit");
  assert.equal(d.disk.get("r1"), text, "the file holds exactly what the model gets");
  assert.deepEqual(d.writes, [text], "one save, of the latest text");
});

test("with nothing typed here, the saved notes are used and nothing is written", async () => {
  const d = fakeDisk();
  const drafts = new YourNotesDrafts(d.save, 60_000);
  assert.equal(await drafts.forRun("r1", "from the call"), "from the call");
  assert.equal(await drafts.forRun("r2", undefined), undefined);
  assert.equal(d.writes.length, 0);
});

test("clearing your notes here sends none, and saves the empty text", async () => {
  const d = fakeDisk();
  const drafts = new YourNotesDrafts(d.save, 60_000);
  void drafts.edit("r1", "");
  assert.equal(await drafts.forRun("r1", "from the call"), "");
  assert.equal(d.disk.get("r1"), "");
});

test("a save that fails stops the run, and the next try saves again", async () => {
  const d = fakeDisk();
  const drafts = new YourNotesDrafts(d.save, 60_000);
  const edit = drafts.edit("r1", "deposit is 40");
  d.ctl.fail = true;
  await assert.rejects(drafts.forRun("r1", undefined), /disk full/);
  await assert.rejects(edit, /disk full/, "the page shows the error");
  d.ctl.fail = false;
  assert.equal(await drafts.forRun("r1", undefined), "deposit is 40");
  assert.equal(d.disk.get("r1"), "deposit is 40");
});

test("saves run one at a time, so an older text never lands after a newer one", async () => {
  const d = fakeDisk();
  const drafts = new YourNotesDrafts(d.save, 60_000);
  let open!: () => void;
  d.ctl.gate = new Promise((r) => (open = r));
  void drafts.edit("r1", "first");
  const first = drafts.flush("r1");
  void drafts.edit("r1", "second");
  const run = drafts.forRun("r1", undefined);
  d.ctl.gate = null;
  open();
  await first;
  assert.equal(await run, "second");
  assert.equal(d.disk.get("r1"), "second");
  assert.deepEqual(d.writes, ["first", "second"]);
});

test("the delay saves by itself, and an edit's promise settles once it's on disk", async () => {
  const d = fakeDisk();
  const drafts = new YourNotesDrafts(d.save, 5);
  await drafts.edit("r1", "typed");
  assert.equal(d.disk.get("r1"), "typed");
  assert.equal(drafts.get("r1"), "typed");
});
