import { CopyButton } from "../client";
import { Icon, Pill, REPO_URL, SiteFooter, SiteHeader, vars, type IconName } from "../ui";
import { DOWNLOAD_URL, HAS_DOWNLOAD, REPO_PUBLIC, TESTERS_CHAT_URL } from "../site";
import d from "./download.module.css";
import { InstallCommand } from "./InstallCommand";
import { Waitlist } from "./Waitlist";
import { redis } from "../metrics";

export const metadata = {
  title: "Install · Aftercall",
  description: HAS_DOWNLOAD
    ? "Download the Aftercall test build for Mac. It runs on NEAR testnet, with test money. See how to open it and what it asks for."
    : "No signed build of Aftercall is published yet. Build it from source on your Mac, and see what it asks for and why.",
};

/**
 * With NEXT_PUBLIC_DOWNLOAD_URL set, this page is the tester guide: it links the test
 * build and says how to open it. Without it, no build is published, so it gives the
 * README's Run it steps instead.
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

/**
 * The test build isn't notarized by Apple, so macOS blocks the first open. These are the
 * steps past that, for macOS 14.2 and later.
 */
const OPEN: [string, string][] = [
  ["Drag it to Applications", "Open the downloaded file and drag Aftercall into Applications."],
  ["Open it once", "macOS says “Apple could not verify ‘Aftercall’ is free of malware”, because this build isn't notarized yet. Click Done, not Move to Bin."],
  ["Allow it", "In System Settings › Privacy & Security, scroll down and click Open Anyway next to Aftercall. macOS asks once; after that it opens like any app."],
];

/** What building and running it takes (README, Run it), or, for the test build, running it. */
const NEEDS: [string, string][] = [
  HAS_DOWNLOAD
    ? ["A Mac on macOS 14.2 or later", "Aftercall records the call's audio with a Core Audio tap, so it runs on a Mac only. The test build runs on both Apple silicon and Intel."]
    : ["A Mac on macOS 14.2 or later", "Aftercall records the call's audio with a Core Audio tap, so it runs on a Mac only."],
  ...(HAS_DOWNLOAD
    ? ([["A NEAR testnet account, to try payments", "Optional. Settings › NEAR walks you through one. Test USDC is free from Circle's faucet at faucet.circle.com: pick NEAR Testnet."]] as [string, string][])
    : ([["Node 24, pnpm 10 and Rust stable", "To install, check and build the app from source."]] as [string, string][])),
  ["Your own NEAR AI key", "From cloud.near.ai. Notes run on it, and each run shows an estimated cost."],
];

/** V2Download: the tester guide while a test build is published, the build steps otherwise. */
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
                {HAS_DOWNLOAD ? "Try the Aftercall test build" : "Build Aftercall on your Mac"}
              </h1>
              <p className={`${d.lede} enter`} style={vars({ d: "80ms", dur: "360ms" })}>
                {HAS_DOWNLOAD ? (
                  <>
                    A build for early testers. Notes are real; money isn&apos;t: payments run on NEAR testnet with test USDC. Recaps open in your own
                    Mail app, since Send through Aftercall and claim links need a server this build doesn&apos;t have.
                  </>
                ) : (
                  <>
                    No signed build is published yet. Until one is, you build the app from source. It&apos;s open source, MIT
                    {REPO_PUBLIC ? "." : ", and the repository opens with the hackathon submission; the steps below work from then."}
                  </>
                )}
              </p>
              <div className={`${d.getRow} enter`} style={vars({ d: "120ms", dur: "360ms" })}>
                {HAS_DOWNLOAD ? (
                  <>
                    <a href={DOWNLOAD_URL} download className="btn btn-primary btn-xl press">
                      <Icon name="laptop" size={19} />
                      Download for Mac
                    </a>
                    <a href="/demo" className="arrow-link">
                      Or try it in your browser
                      <Icon name="external" size={12} />
                    </a>
                    {TESTERS_CHAT_URL && (
                      <a href={TESTERS_CHAT_URL} className="arrow-link" target="_blank" rel="noopener noreferrer">
                        Join the testers&apos; chat on Telegram
                        <Icon name="external" size={12} />
                      </a>
                    )}
                  </>
                ) : (
                  <>
                    <a href={`${REPO_URL}#run-it`} className="btn btn-primary btn-xl press">
                      <Icon name="laptop" size={19} />
                      Build it on your Mac
                    </a>
                    <a href={`${REPO_URL}#check-it-in-five-minutes`} className="arrow-link">
                      Check it in five minutes
                      <Icon name="external" size={12} />
                    </a>
                  </>
                )}
              </div>
              <span className={`${d.platform} enter`} style={vars({ d: "140ms", dur: "360ms" })}>
                {HAS_DOWNLOAD ? "Test build · NEAR testnet · macOS 14.2 or later · your own NEAR AI key" : "Mac only · macOS 14.2 or later · your own NEAR AI key"}
              </span>
            </div>

            {HAS_DOWNLOAD ? (
              <div className={d.col}>
                <div className={`${d.terminal} enter`} style={vars({ d: "150ms", dur: "360ms" })}>
                  <InstallCommand />
                  <p className={d.installNote}>
                    It downloads the same build, checks its fingerprint, puts Aftercall in Applications and opens it, with no macOS warning. That
                    skips Apple&apos;s check, so you&apos;re trusting this site instead.
                  </p>
                </div>
                <div className={`${d.terminal} enter`} style={vars({ d: "160ms", dur: "360ms" })}>
                  <div className={d.terminalHead}>
                    <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>
                      Or download it, then open it the first time
                    </span>
                  </div>
                  <ol className={`${d.steps} ${d.openSteps}`}>
                    {OPEN.map(([lead, rest], i) => (
                      <li key={lead}>
                        <span className={d.stepNo}>{String(i + 1).padStart(2, "0")}</span>
                        <span className={d.stepText}>
                          <span>{lead}</span>
                          <span>{rest}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            ) : (
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
            )}
          </div>
        </section>

        {/* Shown once the waitlist's store is connected (app/metrics.ts). */}
        {redis && (
          <section aria-labelledby="wh" className={d.section}>
            <div className={`${d.wrap} ${d.wait}`}>
              <div className={d.waitText}>
                <h2 id="wh" className={d.h2}>
                  Can&apos;t run it yet?
                </h2>
                <p className={d.intro}>
                  {HAS_DOWNLOAD
                    ? "The test build runs on Macs with macOS 14.2 or later, on NEAR testnet. Join the waitlist for a Windows build, for mainnet and a signed app, or just for news."
                    : "Join the waitlist for a signed build, a Windows build, mainnet, or just news."}
                </p>
              </div>
              <Waitlist />
            </div>
          </section>
        )}

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
              {!HAS_DOWNLOAD && (
                <>
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
                </>
              )}
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
                    <span>
                      {HAS_DOWNLOAD
                        ? "Draft the recaps you want in Mail. To try a payment, connect a NEAR testnet account in Settings and approve it from your agent wallet: it's test money."
                        : "Approve the recap and payments you want. Connect NEAR in Settings when you're ready to pay from your agent wallet."}
                    </span>
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
