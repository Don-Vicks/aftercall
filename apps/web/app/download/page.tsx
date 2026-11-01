import { CopyButton } from "../client";
import { Icon, Pill, REPO_URL, SiteFooter, SiteHeader, vars, type IconName } from "../ui";
import { OsSteps } from "./OsSteps";
import d from "./download.module.css";

export const metadata = {
  title: "Download · Aftercall",
  description: "Download Aftercall for Mac: check the file, see what it asks for and why, or build it yourself.",
};

/**
 * The release. No build has been published yet, so these stay the board's placeholders
 * until one is: fill in the version, size, file name and SHA-256 when it is. The button
 * goes to the GitHub releases page, which lists whatever has been published.
 */
const RELEASE = {
  url: `${REPO_URL}/releases/latest`,
  version: "[version]",
  size: "[size]",
  file: "[file]",
  sha256: "[sha256 of the release file]",
  /** Shown while builds aren't signed with a Developer ID. */
  unsignedNote: "[Shown only for unsigned builds]",
};

const BUILD = `git clone ${REPO_URL}.git aftercall
cd aftercall
pnpm install
pnpm verify
pnpm --filter @aftercall/desktop tauri build --debug --bundles app`;

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

/** V2Download. */
export default function Download() {
  return (
    <>
      <SiteHeader current="download" />
      <main>
        <section aria-labelledby="dh" className={d.hero}>
          <div className={d.heroGrid}>
            <div className={d.heroText}>
              <span className={`${d.eyebrow} enter`}>Download · for Mac</span>
              <h1 id="dh" className={`${d.h1} enter`} style={vars({ d: "40ms", dur: "360ms" })}>
                Download Aftercall
              </h1>
              <p className={`${d.lede} enter`} style={vars({ d: "80ms", dur: "360ms" })}>
                Private meeting notes made in NEAR AI&apos;s secure hardware. Open source, MIT.
              </p>
              <div className={`${d.getRow} enter`} style={vars({ d: "120ms", dur: "360ms" })}>
                <a href={RELEASE.url} className="btn btn-primary btn-xl press">
                  <Icon name="download" size={19} />
                  Download for Mac
                </a>
                <span className={d.version}>
                  <span className="ink">
                    Version {RELEASE.version} · {RELEASE.size}
                  </span>
                  <span className="muted">macOS 14.2 or later</span>
                </span>
              </div>
            </div>

            <div className={`${d.checkCard} lift enter`} style={vars({ d: "160ms", dur: "360ms" })}>
              <h2 className="t-section">
                Check the download <span className="count">SHA-256</span>
              </h2>
              <div className={d.copyField}>
                <span>{RELEASE.sha256}</span>
                <CopyButton text={RELEASE.sha256} label="Copy the SHA-256" />
              </div>
              <span style={{ fontSize: 13, lineHeight: "18px", fontWeight: 600 }}>Then in Terminal</span>
              <div className={d.copyField}>
                <span>shasum -a 256 ~/Downloads/{RELEASE.file}</span>
                <CopyButton text={`shasum -a 256 ~/Downloads/${RELEASE.file}`} label="Copy the shasum command" />
              </div>
              <span className="ink-2">The two should match. If they don&apos;t, don&apos;t open the file.</span>
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

        <section aria-label="First run, and if macOS warns you" className={d.section}>
          <div className={`${d.wrap} ${d.two}`}>
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
                      Start the call in any app, then press New recording (<span className="mono" style={{ fontSize: 13 }}>⌘⇧R</span>) or use the menu bar. Tell everyone you&apos;re taking notes; Aftercall asks you to confirm it.
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

            <div className={d.col}>
              <div className={d.warnHead}>
                <h2 className={d.h2}>If macOS warns you</h2>
                <span className={d.placeholder}>{RELEASE.unsignedNote}</span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 10 }} className="ink-2">
                <span>This build isn&apos;t notarized by Apple, so macOS stops it the first time you open it.</span>
                <details className="why">
                  <summary>Why?</summary>
                  <span className="why-body" style={{ display: "block", marginTop: 6 }}>
                    Apple notarizes apps signed with a Developer ID, and this build isn&apos;t signed with one, so macOS can&apos;t confirm who made it. Check the SHA-256 above, or build it yourself from the source below.
                  </span>
                </details>
              </div>
              <OsSteps />
            </div>
          </div>
        </section>

        <section aria-labelledby="bh" className={d.section} style={{ paddingBottom: 36 }}>
          <div className={`${d.wrap} ${d.two} ${d.buildGrid}`}>
            <div className={d.col} style={{ gap: 12 }}>
              <h2 id="bh" className={d.h2}>
                Build it yourself
              </h2>
              <p className="ink-2">
                Needs Node 24, pnpm 10 and Rust stable. macOS only lets a bundled app capture system audio, so build the app to record, then open the{" "}
                <span className="mono ink" style={{ fontSize: 13 }}>
                  .app
                </span>{" "}
                it makes.
              </p>
              <a href={REPO_URL} className="arrow-link" style={{ alignSelf: "flex-start" }}>
                Read the code on GitHub
                <Icon name="external" size={12} />
              </a>
            </div>
            <div className={d.terminal}>
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
                    {line === "pnpm verify" && <span className="muted">{"      # every check"}</span>}
                    {"\n"}
                  </span>
                ))}
              </pre>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
