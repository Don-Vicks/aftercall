import { useEffect, useRef, useState, type ReactNode } from "react";
import { Search as SearchIcon } from "lucide-react";
import { formatClock, search, type Hit, type Meeting } from "@aftercall/core";
import { SectionLabel, cx } from "./ui";

/** Search all meetings on this Mac. Nothing is sent anywhere. */
export function SearchScreen({ meetings, onOpen }: { meetings: Meeting[]; onOpen: (meetingId: string, at?: number) => void }) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const r = search(meetings, query);
  const total = r.decisions.length + r.actions.length + r.transcript.length;

  return (
    <main className="min-w-0 flex-1 overflow-y-auto border-l border-hairline bg-raised">
      <div data-tauri-drag-region className="sticky top-0 z-10 h-9 bg-raised" />
      <div className="mx-auto flex max-w-[760px] flex-col gap-8 px-12 pb-16">
        <label className="flex h-12 items-center gap-3 rounded-md border border-border bg-well px-4 focus-within:border-verdigris">
          <SearchIcon size={18} strokeWidth={1.5} className="text-muted" aria-hidden="true" />
          <span className="sr-only">Search all meetings</span>
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all meetings"
            className="selectable flex-1 border-0 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted"
          />
          <span className="font-mono text-xs text-muted">⌘K</span>
        </label>

        {query.trim().length >= 2 && (
          <p className="-mt-4 m-0 flex justify-between text-muted">
            <span>
              {total} {total === 1 ? "result" : "results"} in {r.meetings} {r.meetings === 1 ? "meeting" : "meetings"}
            </span>
            <span>Searched on this Mac; nothing left your device</span>
          </p>
        )}

        <Group label="Decisions" hits={r.decisions} render={(h) => h.kind === "decision" && <Row title={<Marked text={h.text} query={query} />} meta={`${h.project} · ${h.meeting}`} onClick={() => onOpen(h.meetingId)} />} />
        <Group
          label="Action items"
          hits={r.actions}
          render={(h) => h.kind === "action" && <Row title={<Marked text={h.text} query={query} />} meta={`${h.owner} · ${h.done ? "done" : "open"} · ${h.project} · ${h.meeting}`} onClick={() => onOpen(h.meetingId)} />}
        />
        <Group
          label="In transcripts"
          hits={r.transcript}
          render={(h) =>
            h.kind === "transcript" && (
              <button onClick={() => onOpen(h.meetingId, h.at)} className="grid w-full grid-cols-[56px_minmax(0,1fr)] gap-4 py-3 text-left hover:text-ink">
                <span className="font-mono text-xs leading-6 text-muted">{formatClock(h.at)}</span>
                <span className="flex flex-col gap-0.5">
                  <span className="font-serif text-[16px] leading-6">
                    <span className={cx("t-label mr-2 font-sans", h.speaker === "you" ? "text-verdigris" : "text-muted")}>{h.speaker === "you" ? "You" : "Others"}</span>
                    <Marked text={h.snippet} query={query} />
                  </span>
                  <span className="text-muted">{h.meeting}</span>
                </span>
              </button>
            )
          }
        />
        {query.trim().length >= 2 && total === 0 && <p className="m-0 text-muted">Nothing matches “{query}”.</p>}
      </div>
    </main>
  );
}

function Group({ label, hits, render }: { label: string; hits: Hit[]; render: (h: Hit) => ReactNode }) {
  if (hits.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      <SectionLabel>
        {label} · {hits.length}
      </SectionLabel>
      <div className="flex flex-col divide-y divide-hairline">
        {hits.slice(0, 30).map((h, i) => (
          <div key={i}>{render(h)}</div>
        ))}
      </div>
    </section>
  );
}

/** The text with each match of the query marked, so you can see why a result came up. */
function Marked({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, from)) {
    parts.push(text.slice(from, i), <mark key={i} className="rounded-[2px] bg-caution-tint text-ink">{text.slice(i, i + q.length)}</mark>);
    from = i + q.length;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

function Row({ title, meta, onClick }: { title: ReactNode; meta: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full flex-col gap-0.5 py-3 text-left hover:text-ink">
      <span className="text-[15px] leading-5">{title}</span>
      <span className="text-muted">{meta}</span>
    </button>
  );
}
