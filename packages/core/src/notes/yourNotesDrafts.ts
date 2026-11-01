/**
 * Your notes typed on a recording's page after the call, by recording. Each edit is
 * saved a moment after you stop typing, one save at a time per recording. Make notes
 * reads them through `forRun`, which saves anything still waiting first, so the text
 * the model gets, the proof's salted hash and the saved your-notes file are the same.
 */
export class YourNotesDrafts {
  private readonly edited = new Map<string, string>();
  /** Recordings whose latest text isn't saved yet (waiting, or its save failed). */
  private readonly dirty = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly waiters = new Map<string, { resolve: () => void; reject: (e: unknown) => void }[]>();
  private readonly saving = new Map<string, Promise<void>>();

  private readonly save: (id: string, text: string) => Promise<void>;
  private readonly delayMs: number;

  constructor(save: (id: string, text: string) => Promise<void>, delayMs = 600) {
    this.save = save;
    this.delayMs = delayMs;
  }

  /** What you last typed here for this recording, if anything. */
  get(id: string): string | undefined {
    return this.edited.get(id);
  }

  /** Keeps an edit and saves it after the delay. Settles when a save holding it ends. */
  edit(id: string, text: string): Promise<void> {
    this.edited.set(id, text);
    this.dirty.add(id);
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => void this.flush(id).catch(() => {}), this.delayMs));
    return new Promise((resolve, reject) => this.waiters.set(id, [...(this.waiters.get(id) ?? []), { resolve, reject }]));
  }

  /** Saves the latest text now if it isn't saved yet. Rejects when that save fails. */
  flush(id: string): Promise<void> {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    if (this.dirty.has(id)) {
      this.dirty.delete(id);
      const text = this.edited.get(id) ?? "";
      const waiting = this.waiters.get(id) ?? [];
      this.waiters.delete(id);
      // After the save before it, so an older text never lands last.
      const run = (this.saving.get(id) ?? Promise.resolve()).catch(() => {}).then(() => this.save(id, text));
      this.saving.set(id, run);
      run.then(
        () => waiting.forEach((w) => w.resolve()),
        (e) => {
          // Not on disk: the next flush tries again.
          if (this.edited.get(id) === text) this.dirty.add(id);
          waiting.forEach((w) => w.reject(e));
        },
      );
    }
    return this.saving.get(id) ?? Promise.resolve();
  }

  /**
   * The notes to process: anything still waiting is saved first (this rejects if it
   * can't be), then the text you typed here, or `saved` when you typed nothing here.
   */
  async forRun(id: string, saved: string | undefined): Promise<string | undefined> {
    await this.flush(id);
    return this.edited.has(id) ? this.edited.get(id) : saved;
  }
}
