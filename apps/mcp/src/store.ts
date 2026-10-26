import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Meeting } from "@aftercall/core";

/**
 * Reads and writes the files the Aftercall app keeps on this Mac:
 *
 *   <data dir>/projects.json                  [{ id, name }]
 *   <data dir>/recordings/<id>/meeting.json   recording metadata
 *   <data dir>/recordings/<id>/notes.json     the processed meeting (once processed)
 *
 * Writes follow the same rules as the app (apps/desktop/src-tauri/src/notes_file.rs):
 * take `notes.json.lock`, re-read the file, change it, write a temp file and rename it
 * over the old one. A reader never sees half a file and two writers never lose each
 * other's change.
 */

/** Where the app keeps its data: Tauri's app data dir for `dev.aftercall.app`. */
export function defaultDataDir(): string {
  return process.env.AFTERCALL_DATA_DIR || join(homedir(), "Library", "Application Support", "dev.aftercall.app");
}

export interface Project {
  id: string;
  name: string;
}

/** notes.json as stored. USDC amounts are `{ "$bigint": "…" }`; other fields are kept as they are. */
export interface NotesFile {
  meeting: Meeting;
  processedAt?: string;
  /** Set once the proof is recorded on NEAR. */
  onChain?: { network: string; contract: string; owner: string; txHash: string; proofHash: string };
  [k: string]: unknown;
}

export interface StoredMeeting {
  id: string;
  notes: NotesFile;
}

const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 5_000;

/** Recording ids are the Unix second they started; anything else could point outside the folder. */
export function checkId(id: string): string {
  if (!/^\d{1,20}$/.test(id)) throw new Error(`No meeting with id "${id}"`);
  return id;
}

const recordingsDir = (dataDir: string) => join(dataDir, "recordings");
const notesPath = (dataDir: string, id: string) => join(recordingsDir(dataDir), checkId(id), "notes.json");

export async function readProjects(dataDir: string): Promise<Project[]> {
  try {
    return JSON.parse(await readFile(join(dataDir, "projects.json"), "utf8")) as Project[];
  } catch {
    return [{ id: "general", name: "General" }];
  }
}

/** Every processed meeting, newest first. Unprocessed or damaged recordings are skipped. */
export async function readMeetings(dataDir: string): Promise<StoredMeeting[]> {
  let ids: string[];
  try {
    ids = (await readdir(recordingsDir(dataDir))).filter((d) => /^\d+$/.test(d));
  } catch {
    return [];
  }
  const out: StoredMeeting[] = [];
  for (const id of ids) {
    const notes = await readNotes(dataDir, id).catch(() => null);
    if (notes?.meeting) out.push({ id, notes });
  }
  return out.sort((a, b) => Number(b.id) - Number(a.id));
}

export async function readNotes(dataDir: string, id: string): Promise<NotesFile> {
  return JSON.parse(await readFile(notesPath(dataDir, id), "utf8")) as NotesFile;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Holds `<file>.lock` while `fn` runs. A lock older than 10 s is left over from a crash and is taken over. */
export async function withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const h = await open(lock, "wx");
      await h.writeFile(`mcp ${process.pid}`);
      await h.close();
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const age = await stat(lock).then((s) => Date.now() - s.mtimeMs, () => 0);
      if (age > LOCK_STALE_MS) await rm(lock, { force: true });
      else if (Date.now() > deadline) throw new Error("The notes file is busy; try again in a moment");
      else await sleep(15 + Math.random() * 30);
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lock, { force: true });
  }
}

/** Writes a temp file next to `file`, then renames it over `file`. */
export async function writeAtomic(file: string, contents: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  await writeFile(tmp, contents);
  try {
    await rename(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/** Locks, re-reads notes.json, applies `change` and saves it. Returns the saved notes. */
export async function updateNotes(dataDir: string, id: string, change: (notes: NotesFile) => void): Promise<NotesFile> {
  const file = notesPath(dataDir, id);
  await mkdir(join(recordingsDir(dataDir), id), { recursive: true });
  return withLock(file, async () => {
    let notes: NotesFile;
    try {
      notes = JSON.parse(await readFile(file, "utf8")) as NotesFile;
    } catch {
      throw new Error(`No processed meeting with id "${id}"`);
    }
    change(notes);
    await writeAtomic(file, JSON.stringify(notes, null, 2));
    return notes;
  });
}
