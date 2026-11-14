"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  LINE_NOT_PROVEN,
  NOT_PROVEN,
  WHISPER_NOTE,
  allChecksPassed,
  decodeVerifyLink,
  droppedLine,
  explorerAccountUrl,
  formatClock,
  groupChecks,
  hasFullChecks,
  hasStatements,
  lineSpeakerWords,
  noticeLine,
  proofHash,
  provenClaims,
  recordedAtMs,
  recordingStartMs,
  runLinkChecks,
  tamperedLink,
  type Check,
  type CheckGroup,
  type LineProof,
  type OnChainProof,
  type ProofBundleV2,
  type ProofBundleV3,
  type PublicProof,
  type TeeCheck,
  type VerifyLink,
} from "@aftercall/core";
import { CopyButton } from "../client";
import { Icon, Pill, Seal, SiteFooter, SiteHeader, Tick, vars } from "../ui";
import v from "./verify.module.css";

type Done = { kind: "done"; link: VerifyLink; checks: Check[]; onChain: OnChainProof | null; rpcError?: string };
type State = { kind: "loading" } | { kind: "missing" } | { kind: "bad-link" } | { kind: "checking"; link: VerifyLink } | Done;

/** Row timing: browser checks tick in 70ms apart, then the recorded groups. */
const rowAt = (i: number) => 140 + i * 70;

