import { CopyButton } from "../client";
import { Icon, Pill, REPO_URL, SiteFooter, SiteHeader, vars, type IconName } from "../ui";
import { REPO_PUBLIC } from "../site";
import d from "./download.module.css";

export const metadata = {
  title: "Install · Aftercall",
  description: "No signed build of Aftercall is published yet. Build it from source on your Mac, and see what it asks for and why.",
};

/**
 * No signed build has been published, so this page offers none: it says so, and
 * gives the README's Run it steps. When a release is published, it can link to it here.
 */
const BUILD = `git clone ${REPO_URL}.git aftercall
cd aftercall
pnpm install
pnpm verify --quick
pnpm --filter @aftercall/desktop tauri build --debug --bundles app
open apps/desktop/src-tauri/target/debug/bundle/macos/Aftercall.app`;

const COMMENTS: Record<string, string> = {
  "pnpm verify --quick": "# typecheck and tests",
};

const NEEDED = { pill: "Needed to record", tone: "muted" as const };
const OPTIONAL = { pill: "Off by default", tone: "outline" as const };

/** What macOS will ask for, in the words of the app's own permission prompts. */
const PERMS: { icon: IconName; name: string; where: string; lead?: string; why: string; pill: string; tone: "muted" | "outline" }[] = [
  { icon: "mic", name: "Microphone", where: "Privacy & Security › Microphone", why: "Aftercall records your side of the call to make private meeting notes. The audio is deleted once the notes are saved.", ...NEEDED },
  { icon: "speaker", name: "Screen & System Audio Recording", where: "Privacy & Security › Screen & System Audio Recording", lead: "The call's audio, not your screen.", why: "Aftercall records the call's audio to make private meeting notes. The audio is deleted once the notes are saved.", ...NEEDED },
  { icon: "calendar", name: "Calendar", where: "Privacy & Security › Calendars", lead: "Only if you choose Connect calendar in Settings.", why: "Aftercall reads the meeting you're recording from your calendar to name the notes and suggest who gets the recap. It never changes your calendar.", ...OPTIONAL },
  { icon: "bell", name: "Notifications", where: "System Settings › Notifications", why: "Tells you when a meeting’s notes are ready to review.", ...OPTIONAL },
  { icon: "key", name: "Keychain", where: "Your login keychain, on this Mac", why: "Holds the key that seals your recordings and notes, your NEAR AI key, and the app's limited NEAR key.", ...NEEDED },
];

/** What building and running it takes (README, Run it). */
const NEEDS: [string, string][] = [
  ["A Mac on macOS 14.2 or later", "Aftercall records the call's audio with a Core Audio tap, so it runs on a Mac only."],
  ["Node 24, pnpm 10 and Rust stable", "To install, check and build the app from source."],
  ["Your own NEAR AI key", "From cloud.near.ai. Notes run on it, and each run shows an estimated cost."],
];

