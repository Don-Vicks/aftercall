import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Flag, Lock, Search as SearchIcon } from "lucide-react";
import { formatClock, search, type Hit, type Meeting } from "@aftercall/core";
import { Avatar, SectionTitle } from "./ui";
import { Marked } from "./CommandPalette";
import { CheckCircle, EmptyCircle } from "./primitives/Check";

const rise = (i: number): CSSProperties => ({ animation: `ac-in 320ms var(--ease) ${i * 40}ms both` });

/** Every result for a search across all meetings on this Mac. Nothing is sent anywhere. ⌘Enter in the ⌘K palette opens it. */
export function SearchScreen({ meetings, initialQuery = "", onOpen }: { meetings: Meeting[]; initialQuery?: string; onOpen: (meetingId: string, at?: number) => void }) {
  const [query, setQuery] = useState(initialQuery);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const r = search(meetings, query);
  const total = r.decisions.length + r.actions.length + r.transcript.length;
  const typed = query.trim().length >= 2;

  return (
    <main className="min-w-0 flex-1 overflow-y-auto border-l border-hairline bg-raised">
      <div data-tauri-drag-region className="sticky top-0 z-10 h-9 bg-raised" />
      <div className="mx-auto flex max-w-[760px] flex-col gap-8 px-12 pt-5 pb-[72px]">
        <header className="flex flex-col gap-1.5" style={rise(0)}>
          <span className="t-eyebrow flex items-center gap-1.5 text-muted">
            <Lock size={12} strokeWidth={2} aria-hidden="true" /> Searched on this Mac; nothing leaves it
          </span>
          <h1 className="t-display m-0">Search</h1>
        </header>

        <label className="flex h-12 items-center gap-3 rounded-md border border-border bg-well px-4 focus-within:border-verdigris focus-within:shadow-[0_0_0_1px_var(--verdigris)]" style={rise(1)}>
          <SearchIcon size={18} strokeWidth={1.75} className="text-muted" aria-hidden="true" />
          <span className="sr-only">Search all meetings</span>
          <input
            ref={input}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all meetings"
            className="selectable min-w-0 flex-1 border-0 bg-transparent text-[16px] text-ink outline-none placeholder:text-muted"
          />
        </label>

        {typed && (
          <p className="-mt-4 m-0 text-[13px] text-muted" aria-live="polite">
            {total} {total === 1 ? "result" : "results"} in {r.meetings} {r.meetings === 1 ? "meeting" : "meetings"}
          </p>
        )}

        <Group label="Decisions" hits={r.decisions} query={query} onOpen={onOpen} />
        <Group label="Action items" hits={r.actions} query={query} onOpen={onOpen} />
        <Group label="In transcripts" hits={r.transcript} query={query} onOpen={onOpen} />
        {typed && total === 0 && <p className="m-0 text-ink-2">Nothing matches “{query.trim()}”.</p>}
        {!typed && <p className="m-0 text-ink-2">Type two or more letters to search decisions, action items and what was said.</p>}
      </div>
    </main>
  );
}

function Group({ label, hits, query, onOpen }: { label: string; hits: Hit[]; query: string; onOpen: (meetingId: string, at?: number) => void }) {
  if (hits.length === 0) return null;
  return (
    <section className="flex flex-col gap-1.5">
      <SectionTitle className="mb-1.5" count={hits.length}>
        {label}
      </SectionTitle>
      {hits.slice(0, 30).map((h, i) => (
        <Row key={i} hit={h} query={query} onOpen={onOpen} />
      ))}
    </section>
  );
}

function Row({ hit: h, query, onOpen }: { hit: Hit; query: string; onOpen: (meetingId: string, at?: number) => void }) {
  let lead: ReactNode;
  let body: ReactNode;
  let meta: string;
  if (h.kind === "transcript") {
    lead = <span className="w-11 shrink-0 font-mono text-xs leading-6 text-muted">{formatClock(h.at)}</span>;
    body = (
      <span className="font-serif text-base leading-6 text-ink">
        “<Marked text={h.snippet} query={query} />”
      </span>
    );
    meta = `${h.speaker === "you" ? "You" : "Them"} · ${h.project} · ${h.meeting}`;
  } else if (h.kind === "action") {
    lead = <span className="mt-0.5 inline-flex w-11 shrink-0">{h.done ? <CheckCircle size={20} play={false} /> : <EmptyCircle size={20} />}</span>;
    body = (
      <span className="text-[15px] leading-6">
        <Marked text={h.text} query={query} />
      </span>
    );
    meta = `${h.owner} · ${h.done ? "done" : "open"} · ${h.project} · ${h.meeting}`;
  } else {
    lead = (
      <span className="mt-1 inline-flex w-11 shrink-0 text-ink-2">
        <Flag size={16} strokeWidth={1.75} aria-hidden="true" />
      </span>
    );
    body = (
      <span className="text-[15px] leading-6">
        <Marked text={h.text} query={query} />
      </span>
    );
    meta = `${h.project} · ${h.meeting}`;
  }
  return (
    <button onClick={() => onOpen(h.meetingId, h.kind === "transcript" ? h.at : undefined)} className="-mx-3 flex items-start gap-3 rounded-[10px] px-3 py-2.5 text-left hover:bg-elevated">
      {lead}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {body}
        <span className="truncate text-[13px] text-muted">{meta}</span>
      </span>
      {h.kind === "action" && <Avatar name={h.owner} size={22} decorative />}
      {h.kind === "transcript" && h.speaker === "you" && <Avatar name="You" you size={22} decorative />}
    </button>
  );
}
