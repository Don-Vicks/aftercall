import { useId, useState, type CSSProperties, type KeyboardEvent } from "react";
import { FolderCode, RefreshCw } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { briefFromGithub, draftBrief, draftFromBrief, emptyDraft, refreshDraft, seenFrom, type ActionItem, type BriefDraft, type BriefSource, type Meeting, type ProjectBrief } from "@aftercall/core";
import type { SavedRecording } from "./recorder";
import type { Project } from "./projects";
import { MeetingRow, meetingRow, shortWhen } from "./MeetingRow";
import { BriefPrivacy, BriefReview } from "./BriefReview";
import { githubApi } from "./github";
import { isDesktop } from "./recorder";
import { Avatar, Button, Card, SectionTitle, Strike, Tick, cx, toast, useIsYou } from "./ui";

const rise = (i: number): CSSProperties => ({ animation: `ac-in 320ms var(--ease) ${i * 40}ms both` });
const SHOWN = 5;

/** "today", or "since 28 Oct". */
const sinceLabel = (unix: number) => (new Date(unix * 1000).toDateString() === new Date().toDateString() ? "today" : `since ${shortWhen(unix)}`);

/**
 * A project at a glance: what's still open across its meetings, the meetings
 * themselves, and the people in them.
 */
export function ProjectScreen({
  project,
  recordings,
  meetings,
  account,
  onToggleItem,
  onOpenMeeting,
  onRecord,
  onRename,
  onSaveBrief,
  onSaveCodeFolder,
  payees = [],
}: {
  project: Project;
  /** This project's recordings, newest first. */
  recordings: SavedRecording[];
  /** Meetings with notes, by recording id. */
  meetings: Record<string, Meeting>;
  account: string | null;
  onToggleItem: (meetingId: string, itemId: string) => void;
  onOpenMeeting: (id: string) => void;
  /** Opens the record sheet with this project picked. */
  onRecord: () => void;
  onRename: () => void;
  /** Saves the project's brief (undefined clears it) and where it came from (undefined keeps it, null drops it). */
  onSaveBrief: (brief: ProjectBrief | undefined, source?: BriefSource | null) => Promise<void>;
  /** Saves the project's code folder; undefined clears it. */
  onSaveCodeFolder: (folder: string | undefined) => Promise<void>;
  /** Payee names, for the preview of Whisper's spelling prompt. */
  payees?: string[];
}) {
  const [all, setAll] = useState(false);
  /** Items ticked on this page stay, struck through, until you leave it. */
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set());
  const sorted = [...recordings].sort((a, b) => b.startedAt - a.startedAt);
  const withNotes = sorted.filter((r) => meetings[r.id]);
  const since = sorted.length ? sorted[sorted.length - 1] : undefined;

  const listed = withNotes.flatMap((r) =>
    meetings[r.id].actionItems.filter((a) => !a.done || kept.has(`${r.id}:${a.id}`)).map((a) => ({ key: `${r.id}:${a.id}`, item: a, meeting: meetings[r.id], when: shortWhen(r.startedAt) })),
  );
  const open = listed.filter((o) => !o.item.done);
  const openMeetings = new Set(open.map((o) => o.meeting.id)).size;
  const rows = sorted.map((r) => meetingRow(r, meetings[r.id], { withProject: false, long: false }));

  // People: who the calendar says was invited, and the payees follow-ups named.
  const people = new Map<string, { name: string; detail: string; count: number }>();
  for (const r of withNotes) {
    const mt = meetings[r.id];
    for (const a of mt.invited ?? []) {
      const name = a.name || a.email;
      if (!name) continue;
      const p = people.get(name.toLowerCase()) ?? { name, detail: "", count: 0 };
      p.count++;
      people.set(name.toLowerCase(), p);
    }
    for (const f of mt.followUps) {
      if (f.kind !== "payment" || !f.payeeListed || people.has(f.payeeName.toLowerCase())) continue;
      people.set(f.payeeName.toLowerCase(), { name: f.payeeName, detail: "On your payee list", count: 0 });
    }
  }
  const others = [...people.values()].map((p) => ({ ...p, detail: p.detail || `${p.count} ${p.count === 1 ? "meeting" : "meetings"}` }));

  return (
    <main className="min-w-0 flex-1 overflow-y-auto border-l border-hairline bg-raised">
      <div data-tauri-drag-region className="sticky top-0 z-10 h-9 bg-raised" />
      <div className="mx-auto flex max-w-[760px] flex-col gap-10 px-12 pt-5 pb-[72px]">
        <header className="flex flex-wrap items-end justify-between gap-6" style={rise(0)}>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="t-eyebrow text-muted">
              Project · {sorted.length === 0 ? "no meetings yet" : `${sorted.length} ${sorted.length === 1 ? "meeting" : "meetings"} ${sinceLabel(since!.startedAt)}`}
            </span>
            <h1 className="t-display m-0 break-words">{project.name}</h1>
          </div>
          <div className="flex gap-2">
            <Button variant="quiet" onClick={onRename}>
              Rename
            </Button>
            <Button onClick={onRecord} icon={<span aria-hidden="true" className="size-2 rounded-full bg-record" />}>
              Record in {project.name}
            </Button>
          </div>
        </header>

        <BriefCard key={project.id} name={project.name} brief={project.brief} source={project.briefSource} payees={payees} onSave={onSaveBrief} style={rise(1)} />

        <CodeFolderCard name={project.name} folder={project.codeFolder} onSave={onSaveCodeFolder} style={rise(1)} />

        {sorted.length === 0 ? (
          <p className="m-0 text-ink-2" style={rise(2)}>
            Meetings you record in {project.name} show up here, with their open action items and the people in them.
          </p>
        ) : (
          <>
            <section aria-labelledby="h-open" className="flex flex-col gap-1.5" style={rise(2)}>
              <SectionTitle id="h-open" className="mb-1" count={open.length ? `${open.length} across ${openMeetings} ${openMeetings === 1 ? "meeting" : "meetings"}` : undefined}>
                Open action items
              </SectionTitle>
              {listed.length === 0 ? (
                <p className="m-0 text-ink-2">Nothing open. Action items from these meetings show up here until they’re done.</p>
              ) : (
                <div className="flex flex-col border-t border-hairline">
                  {listed.map((o) => (
                    <OpenItem
                      key={o.key}
                      item={o.item}
                      meeting={o.meeting}
                      when={o.when}
                      account={account}
                      onToggle={() => {
                        setKept((k) => new Set(k).add(o.key));
                        onToggleItem(o.meeting.id, o.item.id);
                      }}
                      onOpen={() => onOpenMeeting(o.meeting.id)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="h-meet" className="flex flex-col gap-1.5" style={rise(3)}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <SectionTitle id="h-meet" count={sorted.length}>
                  Meetings
                </SectionTitle>
                {rows.length > SHOWN && (
                  <button onClick={() => setAll((v) => !v)} className="text-[13px] font-semibold text-verdigris hover:text-verdigris-hover">
                    {all ? "Show fewer" : `Show all ${rows.length}`}
                  </button>
                )}
              </div>
              {(all ? rows : rows.slice(0, SHOWN)).map((row) => (
                <MeetingRow key={row.id} row={row} onOpen={onOpenMeeting} />
              ))}
            </section>

            {others.length > 0 && (
              <section aria-labelledby="h-people" className="flex flex-col gap-3.5" style={rise(4)}>
                <SectionTitle id="h-people" count={others.length + 1}>
                  People in this project
                </SectionTitle>
                <ul className="m-0 flex list-none flex-wrap gap-x-8 gap-y-4 p-0">
                  <Person name="You" detail={account ?? "This Mac"} mono={Boolean(account)} you />
                  {others.map((p) => (
                    <Person key={p.name} name={p.name} detail={p.detail} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function OpenItem({ item, meeting, when, account, onToggle, onOpen }: { item: ActionItem; meeting: Meeting; when: string; account: string | null; onToggle: () => void; onOpen: () => void }) {
  const id = useId();
  const isYou = useIsYou();
  const yours = isYou(item.owner) || (account !== null && item.owner === account);
  return (
    <div className="flex items-center gap-3 border-b border-hairline py-3">
      <Tick checked={item.done} onChange={onToggle} aria-labelledby={id} />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span id={id} className="text-[15px]">
          <Strike on={item.done}>{item.text}</Strike>
        </span>
        <span className="text-[13px]">
          {item.claimed && <span className="font-medium text-verdigris">{item.claimed.agent} is on it · </span>}
          <button onClick={onOpen} className="text-muted hover:text-ink">
            {meeting.title} · {when.replace(/^Today .*/, "today")}
          </button>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-[13px] text-ink-2">
        <Avatar name={item.owner} you={yours || undefined} size={26} decorative />
        <span>{item.due ?? (yours ? "You" : item.owner)}</span>
      </span>
    </div>
  );
}

function Person({ name, detail, mono, you }: { name: string; detail: string; mono?: boolean; you?: boolean }) {
  return (
    <li className="flex min-w-[150px] items-center gap-2.5">
      <Avatar name={name} you={you} size={34} decorative />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-semibold">{you ? "You" : name}</span>
        <span className={cx("truncate text-xs text-muted", mono && "font-mono")}>{detail}</span>
      </span>
    </li>
  );
}

/** "2 Nov", or "2 Nov 2025" in another year. */
const dayLabel = (unix: number) => {
  const d = new Date(unix * 1000);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });
};

/**
 * The project brief: what it's about, who's who, words to expect and what to watch for.
 * Read here, edited with the same review as New project. A brief filled from GitHub says
 * so, with Refresh: it looks the repo up again and shows only what changed there, keeping
 * what you edited. Everything about it stays on this Mac except what goes, encrypted,
 * with a meeting's notes request (and words to expect, with the audio).
 */
function BriefCard({
  name,
  brief,
  source,
  payees,
  onSave,
  style,
}: {
  name: string;
  brief?: ProjectBrief;
  source?: BriefSource;
  payees: string[];
  onSave: (b: ProjectBrief | undefined, source?: BriefSource | null) => Promise<void>;
  style?: CSSProperties;
}) {
  const [draft, setDraft] = useState<BriefDraft | null>(null);
  /** On Refresh: what changed, and the source to save with it. */
  const [refresh, setRefresh] = useState<{ changes: string[]; source: BriefSource } | null>(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const editing = draft !== null;
  const close = () => {
    setDraft(null);
    setRefresh(null);
  };
  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const next = draftBrief(draft);
      await onSave(next, next ? refresh?.source : null);
      close();
    } catch (e) {
      toast({ text: `Couldn't save the brief: ${e instanceof Error ? e.message : String(e)}`, tone: "record" });
    } finally {
      setSaving(false);
    }
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      void save();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  const lookAgain = async () => {
    if (!source || checking) return;
    setChecking(true);
    try {
      const fresh = briefFromGithub(await githubApi.repo(source.repo));
      const next: BriefSource = { ...source, fetchedAt: Math.floor(Date.now() / 1000), seen: seenFrom(fresh) };
      const r = refreshDraft(brief, source, fresh);
      if (r.changes.length === 0) {
        // Only the date changes; the brief itself is as it was.
        await onSave(brief, next);
        toast({ text: `Brief is up to date with ${source.repo}`, tone: "verdigris" });
      } else {
        setRefresh({ changes: r.changes, source: next });
        setDraft(r.draft);
      }
    } catch (e) {
      toast({ text: `Couldn't refresh from GitHub: ${e instanceof Error ? e.message : String(e)}`, tone: "record" });
    } finally {
      setChecking(false);
    }
  };
  // "With your edits": GitHub's About changed by you, or something GitHub suggested taken out. Additions aren't edits.
  const seen = source?.seen;
  const has = (list: string[] | undefined, v: string) => Boolean(list?.some((x) => x.toLowerCase() === v.toLowerCase()));
  const yours =
    Boolean(source && brief) &&
    ((Boolean(seen?.about) && brief?.about !== seen?.about) ||
      Boolean(seen?.people?.some((n) => !has(brief?.people?.map((p) => p.name), n))) ||
      Boolean(seen?.words?.some((w) => !has(brief?.words, w))));

  return (
    <section aria-labelledby="h-brief" style={style}>
      <Card pad="lg" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="flex min-w-0 flex-col gap-0.5">
            <SectionTitle id="h-brief">{refresh ? "Refresh from GitHub" : "Project brief"}</SectionTitle>
            {source && brief && (
              <span className="text-xs text-muted">
                Brief from <span className="font-mono">github.com/{source.repo}</span> · refreshed {dayLabel(source.fetchedAt)}
                {yours && " · with your edits"}
              </span>
            )}
          </div>
          {!editing && brief && (
            <span className="-my-1.5 -mr-2 flex gap-1">
              {source && (
                <Button variant="quiet" size="sm" loading={checking} icon={<RefreshCw size={13} />} onClick={lookAgain}>
                  Refresh
                </Button>
              )}
              <Button variant="quiet" size="sm" onClick={() => setDraft(draftFromBrief(brief, source))}>
                Edit
              </Button>
            </span>
          )}
        </div>
        {editing ? (
          <div className="flex flex-col gap-5" onKeyDown={onKeyDown}>
            <BriefReview draft={draft} onChange={setDraft} project={name} payees={payees} changes={refresh?.changes} autoFocus={!refresh} />
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button variant="primary" loading={saving} onClick={save}>
                Save brief
              </Button>
            </div>
          </div>
        ) : brief ? (
          <>
            <BriefView brief={brief} />
            <BriefPrivacy project={name} words={brief.words?.length ?? 0} />
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="m-0 max-w-[440px] text-ink-2">What {name} is about, who’s who and the words to expect. It helps the notes get names, terms and what matters right.</p>
            <Button onClick={() => setDraft(emptyDraft())}>Add a brief</Button>
          </div>
        )}
      </Card>
    </section>
  );
}

/**
 * The project's code folder: where "Open in Claude Code" on its action items starts
 * Claude Code, with Aftercall's MCP server. Chosen in the Mac's own folder picker.
 */
function CodeFolderCard({ name, folder, onSave, style }: { name: string; folder?: string; onSave: (folder: string | undefined) => Promise<void>; style?: CSSProperties }) {
  const [busy, setBusy] = useState(false);
  const save = async (next: string | undefined) => {
    setBusy(true);
    try {
      await onSave(next);
    } catch (e) {
      toast({ text: `Couldn't save the code folder: ${e instanceof Error ? e.message : String(e)}`, tone: "record" });
    } finally {
      setBusy(false);
    }
  };
  const choose = async () => {
    if (!isDesktop) return toast({ text: "Choosing a folder needs the Mac app." });
    const picked = await openDialog({ directory: true, multiple: false, defaultPath: folder, title: `Code folder for ${name}` }).catch(() => null);
    if (typeof picked === "string") await save(picked);
  };
  return (
    <section aria-labelledby="h-code" style={style}>
      <Card pad="md" className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <FolderCode size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-ink-2" />
        <span className="flex min-w-0 flex-[1_1_260px] flex-col gap-0.5">
          <SectionTitle id="h-code">Code folder</SectionTitle>
          {folder ? (
            <span className="t-mono selectable truncate text-[13px] text-ink" title={folder}>
              {folder}
            </span>
          ) : (
            <span className="text-[13px] leading-[19px] text-ink-2">
              Where Claude Code opens for {name}’s action items. Set one, and each open item gets Open in Claude Code. It stays on this Mac.
            </span>
          )}
        </span>
        <span className="-my-1 flex gap-1">
          {folder && (
            <Button variant="quiet" size="sm" disabled={busy} onClick={() => save(undefined)}>
              Clear
            </Button>
          )}
          <Button variant={folder ? "quiet" : "secondary"} size="sm" loading={busy} onClick={choose}>
            {folder ? "Change…" : "Choose folder…"}
          </Button>
        </span>
      </Card>
    </section>
  );
}

function BriefView({ brief }: { brief: ProjectBrief }) {
  const row = "grid grid-cols-[136px_minmax(0,1fr)] items-baseline gap-4 border-t border-hairline py-3 first:border-t-0 first:pt-0 last:pb-0";
  const label = "text-[13px] font-semibold text-ink-2";
  return (
    <div className="flex flex-col gap-4">
      {brief.about && <p className="t-reading selectable m-0 text-ink">{brief.about}</p>}
      {(brief.people?.length || brief.words?.length || brief.watchFor) && (
        <dl className="m-0 flex flex-col">
          {brief.people?.length ? (
            <div className={row}>
              <dt className={label}>People</dt>
              <dd className="m-0 flex flex-col gap-2">
                {brief.people.map((p) => (
                  <span key={p.name} className="flex min-w-0 items-center gap-2">
                    <Avatar name={p.name} size={22} decorative />
                    <span className="selectable min-w-0 truncate">
                      <span className="font-semibold">{p.name}</span>
                      {p.role && <span className="text-ink-2"> · {p.role}</span>}
                    </span>
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
          {brief.words?.length ? (
            <div className={row}>
              <dt className={label}>Words to expect</dt>
              <dd className="m-0 flex flex-wrap gap-1.5">
                {brief.words.map((w) => (
                  <span key={w} className="selectable rounded-full bg-well px-2.5 py-0.5 text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--hairline)]">
                    {w}
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
          {brief.watchFor ? (
            <div className={row}>
              <dt className={label}>What to watch for</dt>
              <dd className="selectable m-0 text-ink">{brief.watchFor}</dd>
            </div>
          ) : null}
        </dl>
      )}
    </div>
  );
}