/** V2Download, until a signed build is published. */
export default function Download() {
  return (
    <>
      <SiteHeader current="download" />
      <main>
        <section aria-labelledby="dh" className={d.hero}>
          <div className={d.heroGrid}>
            <div className={d.heroText}>
              <span className={`${d.eyebrow} enter`}>Install · for Mac</span>
              <h1 id="dh" className={`${d.h1} enter`} style={vars({ d: "40ms", dur: "360ms" })}>
                Build Aftercall on your Mac
              </h1>
              <p className={`${d.lede} enter`} style={vars({ d: "80ms", dur: "360ms" })}>
                No signed build is published yet. Until one is, you build the app from source. It&apos;s open source, MIT
                {REPO_PUBLIC ? "." : ", and the repository opens with the hackathon submission; the steps below work from then."}
              </p>
              <div className={`${d.getRow} enter`} style={vars({ d: "120ms", dur: "360ms" })}>
                <a href={`${REPO_URL}#run-it`} className="btn btn-primary btn-xl press">
                  <Icon name="laptop" size={19} />
                  Build it on your Mac
                </a>
                <a href={`${REPO_URL}#check-it-in-five-minutes`} className="arrow-link">
                  Check it in five minutes
                  <Icon name="external" size={12} />
                </a>
              </div>
              <span className={`${d.platform} enter`} style={vars({ d: "140ms", dur: "360ms" })}>
                Mac only · macOS 14.2 or later · your own NEAR AI key
              </span>
            </div>

            <div className={`${d.terminal} enter`} style={vars({ d: "160ms", dur: "360ms" })}>
              <div className={d.terminalHead}>
                <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>
                  Terminal
                </span>
                <CopyButton text={BUILD} label="Copy the build commands" />
              </div>
              <pre tabIndex={0} aria-label="Build commands">
                {BUILD.split("\n").map((line) => (
                  <span key={line}>
                    {line}
                    {COMMENTS[line] && <span className="muted">{`   ${COMMENTS[line]}`}</span>}
                    {"\n"}
                  </span>
                ))}
              </pre>
            </div>
          </div>
        </section>

        <section aria-labelledby="ph" className={d.section}>
          <div className={d.wrap} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className={d.permsHead}>
              <div>
                <h2 id="ph" className={d.h2}>
                  What it will ask for, and why
                </h2>
                <p className={d.intro}>macOS asks the first time each one is needed. The wording below is what the prompt says.</p>
              </div>
              <span className="muted" style={{ fontSize: 12 }}>
                Change any of them in System Settings › Privacy &amp; Security
              </span>
            </div>
            <ul className={d.perms}>
              {PERMS.map((p, i) => (
                <li key={p.name} className={`${d.perm} enter`} style={vars({ d: `${60 + i * 50}ms`, dur: "280ms" })}>
                  <span aria-hidden="true" className={d.permIcon}>
                    <Icon name={p.icon} size={17} stroke={1.75} />
                  </span>
                  <span className={d.permName}>
                    <span>{p.name}</span>
                    <span>{p.where}</span>
                  </span>
                  <span className={d.permWhy}>
                    {p.lead && <strong>{p.lead}</strong>}
                    {p.why}
                  </span>
                  <Pill tone={p.tone} className={d.permPill}>
                    {p.pill}
                  </Pill>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-label="What you need, and the first run" className={d.section} style={{ paddingBottom: 36 }}>
          <div className={`${d.wrap} ${d.two}`}>
            <div className={d.col}>
              <h2 className={d.h2}>What you need</h2>
              <ul className={d.steps}>
                {NEEDS.map(([lead, rest]) => (
                  <li key={lead}>
                    <span className={d.stepNo} aria-hidden="true">
                      <Icon name="check" size={14} stroke={2.4} />
                    </span>
                    <span className={d.stepText}>
                      <span>{lead}</span>
                      <span>{rest}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="ink-2">
                macOS only lets a bundled app capture system audio, so build the app to record, then open the{" "}
                <span className="mono ink" style={{ fontSize: 13 }}>
                  .app
                </span>{" "}
                it makes.
              </p>
              <a href={`${REPO_URL}#run-it`} className="arrow-link" style={{ alignSelf: "flex-start" }}>
                Run it, in the README
                <Icon name="external" size={12} />
              </a>
            </div>

            <div className={d.col}>
              <h2 className={d.h2}>First run</h2>
              <ol className={d.steps}>
                <li>
                  <span className={d.stepNo}>01</span>
                  <span className={d.stepText}>
                    <span>Check your audio</span>
                    <span>Play something with sound and say a few words. macOS asks for the microphone and system audio here. The test recording is deleted straight away.</span>
                  </span>
                </li>
                <li>
                  <span className={d.stepNo}>02</span>
                  <span className={d.stepText}>
                    <span>Add your NEAR AI key</span>
                    <span>Paste a key from cloud.near.ai. Aftercall checks it and keeps it in your Keychain. You can record without one; notes wait until you add it.</span>
                  </span>
                </li>
                <li>
                  <span className={d.stepNo}>03</span>
                  <span className={d.stepText}>
                    <span>Record a call</span>
                    <span>
                      Start the call in any app, then press <span className="mono" style={{ fontSize: 13 }}>⌘⇧R</span>: it works from any app while Aftercall is running, unless another app already uses it or you turn that off in Settings. Or press New recording, or use the menu bar. Tell everyone you&apos;re taking notes; Aftercall asks you to confirm it.
                    </span>
                  </span>
                </li>
                <li>
                  <span className={d.stepNo}>04</span>
                  <span className={d.stepText}>
                    <span>Approve the follow-ups</span>
                    <span>Approve the recap and payments you want. Connect NEAR in Settings when you&apos;re ready to pay from your agent wallet.</span>
                  </span>
                </li>
              </ol>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
