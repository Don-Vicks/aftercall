import type { ReactNode } from "react";
import { AppWindow, vars } from "../ui";
import l from "../landing.module.css";
import { AskDemo } from "./AskDemo";
import { Caption, SectionHead, Shot } from "./bits";
import { FeatureTabs, type Tab } from "./FeatureTabs";
import { TickCard } from "./TickCard";

/* Section 4: everything after the call, with the app's real screens and two small live demos. */

const TABS: Tab[] = [
  { id: "today", name: "Today", line: "What needs you, what's left on today's calendar, and your recent meetings, with recording one click or ⌘⇧R away." },
  { id: "search", name: "Search", keycap: "⌘K", line: "Jump to any meeting, decision, action item or line of a transcript. Searched on this Mac; ⌘↵ shows every result." },
  {
    id: "ask",
    name: "Ask your meetings",
    keycap: "⌘J",
    line: "Ask in plain words. Only the matching lines leave your Mac, end-to-end encrypted to a checked model, and every answer shows its quotes.",
  },
  { id: "people", name: "People", line: "Everyone you've met and what's still open between you, worked out on your Mac from calendar invites and the notes." },
  { id: "actions", name: "Action items", line: "Every action item across your meetings. Tick it off, or edit its text, owner or due date; Restore original brings back the signed one." },
  {
    id: "agents",
    name: "Claude Code",
    keycap: "MCP",
    line: "Let Claude Code pick up action items through the MCP server the app ships. Off by default; read-only until you allow claiming and completing.",
  },
  { id: "export", name: "Export", line: "Copy a meeting as Markdown or save it as a PDF. Your notes and the transcript go in only when you tick them." },
  { id: "privacy", name: "Privacy and your data", line: "See where everything lives and what each place keeps. Delete everything on this Mac in one step." },
];

const SMALL: [string, string][] = [
  ["Projects", "Keep a client's calls together, with their own action items."],
  ["Calendar", "Meeting names and recap addresses come from your calendar, read on this Mac only."],
  ["Warnings", "If your mic or the call goes silent, Aftercall says which side; after two quiet minutes it asks “Call ended?” and keeps recording."],
  ["Cost", "Each run shows an estimated cost from what NEAR AI reports, never a guess."],
  ["Sealed", "Audio, transcripts and notes are encrypted on disk with a key in your Keychain."],
];

const SIZES = "(max-width: 767px) 92vw, (max-width: 1023px) 80vw, 720px";

function Win({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <AppWindow className={`${l.panelWindow}${className ? ` ${className}` : ""}`} bodyClassName={l.panelBody}>
      {children}
    </AppWindow>
  );
}

const PANELS = [
  <div key="today" className={l.panelStage}>
    <Win>
      <Shot name="home-c" w={880} h={480} sizes={SIZES} alt="Today: Record a meeting, and Needs you with the 50.00 USDC payment to the designer and the blocked 5,000.00 USDC one." />
    </Win>
    <Caption>The Mac app on its built-in sample meeting.</Caption>
  </div>,
  <div key="search" className={l.panelStage}>
    <div className={l.floatShot}>
      <Shot name="palette-detail" w={640} h={488} sizes="(max-width: 767px) 92vw, 600px" alt="The ⌘K palette searching “deck”: the meeting, an action item, a decision and two lines of the transcript." />
    </div>
    <Caption>The ⌘K palette on the sample meeting, searching “deck”.</Caption>
  </div>,
  <div key="ask" className={l.panelStage}>
    <Win>
      <AskDemo />
    </Win>
    <Caption>Drawn from the app&apos;s Ask screen on the sample meeting. In the Mac app, an attested Qwen model answers from these excerpts and quotes them.</Caption>
  </div>,
  <div key="people" className={l.panelStage}>
    <div className={l.pair}>
      <Win className={l.pairBack}>
        <Shot name="people-c" w={880} h={500} sizes={SIZES} alt="People: Ada and the designer, with what's open between you." />
      </Win>
      <Win className={l.pairFront}>
        <Shot name="person-c" w={880} h={670} sizes="(max-width: 767px) 80vw, 520px" alt="Ada's page: what you owe each other, your meeting, and the decisions you made together." />
      </Win>
    </div>
    <Caption>The Mac app on its built-in sample meeting.</Caption>
  </div>,
  <div key="actions" className={l.panelStage}>
    <div className={l.pair}>
      <Win className={l.pairBack}>
        <Shot name="actions-c" w={880} h={520} sizes={SIZES} alt="Action items, Mine: Send Ada the recap today, and Ship the API fix, which Claude Code is on." />
      </Win>
      <div className={l.tickFloat}>
        <TickCard />
      </div>
    </div>
    <Caption>The tick card is drawn from the app&apos;s action item rows. Try it.</Caption>
  </div>,
  <div key="agents" className={l.panelStage}>
    <Win>
      <div className={l.agentsStack}>
        <Shot name="agents-switches-detail" w={720} h={181} sizes={SIZES} alt="Connected agents switched on: Let agents reach my meetings, and Let agents claim and complete action items." />
        <Shot name="agents-activity-detail" w={720} h={390} sizes={SIZES} alt="Recent agent activity: Claude Code claimed Ship the API fix, read a meeting, and was refused while agents were read-only." />
      </div>
    </Win>
    <Caption>Recorded with Claude Code against the MCP server and its test stand-in for the app, 1 Nov 2026.</Caption>
  </div>,
  <div key="export" className={l.panelStage}>
    <div className={l.exportStage}>
      <Win className={l.exportBack}>
        <Shot name="meeting-col" w={632} h={796} sizes="(max-width: 767px) 92vw, 520px" alt="" />
      </Win>
      <div className={l.exportMenu}>
        <Shot name="export-menu-detail" w={336} h={321} sizes="(max-width: 767px) 80vw, 360px" alt="The Export menu: Copy as Markdown, Print or save as PDF, Include your notes, Include the transcript, and a note that copies aren't encrypted." />
      </div>
    </div>
    <Caption>Exports leave Aftercall&apos;s encryption; the menu says so.</Caption>
  </div>,
  <div key="privacy" className={l.panelStage}>
    <Win>
      <Shot name="privacy-c" w={880} h={670} sizes={SIZES} alt="Privacy and your data: what stays on this Mac, encrypted, the four Keychain items, and the places data leaves the Mac for, with what each keeps." />
    </Win>
    <Caption>The Mac app&apos;s Settings, Privacy and your data.</Caption>
  </div>,
];

export function Features() {
  return (
    <section id="features" aria-labelledby="features-h" className={l.section}>
      <div className={l.wrap}>
        <SectionHead
          index="04"
          eyebrow="Everything after the call"
          id="features-h"
          title="Every call you've had, a keystroke away."
          lead="Notes, transcripts, people and action items stay on your Mac, sealed with a key in your Keychain. Find them, ask them, and hand work to an agent, all from the keyboard."
        />
        <div data-reveal="" className={l.revealWide}>
          <FeatureTabs tabs={TABS} panels={PANELS} />
        </div>
        <ul className={l.smallThings}>
          {SMALL.map(([k, v], i) => (
            <li key={k} data-reveal="" style={vars({ rd: `${i * 50}ms` })}>
              <span className={l.pointLabel}>{k}</span>
              <p>{v}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
