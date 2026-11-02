import { vars } from "../ui";
import l from "../landing.module.css";
import { Caption, SectionHead } from "./bits";
import { InCallStage } from "./InCallStage";

/* Section 2: the product during a call. Moment 1, the live recorder, runs while it's in view. */

const POINTS: [string, string][] = [
  ["⌘⇧R", "Opens the record sheet from any app, or your notes while recording. You can turn the shortcut off in Settings."],
  ["Your notes", "Type what matters as it happens. Your notes guide the summary; every follow-up still needs a quote from the call."],
  ["Every time", "Recording starts only after you tick “I've told everyone on the call”. Aftercall keeps that as your statement; it can't check it."],
];

export function InCall() {
  return (
    <section id="in-the-call" aria-labelledby="call-h" className={l.section}>
      <div className={l.wrap}>
        <SectionHead
          index="02"
          eyebrow="In the call"
          id="call-h"
          title="Record any call. No bot joins."
          lead="Aftercall records both sides on your Mac, your microphone and the call's audio, kept apart, whatever app the call is in. Press ⌘⇧R in any app to open the record sheet. A small recorder sits above your call and the menu bar keeps time."
        />
        <div data-reveal="" className={l.revealWide}>
          <InCallStage />
          <Caption>Drawn from the app&apos;s own recorder, record sheet and notes. Sample call. Built and unit-tested; not all of it has run on a real call yet.</Caption>
        </div>
        <ul className={l.points3}>
          {POINTS.map(([k, v], i) => (
            <li key={k} data-reveal="" style={vars({ rd: `${i * 60}ms` })}>
              <span className={l.pointLabel}>{k}</span>
              <p>{v}</p>
            </li>
          ))}
        </ul>
        <p className={l.smallLine} data-reveal="">
          Audio is sealed on your Mac about once a second while recording, and deleted once the notes are saved.
        </p>
      </div>
    </section>
  );
}
