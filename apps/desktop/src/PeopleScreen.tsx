import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { buildPeople, groupRows, openCount, relativeDay, weekGroup, type Meeting, type Person } from "@aftercall/core";
import { Avatar, Pill, TabPanel, Tabs } from "./ui";
import { Footnote, Page, PageHeader, SearchBox, rise } from "./PagePieces";
import { plural } from "./library";

type Tab = "recent" | "owe-you" | "you-owe";

/** "ada@example.com · from your calendar", "From what was said · designer.near is on your payees". */
export function personSource(p: Person): string {
  if (p.sources.includes("calendar")) return `${p.email || "No email"} · from your calendar`;
  const said = p.sources.includes("said") ? "From what was said" : "From your payments";
  if (p.account) return `${said} · ${p.account} is on your payees`;
  if (p.email) return `${p.email} · from a recap`;
  return `${said} · no email yet`;
}

/** "Met today" when the newest meeting invited them; "Named 29 Oct" when it only named them. */
export function lastSeen(p: Person, now: number): string {
  if (p.lastAt === null) return p.lastInvited ? "Met" : "Named";
  return `${p.lastInvited ? "Met" : "Named"} ${relativeDay(p.lastAt, now)}`;
}

/**
 * Everyone met through Aftercall: invited in the calendar, or named in the notes as
 * an owner, a recap's recipient or a payee. Worked out on this Mac from the meetings.
 */
export function PeopleScreen({
  meetings,
  me,
  sampleIds,
  onOpenPerson,
}: {
  meetings: Meeting[];
  me: readonly string[];
  /** Fictional meetings: someone only in those is labelled Sample. */
  sampleIds: ReadonlySet<string>;
  onOpenPerson: (id: string) => void;
}) {
  const [now] = useState(() => Date.now());
  const index = useMemo(() => buildPeople(meetings, { me, now }), [meetings, me, now]);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("recent");

  const q = query.trim().toLowerCase();
  const found = index.people.filter((p) => !q || [p.name, p.email, p.account].some((s) => s.toLowerCase().includes(q)));
  const oweYou = found.filter((p) => openCount(p.theyOwe) > 0).sort((a, b) => openCount(b.theyOwe) - openCount(a.theyOwe));
  const youOwe = found.filter((p) => openCount(p.youOwe) > 0).sort((a, b) => openCount(b.youOwe) - openCount(a.youOwe));
  const shown = tab === "recent" ? found : tab === "owe-you" ? oweYou : youOwe;
  const groups = tab === "recent" ? groupRows(shown, (p) => weekGroup(p.lastAt, now, { today: true })) : [{ group: { key: tab, title: tab === "owe-you" ? "Owe you" : "You owe" }, rows: shown }];

  return (
    <Page>
      <PageHeader
        eyebrow={index.people.length ? `${plural(index.people.length, "person", "people")} · names from your calendar and from what was said` : "Names from your calendar and from what was said"}
        title="People"
        intro="Everyone you've met through Aftercall, and what's still open between you."
      />

      {index.people.length === 0 ? (
        <section className="flex flex-col gap-3" style={rise(1)}>
          <p className="t-reading m-0 text-ink">No one yet.</p>
          <p className="m-0 max-w-[560px] text-ink-2">
            People appear after a meeting where your calendar invited them, or where the notes name them as an owner, a recap's recipient or a payee. Aftercall never recognises voices.
          </p>
        </section>
      ) : (
        <>
          <div className="flex flex-col gap-4" style={rise(1)}>
            <SearchBox label="Search people" placeholder="Search by name, email or account" value={query} onChange={setQuery} />
            <Tabs
              id="people"
              label="Sort people"
              value={tab}
              onChange={setTab}
              items={[
                { id: "recent", label: "Recently met" },
                { id: "owe-you", label: "Owe you", count: index.people.filter((p) => openCount(p.theyOwe) > 0).length },
                { id: "you-owe", label: "You owe", count: index.people.filter((p) => openCount(p.youOwe) > 0).length },
              ]}
            />
          </div>

          <TabPanel tabsId="people" value={tab} className="flex flex-col gap-7">
            {shown.length === 0 && (
              <p className="m-0 text-ink-2" style={rise(2)}>
                {q ? `No one matches “${query.trim()}”.` : tab === "owe-you" ? "No one owes you anything open." : "You don't owe anyone anything open."}
              </p>
            )}
            {groups.map(({ group, rows }, gi) =>
              rows.length === 0 ? null : (
                <section key={group.key} aria-labelledby={`pp-${group.key}`} className="flex flex-col gap-1" style={rise(gi + 2)}>
                  {tab === "recent" && (
                    <h2 id={`pp-${group.key}`} className="t-section m-0 mb-1.5 text-ink">
                      {group.title} <span className="font-medium text-muted">{rows.length}</span>
                    </h2>
                  )}
                  <ul className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label={tab === "recent" ? undefined : group.title}>
                    {rows.map((p) => (
                      <li key={p.id}>
                        <PersonRow person={p} now={now} sample={p.meetingIds.every((id) => sampleIds.has(id))} onOpen={() => onOpenPerson(p.id)} />
                      </li>
                    ))}
                  </ul>
                </section>
              ),
            )}
          </TabPanel>
        </>
      )}

      <Footnote style={rise(5)}>Someone missing? People appear after a meeting where your calendar invited them or the notes named them.</Footnote>
    </Page>
  );
}

function PersonRow({ person: p, now, sample, onOpen }: { person: Person; now: number; sample: boolean; onOpen: () => void }) {
  const youOwe = openCount(p.youOwe);
  const theyOwe = openCount(p.theyOwe);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="press -mx-3 grid w-[calc(100%+24px)] grid-cols-[36px_minmax(0,1fr)_116px_104px_14px] items-center gap-x-4 rounded-[10px] p-3 text-left text-ink hover:bg-elevated"
    >
      <Avatar name={p.name} size={36} decorative />
      <span className="flex min-w-0 flex-col gap-px">
        <span className="flex min-w-0 items-center gap-2">
          <span className="t-title truncate">{p.name}</span>
          {sample && (
            <Pill tone="muted" className="h-5 px-2">
              Sample
            </Pill>
          )}
        </span>
        <span className="truncate text-[13px] leading-[18px] text-ink-2">{personSource(p)}</span>
      </span>
      <span className="flex flex-col gap-px">
        <span className="text-[13px] leading-[18px]">{lastSeen(p, now)}</span>
        <span className="t-eyebrow text-muted">{plural(p.meetingIds.length, "meeting")}</span>
      </span>
      <span className="flex flex-col gap-px text-[13px] leading-[18px] text-ink-2">
        {youOwe > 0 && (
          <span>
            You owe <span className="font-mono text-ink">{youOwe}</span>
          </span>
        )}
        {theyOwe > 0 && (
          <span>
            Owes you <span className="font-mono text-ink">{theyOwe}</span>
          </span>
        )}
      </span>
      <ChevronRight size={14} strokeWidth={2} className="text-faint" aria-hidden="true" />
    </button>
  );
}