export function VerifyClient() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const latest = useRef(0);

  const run = useCallback(async () => {
    const fragment = window.location.hash;
    if (!fragment || fragment.length < 2) return setState({ kind: "missing" });
    let link: VerifyLink;
    try {
      link = decodeVerifyLink(fragment);
    } catch {
      return setState({ kind: "bad-link" });
    }
    const id = ++latest.current;
    setState({ kind: "checking", link });
    // The same checks as the receipts package: NEAR's proof hash, NVIDIA's keys, then every check.
    const done: Done = { kind: "done", link, ...(await runLinkChecks(link)) };
    // A newer run (the link changed, or "Run the checks again") wins.
    if (id === latest.current) setState(done);
  }, []);

  useEffect(() => {
    run();
    window.addEventListener("hashchange", run);
    return () => window.removeEventListener("hashchange", run);
  }, [run]);

  const link = state.kind === "checking" || state.kind === "done" ? state.link : null;

  return (
    <>
      <SiteHeader current="verify" />
      <main className={v.main}>
        <div className={v.inner}>
          {state.kind === "loading" && (
            <p className="ink-2" role="status">
              Reading the proof link…
            </p>
          )}
          {state.kind === "missing" && (
            <Message
              title="Open a proof link"
              body="A proof link is what the Copy proof link button copies from a meeting's Verify sheet in the Aftercall app. Everything after its # sign is the proof: hashes, nonces, the models, the checks the app ran, the summary's signature and the NEAR account it belongs to, never what was said. Open one here and your browser reads the proof's hash from NEAR and re-runs the checks it can. A line link, from Share this line, also holds one line of the transcript and checks that it is part of that proof."
            >
              <span className={v.messageLinks}>
                <a href="/proof" className="arrow-link">
                  Open a real one: what has run on NEAR testnet
                  <Icon name="arrowRight" size={14} stroke={2.2} />
                </a>
                <a href="/how-it-works" className="arrow-link">
                  How it works
                  <Icon name="arrowRight" size={14} stroke={2.2} />
                </a>
                <a href="/handling" className="arrow-link">
                  How a call is handled
                  <Icon name="arrowRight" size={14} stroke={2.2} />
                </a>
              </span>
            </Message>
          )}
          {state.kind === "bad-link" && <Message title="This link is damaged" body="The proof in the link can't be read. Ask the person who shared it to copy it again from Aftercall." />}
          {link && <Result proof={link.proof} line={link.kind === "line" ? link.line : null} done={state.kind === "done" ? state : null} onRerun={run} />}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function Result({ proof, line, done, onRerun }: { proof: PublicProof; line: LineProof | null; done: Done | null; onRerun: () => void }) {
  const checks = done?.checks ?? [];
  // A check that can't be re-run (NVIDIA retired its key before Aftercall archived it) is listed, but counted apart.
  const rerun = checks.filter((c) => !c.cantRecheck);
  const passed = rerun.filter((c) => c.ok).length;
  const notRerun = checks.length - rerun.length;
  const recorded: TeeCheck[] | null = hasFullChecks(proof.bundle) ? proof.bundle.checks : null;
  // E2EE has its own line; "processed privately" rests on attestation and signatures.
  const allOk = !!done && allChecksPassed(proof.bundle, checks);
  const dateOpts = { day: "numeric", month: "short", year: "numeric" } as const;
  const when = done?.onChain
    ? new Date(recordedAtMs(done.onChain)).toLocaleDateString([], dateOpts)
    : hasFullChecks(proof.bundle)
      ? new Date(proof.bundle.checkedAt).toLocaleDateString([], dateOpts)
      : null;
  const hash = proofHash(proof.bundle);
  const sealAt = rowAt(checks.length) + 60;

  const download = () => {
    const blob = new Blob([JSON.stringify(line ? { ...proof, ...line } : proof, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `aftercall-${line ? "line" : "proof"}-${proof.bundle.meetingId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const title = line
    ? !done
      ? "Checking this line"
      : allOk
        ? "This line is in the meeting's proof on NEAR"
        : "This line doesn't fully check out"
    : !done
      ? "Checking this meeting proof"
      : allOk
        ? "The app recorded this meeting as processed in secure hardware"
        : "This proof doesn't fully check out";

  return (
    <>
      <section aria-labelledby="vh" className={`${v.hero} enter`}>
        <div className={v.heroText}>
          <span className="t-eyebrow">
            {line ? "Shared line" : "Meeting proof"}
            {when ? ` · ${when}` : ""} · recorded by {proof.owner}
          </span>
          <h1 id="vh" className={v.h1}>
            {title}
          </h1>
          <span className="ink-2">
            {done && !allOk ? "Some checks failed; the lists below say which, and why. " : ""}
            {line
              ? "The link holds this one line and the meeting's proof. No other line, no notes and no title."
              : "This page holds the evidence only, never what was said."}
          </span>
          <div className={v.pills} aria-live="polite">
            {done ? (
              <Pill tone={allOk ? "verdigris" : "caution"} className="pop" style={vars({ d: `${sealAt}ms`, dur: "320ms" })} icon={<Icon name={allOk ? "check" : "info"} size={12} stroke={2.5} />}>
                {passed} of {rerun.length} passed in your browser
                {notRerun > 0 && ` · ${notRerun} can't be re-checked`}
              </Pill>
            ) : (
              <Pill tone="muted" icon={<span aria-hidden="true" className={`spinner ${v.smallSpinner}`} />}>
                Checking
              </Pill>
            )}
          </div>
        </div>
        {(!done || allOk) && (
          <div className={v.sealBox}>
            <svg viewBox="0 0 148 148" aria-hidden="true">
              <circle cx="74" cy="74" r="70" fill="none" strokeWidth="1.5" strokeDasharray="3 6" stroke="var(--border)" opacity=".6" />
            </svg>
            {allOk && (
              <div role="img" aria-label="Verified" className="pop" style={vars({ d: `${sealAt}ms`, dur: "460ms", "pop-ease": "cubic-bezier(.3,1.4,.5,1)" })}>
                <Seal id="verify-seal" fine />
              </div>
            )}
          </div>
        )}
      </section>

      {line && <SharedLine meetingId={proof.bundle.meetingId} line={line} />}

      {done && <Proves claims={provenClaims(done.link, checks)} checks={checks} />}

      <section aria-labelledby="vb" className={v.block}>
        <div className={v.blockHead}>
          <h2 id="vb" className="t-section">
            Re-checked in your browser <span className="count">{done ? "just now, from NEAR and the link" : "from NEAR and the link"}</span>
          </h2>
          {done && <span>{checks.length} checks</span>}
        </div>
        {done ? (
          <ol className={v.list}>
            {checks.map((c, i) => (
              <CheckRow key={c.id} check={c} at={rowAt(i)} />
            ))}
          </ol>
        ) : (
          <div role="status" className={`${v.status} enter`} style={vars({ dur: "240ms" })}>
            <span aria-hidden="true" className="spinner" />
            Reading the proof from NEAR and checking it in your browser…
          </div>
        )}
        {done?.rpcError && <p style={{ color: "var(--caution)", overflowWrap: "anywhere" }}>Couldn&apos;t read NEAR: {done.rpcError.replace(/^Error: /, "")}</p>}
      </section>

      {done && <TryToFake key={`fake-${hash}`} done={done} />}

      {recorded ? (
        <Recorded key={hash} proof={proof} recorded={recorded} start={done ? checks.length : 0} />
      ) : (
        <p className="ink-2">This proof was made before Aftercall verified attestation quotes. The app checked the signature and that attestation evidence came back with a fresh nonce.</p>
      )}

      {/* Proofs made before the app kept these have none: an empty notice there means "not kept", not "nobody was told". */}
      {hasStatements(proof.bundle) && <Statements bundle={proof.bundle} />}

      <section aria-label="On-chain proof" className={`${v.onChain} enter`} style={vars({ d: "120ms" })}>
        <div className={v.onChainTop}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
            <Icon name="chain" size={16} stroke={1.75} className="accent" />
            {done && !done.onChain ? "Proof hash" : "Proof on NEAR"}
          </span>
          <span className="mono" title={hash} style={{ fontSize: 13 }}>
            {hash.slice(0, 12)}…{hash.slice(-10)}
          </span>
          <CopyButton text={hash} label="Copy proof hash" />
          <a href={explorerAccountUrl(proof.network, proof.contract)} target="_blank" rel="noreferrer" className="arrow-link">
            View on NEAR Explorer
            <Icon name="external" size={13} />
          </a>
        </div>
        <div className={v.onChainMeta}>
          <span>
            Contract{" "}
            <span className="mono ink" style={{ overflowWrap: "anywhere" }}>
              {proof.contract}
            </span>
          </span>
          <span className="muted">·</span>
          <span>{proof.network}</span>
          <span className="muted">·</span>
          <span>
            Recorded by <span className="mono ink">{proof.owner}</span>
          </span>
          <span className="muted">·</span>
          <button type="button" onClick={download} className="link-button" style={{ fontSize: 13 }}>
            Download bundle (JSON)
          </button>
        </div>
      </section>

      <section aria-labelledby="vn" className={`${v.block} enter`} style={vars({ d: "160ms" })}>
        <h2 id="vn" className="t-section">
          What this does not prove <span className="count">read this too</span>
        </h2>
        <ul className={v.notProven}>
          {[
            ...(line ? LINE_NOT_PROVEN : []),
            ...NOT_PROVEN,
            recorded
              ? "That the Intel quotes were genuine: the app verified them with Intel when the meeting was processed; this page trusts that record and re-checks what it can."
              : "That the secure-hardware evidence itself is genuine: the app checked it was present and fresh when the meeting was processed; this page trusts that record.",
          ].map((n) => {
            const cut = n.indexOf(": ");
            return (
              <li key={n}>
                {cut > 0 ? (
                  <>
                    <strong>{n.slice(0, cut + 1)}</strong>
                    {n.slice(cut + 1)}
                  </>
                ) : (
                  n
                )}
              </li>
            );
          })}
        </ul>
        <a href="/handling" className="arrow-link" style={{ alignSelf: "flex-start", marginTop: 4 }}>
          How a call is handled
          <Icon name="arrowRight" size={14} stroke={2.2} />
        </a>
      </section>

      <div className={v.foot}>
        <button type="button" onClick={onRerun} disabled={!done} className="btn btn-secondary press">
          <Icon name="refresh" size={14} />
          Run the checks again
        </button>
        <a href="/" style={{ fontWeight: 600 }}>
          What is Aftercall?
        </a>
      </div>
    </>
  );
}

/** What the checks above establish, in plain words, each statement ticked only when every check behind it passed. */
function Proves({ claims, checks }: { claims: ReturnType<typeof provenClaims>; checks: Check[] }) {
  if (claims.length === 0) return null;
  return (
    <section aria-labelledby="vp" className={`${v.block} enter`} style={vars({ d: "60ms" })}>
      <div className={v.blockHead}>
        <h2 id="vp" className="t-section">
          What this proves <span className="count">each line rests on the checks below</span>
        </h2>
      </div>
      <ol className={v.list}>
        {claims.map((c, i) => (
          <li key={c.text} className={`${v.row} enter`} style={vars({ d: `${rowAt(i)}ms`, dur: "280ms" })}>
            {c.holds === null ? (
              <span className={v.statementMark} role="img" aria-label="Can't be re-checked">
                <Icon name="minus" size={13} stroke={1.75} />
              </span>
            ) : (
              <Tick ok={c.holds} d1={`${rowAt(i) + 60}ms`} d2={`${rowAt(i) + 180}ms`} />
            )}
            <span className={v.label}>{c.text}</span>
            <span className={`${v.detail}${c.holds === false ? ` ${v.failedDetail}` : ""}`}>
              {c.holds === false ? "A check behind this failed: see below" : c.holds === null ? "Can't be re-checked now" : `Rests on: ${checks.filter((k) => c.rests.includes(k.id)).map((k) => k.label).join(" · ")}`}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * "Try to fake it": the same checks on a copy of the proof with one character changed, so a
 * judge watches which checks catch it. Only in this browser; the link and NEAR are untouched.
 */
function TryToFake({ done }: { done: Done }) {
  const [fake, setFake] = useState<{ what: string; checks: Check[] } | "checking" | null>(null);
  const run = async () => {
    setFake("checking");
    const t = tamperedLink(done.link);
    const r = await runLinkChecks(t.link);
    setFake({ what: t.what, checks: r.checks });
  };
  const caught = fake && fake !== "checking" ? fake.checks.filter((c) => !c.ok && !c.cantRecheck) : [];
  return (
    <section aria-labelledby="vf" className={`${v.block} enter`} style={vars({ d: "100ms" })}>
      <div className={v.blockHead}>
        <h2 id="vf" className="t-section">
          Try to fake it <span className="count">in this browser only</span>
        </h2>
      </div>
      <p className="ink-2" style={{ margin: 0 }}>
        Change one character of this proof, as someone editing the notes afterwards would, and run the same checks on it. The link and NEAR stay as they are.
      </p>
      <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {fake === null && (
          <button type="button" onClick={run} className="btn btn-secondary press" style={{ alignSelf: "flex-start" }}>
            Change one character and re-check
          </button>
        )}
        {fake === "checking" && (
          <div role="status" className={v.status}>
            <span aria-hidden="true" className="spinner" />
            Checking the changed copy…
          </div>
        )}
        {fake && fake !== "checking" && (
          <>
            <p style={{ margin: 0, fontWeight: 600, color: caught.length ? "var(--verdigris)" : "var(--caution)" }}>
              {caught.length ? `Caught: ${caught.length} check${caught.length === 1 ? "" : "s"} failed on the changed copy.` : "Nothing caught the change."}
            </p>
            <p className="ink-2" style={{ margin: 0 }}>
              {fake.what}
            </p>
            <ol className={v.list}>
              {fake.checks.map((c, i) => (
                <CheckRow key={c.id} check={c} at={rowAt(i)} />
              ))}
            </ol>
            <button type="button" onClick={() => setFake(null)} className="link-button" style={{ alignSelf: "flex-start", fontSize: 13 }}>
              Back to the real proof
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/** The shared line: its words, which side said it, and when. Only what the link holds. */
function SharedLine({ meetingId, line: { line } }: { meetingId: string; line: LineProof }) {
  const start = recordingStartMs(meetingId);
  const said = start !== null && Number.isFinite(line.at) ? new Date(start + line.at * 1000) : null;
  return (
    <figure aria-label="The shared line" className={`${v.sharedLine} enter`} style={vars({ d: "60ms" })}>
      <blockquote className={v.sharedText}>“{line.text}”</blockquote>
      <figcaption className={v.sharedMeta}>
        <span>{lineSpeakerWords(line.speaker)}</span>
        <span className="muted">·</span>
        <span>
          <span className="mono">{formatClock(line.at)}</span> into the recording
        </span>
        {said && (
          <>
            <span className="muted">·</span>
            <span>
              said about {said.toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          </>
        )}
      </figcaption>
    </figure>
  );
}

/** One check, ticking in at `at` ms. One that can't be re-run gets a plain mark: neither a tick nor a cross. */
function CheckRow({ check: c, at }: { check: Check | TeeCheck; at: number }) {
  const cantRecheck = "cantRecheck" in c && !!c.cantRecheck;
  return (
    <li className={`${v.row} enter`} style={vars({ d: `${at}ms`, dur: "280ms" })}>
      {cantRecheck ? (
        <span className={v.statementMark} role="img" aria-label="Can't be re-checked">
          <Icon name="minus" size={13} stroke={1.75} />
        </span>
      ) : (
        <Tick ok={c.ok} d1={`${at + 60}ms`} d2={`${at + 180}ms`} />
      )}
      <span className={v.label}>{c.label}</span>
      <span className={`${v.detail}${c.ok ? "" : ` ${v.failedDetail}`}`} title={c.detail}>
        <Detail text={c.detail} />
      </span>
    </li>
  );
}

/** Hashes, keys, model names and times in a check's detail are set in mono. */
function Detail({ text }: { text: string }) {
  const parts = text.split(/((?:0x)?[0-9a-f]{10,}…?(?:[0-9a-f]{4,})?|\b(?:Qwen|openai)\/[\w.-]+|\d{4}-\d{2}-\d{2} \d{2}:\d{2}|\b\d{2}:\d{2} UTC)/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className="mono">
            {p}
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

const GROUP_DETAIL: Record<CheckGroup["key"], (g: CheckGroup) => string> = {
  gateway: () => "Intel TDX quote, debug off, key and nonce, boot log, software",
  whisper: (g) => `The same CPU checks${g.checks.some((c) => /GPU/.test(c.label)) ? ", plus NVIDIA GPU evidence" : ""}`,
  summary: (g) => `The same checks${g.checks.some((c) => /GPU/.test(c.label)) ? ", plus NVIDIA GPU evidence" : ""}`,
  response: () => "Signed over exactly what was sent and what came back",
};

/** The app's own checks from the proof, grouped as the Mac's Verify sheet shows them. */
function Recorded({ proof, recorded, start }: { proof: PublicProof; recorded: TeeCheck[]; start: number }) {
  const groups = groupChecks(recorded, proof.bundle);
  // Groups with a failure start open, so nothing that failed is hidden behind a click.
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(groups.map((g) => [g.key, g.checks.some((c) => !c.ok)])));
  const checkedAt =
    hasFullChecks(proof.bundle) ? new Date(proof.bundle.checkedAt).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <section aria-labelledby="vr" className={v.block}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className={v.blockHead}>
          <h2 id="vr" className="t-section">
            As recorded when the notes were made <span className="count">{checkedAt}</span>
          </h2>
          <span>{recorded.length} checks</span>
        </div>
        <div className={v.whyLine}>
          <span>Your browser can&apos;t repeat the Intel quote check, nor NVIDIA&apos;s for a proof whose key NVIDIA retired (it lists keys for about two days) before Aftercall archived it, so these are shown as they ran when the notes were made.</span>
          <details className="why">
            <summary>Why?</summary>
            <span className="why-body" style={{ display: "block", marginTop: 6 }}>
              Intel&apos;s collateral service doesn&apos;t accept browser requests, and the quotes aren&apos;t in the link. The checks above re-use the values the app read from them.
            </span>
          </details>
        </div>
      </div>

      <div className={v.groups}>
        {groups.map((g, j) => {
          const at = rowAt(start + j);
          const failed = g.checks.filter((c) => !c.ok);
          const isOpen = !!open[g.key];
          return (
            <div key={g.key} className={`${v.group}${isOpen ? ` ${v.groupOpen}` : ""} enter`} style={vars({ d: `${at}ms`, dur: "280ms" })}>
              <button type="button" onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))} aria-expanded={isOpen} aria-controls={`group-${g.key}`} className={v.groupButton}>
                <Tick ok={failed.length === 0} label={failed.length === 0 ? "All passed" : "Some failed"} d1={`${at + 60}ms`} d2={`${at + 180}ms`} />
                <span className={v.groupTitle}>
                  <span>{g.title}</span>
                  <span>{failed.length === 0 ? `${g.checks.length} passed` : `${failed.length} of ${g.checks.length} failed`}</span>
                </span>
                <span className={v.detail}>{failed.length ? `Failed: ${failed.map((c) => c.label).join(", ")}` : GROUP_DETAIL[g.key](g)}</span>
                <Icon name="chevronRight" size={16} className={v.chev} />
              </button>
              {isOpen && (
                <div id={`group-${g.key}`} className={v.groupBody}>
                  <ul className={v.subList}>
                    {g.checks.map((c, k) => (
                      <li key={c.id} className={`${v.subRow} enter`} style={vars({ d: `${k * 40}ms`, dur: "240ms" })}>
                        <Tick ok={c.ok} size={16} d1={`${k * 40 + 40}ms`} d2={`${k * 40 + 160}ms`} />
                        <span className={v.label}>{c.label}</span>
                        <span className={`${v.detail}${c.ok ? "" : ` ${v.failedDetail}`}`} title={c.detail}>
                          <Detail text={c.detail} />
                        </span>
                      </li>
                    ))}
                  </ul>
                  {g.key === "whisper" && <p className={v.note}>{WHISPER_NOTE}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * What the app wrote into the proof as statements: the items it dropped and the notice
 * the person who recorded logged. The hash on NEAR covers them, but nobody can re-run
 * them from the link (the transcript isn't in it), so they get a note mark, not a tick.
 */
function Statements({ bundle }: { bundle: ProofBundleV2 | ProofBundleV3 }) {
  const dropped = droppedLine(bundle);
  const rows: [string, string][] = [
    ...(dropped ? ([["Items without a quote", dropped]] as [string, string][]) : []),
    ["Notice before recording", noticeLine(bundle.notice)],
  ];
  return (
    <section aria-labelledby="vs" className={`${v.block} enter`} style={vars({ d: "100ms" })}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2 id="vs" className="t-section">
          Stated in the proof <span className="count">not re-run</span>
        </h2>
        <p className="ink-2" style={{ maxWidth: 640 }}>
          The app wrote these into the proof when it made the notes. The proof hash covers them, so if it matches NEAR they haven&apos;t changed since. They aren&apos;t checks: the transcript isn&apos;t in the link, so nobody can re-run them.
        </p>
      </div>
      <ul className={v.statements}>
        {rows.map(([label, text]) => (
          <li key={label} className={v.statement}>
            <span className={v.statementMark}>
              <Icon name="note" size={13} stroke={1.75} />
            </span>
            <span className={v.label}>{label}</span>
            <span className={v.statementText}>{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Message({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className={`${v.message} enter`}>
      <h1 className="t-display">{title}</h1>
      <p>{body}</p>
      {children}
    </div>
  );
}
