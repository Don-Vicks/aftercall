import { Check, FolderOpen } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { formatDuration } from "@aftercall/core";
import type { SavedRecording } from "./recorder";
import { Button, Pill, cx } from "./ui";

export function recordingTitle(r: SavedRecording): string {
  const d = new Date(r.startedAt * 1000);
  return `Recording ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function recordingWhen(r: SavedRecording): string {
  const d = new Date(r.startedAt * 1000);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? "Today" : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

/**
 * A real recording before it has notes. It shows what is true now: the audio is
 * saved on this Mac. Transcription and the summary arrive with NEAR AI in M2.
 */
export function RecordingScreen({ recording }: { recording: SavedRecording }) {
  const stages = [
    {
      title: "Recorded on this Mac",
      detail: `${recording.chunks} ${recording.chunks === 1 ? "chunk" : "chunks"} · You (microphone) and Others (call audio) kept apart`,
      done: true,
    },
    { title: "Transcribe in NEAR AI secure hardware", detail: "Whisper, then the audio is deleted · arrives in M2", done: false },
    { title: "Write the notes", detail: "Decisions, action items and follow-ups, each with a quote · M2", done: false },
    { title: "Record the proof on NEAR", detail: "record_proof from your limited key · M3", done: false },
  ];

  return (
    <main className="min-w-0 flex-1 overflow-y-auto border-l border-hairline bg-raised">
      <div data-tauri-drag-region className="sticky top-0 z-10 h-9 bg-raised" />
      <div className="mx-auto flex max-w-[680px] flex-col gap-8 px-12 pb-16">
        <header className="flex flex-col gap-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="t-label text-muted">
              {recording.project} · {recordingWhen(recording)} · {formatDuration(recording.seconds)}
            </span>
            <Pill tone="muted">Waiting for notes</Pill>
          </div>
          <h1 className="t-display m-0">{recordingTitle(recording)}</h1>
          <p className="t-reading m-0 text-muted">
            Your audio is saved on this Mac. Notes appear here once transcription in NEAR AI is connected.
          </p>
        </header>

        <ol className="m-0 flex list-none flex-col p-0">
          {stages.map((s, i) => (
            <li
              key={s.title}
              className={cx("grid grid-cols-[28px_minmax(0,1fr)] items-baseline gap-3 border-t border-hairline py-3.5", i === stages.length - 1 && "border-b")}
            >
              <span className="self-center">
                {s.done ? (
                  <Check size={16} strokeWidth={1.75} className="text-verdigris" aria-label="Done" />
                ) : (
                  <span aria-hidden="true" className="block size-3.5 rounded-full border-[1.5px] border-faint" />
                )}
              </span>
              <div className="flex flex-col gap-0.5">
                <span className={cx("t-title", !s.done && "text-muted")}>{s.title}</span>
                <span className="text-muted">{s.detail}</span>
              </div>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="t-mono min-w-0 truncate text-muted" title={recording.dir}>
            {recording.dir}
          </span>
          <Button onClick={() => revealItemInDir(`${recording.dir}/mic-000.wav`)}>
            <FolderOpen size={14} strokeWidth={1.75} aria-hidden="true" />
            Show in Finder
          </Button>
        </div>
      </div>
    </main>
  );
}
