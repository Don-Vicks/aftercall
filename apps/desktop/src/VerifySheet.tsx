import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Copy, ExternalLink, Info, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  FIELD_WORDS,
  NOT_PROVEN,
  WHISPER_NOTE,
  droppedLine,
  encodePublicProof,
  editsLine,
  groupChecks,
  hasFullChecks,
  hasStatements,
  itemEdits,
  meetingLabel,
  noticeLine,
  verifyProof,
  type Check as ProofCheck,
  type CheckGroup,
  type Meeting,
  type TeeCheck,
} from "@aftercall/core";
import { aboutCost, pricesDay } from "./costs";
import { VERIFY_URL, explorerTx, near } from "./near";
import type { SavedNotes } from "./nearai";
import { plainProofError, proofReadiness, recordProof } from "./proofs";
import { isFirstProof } from "./firstProof";
import { FirstTransaction } from "./FirstTransaction";
import { SAMPLE_PROOF_NOTE, runSampleChecks, type SampleCheck } from "./sampleProof";
import { Button, Dialog, IconButton, Pill, Spinner, cx } from "./ui";

/** What each group's TEE did for this meeting, after its name. */
const ROLE: Record<CheckGroup["key"], string> = {
  gateway: "routes the request",
  whisper: "made the transcript",
  summary: "wrote the notes",
  response: "the signed reply",
};

/** Rows shown per group until "Show all"; failures always show. */
const FIRST = 4;

/** The board's sequence: each row lands 90 ms after the one before (the design system's "Verified" moment). */
const STEP = 90;
const at = (ms: number): CSSProperties => ({ animation: `ac-in 280ms ${ms}ms var(--ease) both` });

/**
 * The Verified sheet: the checks this Mac ran when the meeting was processed,
 * grouped by TEE with real counts, then the proof re-checked now from the saved
 * bundle (and NEAR, once the proof is there), then what it doesn't prove.
 */
export function VerifySheet({
  recordingId,
  saved,
  onClose,
  onUpdated,
  onConnect,
}: {
  recordingId: string;
  saved: SavedNotes;
  onClose: () => void;
  onUpdated: (saved: SavedNotes) => void;
  onConnect: () => void;
}) {
  const [checks, setChecks] = useState<ProofCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canRecord, setCanRecord] = useState(false);
  const [recording, setRecording] = useState(false);
  const [copied, setCopied] = useState(false);
  const [all, setAll] = useState(false);
  // Focus starts on the result, not the close button, so it's read first and no tooltip pops up.
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let cancelled = false;
    const yours = { text: saved.meeting.yourNotes ?? "", salt: saved.yourNotesSalt };
    (async () => {
      setChecks(null);
      setError(null);
      try {
        const onChain = saved.onChain ? await near.getProof(saved.onChain.owner, saved.proof.meetingId) : null;
        if (!cancelled) setChecks(verifyProof(saved.proof, onChain, saved.notes, yours));
      } catch (e) {
        if (!cancelled) {
          setError(`Couldn't read NEAR: ${String(e)}`);
          setChecks(verifyProof(saved.proof, null, saved.notes, yours));
        }
      }
      if (!saved.onChain) {
        // Connected but NEAR didn't answer: offer to try, and say why, rather than "connect".
        const readiness = await proofReadiness();
        if (cancelled) return;
        setCanRecord(readiness.ready || readiness.why === "error");
        if (!readiness.ready && readiness.why === "error") setError(`Couldn't reach your NEAR wallet: ${readiness.error}.`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [saved]);

  const record = async () => {
    setRecording(true);
    setError(null);
    try {
      onUpdated(await recordProof(recordingId, saved));
    } catch (e) {
      setError(`Couldn't record the proof on NEAR: ${plainProofError(e)}.`);
    } finally {
      setRecording(false);
    }
  };

  const publicLink = saved.onChain
    ? `${VERIFY_URL}#${encodePublicProof({ network: saved.onChain.network, contract: saved.onChain.contract, owner: saved.onChain.owner, bundle: saved.proof })}`
    : null;

  const copyLink = async () => {
    if (!publicLink) return;
    await navigator.clipboard.writeText(publicLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const recorded: TeeCheck[] | null = hasFullChecks(saved.proof) ? saved.proof.checks : null;
  const groups = recorded ? groupChecks(recorded, saved.proof) : [];
  // Before the proof is on NEAR, "recorded on NEAR" and "matches" can't pass yet; the footer says so instead.
  const edited = itemEdits(saved.meeting, saved.notes).length > 0;
  const again =
    checks
      ?.filter((c) => saved.onChain || (c.id !== "on-chain" && c.id !== "matches"))
      // The signed notes are unchanged; the meeting shows your edits on top, listed under "Your edits after signing".
      .map((c) => (c.id === "unchanged" && c.ok && edited ? { ...c, detail: "The model's notes are as it returned them. Your edits to action items since are listed above" } : c)) ?? null;
  const passed = recorded?.filter((c) => c.ok).length ?? 0;
  const failing = (recorded?.length ?? 0) - passed + (again?.filter((c) => !c.ok).length ?? 0);
  const verified = saved.meeting.verified && (again === null || again.every((c) => c.ok || c.id === "e2ee"));
  const checkedOn = hasFullChecks(saved.proof) ? new Date(saved.proof.checkedAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
  const longest = Math.max(0, ...groups.map((g) => g.checks.length));
  const first = Boolean(saved.onChain) && isFirstProof(recordingId);

  // Row delays follow the board: groups at 120 ms + 40 each, rows from 260 ms, 90 apart.
  let row = 0;
  const nextRow = () => 260 + Math.min(row++, 24) * STEP;
  const groupRows = groups.map((g) => {
    const ordered = [...g.checks.filter((c) => !c.ok), ...g.checks.filter((c) => c.ok)];
    return { g, shown: (all ? ordered : ordered.slice(0, Math.max(FIRST, g.checks.filter((c) => !c.ok).length))).map((c) => ({ c, delay: nextRow() })) };
  });
  const lastRow = 260 + Math.min(row, 24) * STEP;

  return (
    <Dialog onClose={onClose} aria-label={`Verify: ${saved.meeting.title}`} width={680} initialFocus={heading} className="gap-6!">
      <header className="flex items-center gap-5">
        <Seal ok={verified} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="t-eyebrow truncate text-muted">
            {saved.meeting.title} · {saved.meeting.project} · {meetingLabel(saved.meeting)}
          </span>
          <h2 ref={heading} tabIndex={-1} className="m-0 font-serif text-[34px] leading-10 font-medium tracking-[-0.02em] text-ink outline-none">{verified ? "Verified" : "Not verified"}</h2>
          <span className="text-[13px] leading-[18px] text-muted">
            {recorded ? (
              <>
                <span className="font-semibold text-ink">
                  {passed === recorded.length ? `${passed} checks passed` : `${passed} of ${recorded.length} checks passed`}
                </span>
                {checkedOn && ` · checked on this Mac on ${checkedOn}`}
              </>
            ) : (
              "Made before full attestation checks"
            )}
          </span>
        </div>
        <IconButton aria-label="Close" onClick={onClose} className="-mt-1 -mr-1.5 self-start">
          <X size={18} />
        </IconButton>
      </header>

      {/* This Mac's first proof on NEAR says what just happened; later ones keep the footer's "View on NEAR". */}
      {first && saved.onChain && <FirstTransaction onChain={saved.onChain} delay={80} />}

      {recorded ? (
        <section aria-label="Checks made on this Mac when the notes were made" className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-x-8 gap-y-5">
            {groupRows.map(({ g, shown }, gi) => {
              const ok = g.checks.filter((c) => c.ok).length;
              return (
                <div key={g.key} className="flex min-w-0 flex-col" style={at(120 + gi * 40)}>
                  <h3 className="t-section m-0 mb-3 text-ink">
                    {g.title}{" "}
                    <span className="font-medium text-muted">
                      {ROLE[g.key]} · {ok} of {g.checks.length}
                    </span>
                  </h3>
                  <ol className="m-0 flex list-none flex-col gap-2 p-0">
                    {shown.map(({ c, delay }) => (
                      <li key={c.id} className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-2.5" style={at(delay)}>
                        <Mark ok={c.ok} delay={delay} />
                        <span className="flex min-w-0 flex-col">
                          <span className="text-[15px] leading-5 font-semibold text-ink">{c.label}</span>
                          <span className="selectable text-[13px] leading-[18px] break-words text-ink-2">{c.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                  {g.key === "whisper" && (
                    <p className="m-0 mt-2.5 grid grid-cols-[18px_minmax(0,1fr)] gap-x-2.5 text-[13px] leading-[18px] text-ink-2" style={at(lastRow)}>
                      <Info size={16} strokeWidth={2} aria-hidden="true" className="mt-px ml-px text-muted" />
                      <span>{WHISPER_NOTE}</span>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {longest > FIRST && (
            <Button variant="quiet" size="sm" className="self-start px-0!" aria-expanded={all} onClick={() => setAll((a) => !a)}>
              {all ? "Show fewer" : `Show all ${recorded.length} checks`}
            </Button>
          )}
        </section>
      ) : (
        <p className="m-0 text-ink-2">
          These notes were made before full attestation checks. This Mac checked the summary's signature and that attestation evidence came back with a fresh nonce; it
          didn't verify the quotes with Intel and NVIDIA.
        </p>
      )}

      <Statements saved={saved} delay={lastRow + 40} />

      <section aria-labelledby="verify-again" className="flex flex-col gap-3 border-t border-hairline pt-4" style={at(lastRow + 80)}>
        <h3 id="verify-again" className="t-section m-0 text-ink">
          Proof, checked again now <span className="font-medium text-muted">{saved.onChain ? "against NEAR" : "from the saved bundle"}</span>
        </h3>
        {again === null ? (
          <p className="m-0 flex items-center gap-3 py-1 text-ink-2">
            <Spinner /> {saved.onChain ? "Reading the proof from NEAR…" : "Checking the saved bundle…"}
          </p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
            {again.map((c, i) => {
              const delay = lastRow + 160 + i * STEP;
              return (
                <li key={c.id} className="grid grid-cols-[18px_minmax(0,1fr)] items-start gap-x-2.5 sm:grid-cols-[18px_286px_minmax(0,1fr)]" style={at(delay)}>
                  <Mark ok={c.ok} delay={delay} />
                  <span className="text-[15px] leading-5 font-semibold text-ink">{c.label}</span>
                  <span className="selectable col-start-2 text-[13px] leading-[18px] break-words text-ink-2 sm:col-start-3">{c.detail}</span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section aria-labelledby="verify-not" className="flex flex-col gap-2.5 border-t border-hairline pt-4" style={at(lastRow + 240)}>
        <h3 id="verify-not" className="t-section m-0 text-ink">
          What this doesn't prove
        </h3>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {NOT_PROVEN.map((n) => (
            <li key={n} className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-2.5 text-[13px] leading-[19px] text-ink-2">
              <span aria-hidden="true" className="text-center text-muted">
                –
              </span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      </section>

      {error && <p className="selectable m-0 break-words text-record">{error}</p>}
      {failing > 0 && again !== null && (
        <p className="m-0 text-[13px] text-caution" style={at(lastRow + 280)}>
          {failing === 1 ? "One check needs a look." : `${failing} checks need a look.`} Each says what it compared.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2.5" style={at(lastRow + 280)}>
        {saved.onChain ? (
          <>
            {first ? (
              // The card above already links the transaction.
              <span className="mr-auto" />
            ) : (
              <Button
                variant="quiet"
                className="mr-auto px-0!"
                icon={<ExternalLink size={13} aria-hidden="true" />}
                onClick={() => openUrl(explorerTx(saved.onChain!.network, saved.onChain!.txHash))}
              >
                View on NEAR
              </Button>
            )}
            <Button variant="primary" icon={<Copy size={14} aria-hidden="true" />} onClick={copyLink}>
              {copied ? "Link copied" : "Copy proof link"}
            </Button>
          </>
        ) : (
          <>
            <span className="flex-1 text-[13px] leading-[18px] text-ink-2">Only a hash goes on NEAR. The link works once it's there.</span>
            <Button disabled title="Record the proof on NEAR first" icon={<Copy size={14} aria-hidden="true" />}>
              Copy proof link
            </Button>
            {canRecord ? (
              <Button variant="primary" onClick={record} loading={recording}>
                Record proof on NEAR
              </Button>
            ) : (
              <Button variant="primary" onClick={onConnect}>
                Connect NEAR to record it
              </Button>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

/**
 * The sample meeting's Verified sheet. The meeting is made up and has no proof, so this
 * re-runs the real checks on a test proof (sampleProof.ts) and says plainly what that is.
 * Checks it can't run from that proof show as not checked, never as passed.
 */
export function SampleVerifySheet({ meeting, onClose }: { meeting: Pick<Meeting, "title" | "project">; onClose: () => void }) {
  // Run once as the sheet opens: the real verification code, on this Mac, offline.
  const [checks] = useState<SampleCheck[]>(runSampleChecks);
  const heading = useRef<HTMLHeadingElement>(null);
  const ran = checks.filter((c) => !c.skipped);
  const passed = ran.filter((c) => c.ok).length;
  const verified = passed === ran.length;
  const lastRow = 260 + checks.length * STEP;

  return (
    <Dialog onClose={onClose} aria-label={`Verify: ${meeting.title}, sample`} width={680} initialFocus={heading} className="gap-6!">
      <header className="flex items-center gap-5">
        <Seal ok={verified} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="t-eyebrow truncate text-muted">
            {meeting.title} · {meeting.project} · Sample
          </span>
          <span className="flex flex-wrap items-center gap-3">
            <h2 ref={heading} tabIndex={-1} className="m-0 font-serif text-[34px] leading-10 font-medium tracking-[-0.02em] text-ink outline-none">
              {verified ? "Verified" : "Not verified"}
            </h2>
            <Pill tone="muted">Test proof</Pill>
          </span>
          <span className="text-[13px] leading-[18px] text-muted">
            <span className="font-semibold text-ink">{passed === ran.length ? `${passed} checks passed` : `${passed} of ${ran.length} checks passed`}</span>
            {` · ${checks.length - ran.length} not checked · re-run on this Mac just now`}
          </span>
        </div>
        <IconButton aria-label="Close" onClick={onClose} className="-mt-1 -mr-1.5 self-start">
          <X size={18} />
        </IconButton>
      </header>

      <p role="note" className="m-0 grid grid-cols-[18px_minmax(0,1fr)] gap-x-2.5 rounded-sm bg-well px-4 py-3.5 text-[13px] leading-[19px] text-ink-2" style={at(120)}>
        <Info size={16} strokeWidth={2} aria-hidden="true" className="mt-px ml-px text-muted" />
        <span>
          <span className="font-semibold text-ink">Sample.</span> {SAMPLE_PROOF_NOTE}
        </span>
      </p>

      <section aria-labelledby="sample-again" className="flex flex-col gap-3">
        <h3 id="sample-again" className="t-section m-0 text-ink" style={at(180)}>
          Proof, checked again now <span className="font-medium text-muted">on this Mac, offline</span>
        </h3>
        <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
          {checks.map((c, i) => {
            const delay = 260 + i * STEP;
            return (
              <li key={c.id} className="grid grid-cols-[18px_minmax(0,1fr)] items-start gap-x-2.5 sm:grid-cols-[18px_250px_minmax(0,1fr)]" style={at(delay)}>
                {c.skipped ? <NotChecked /> : <Mark ok={c.ok} delay={delay} />}
                <span className={cx("text-[15px] leading-5 font-semibold", c.skipped ? "text-ink-2" : "text-ink")}>{c.label}</span>
                <span className="selectable col-start-2 text-[13px] leading-[18px] break-words text-ink-2 sm:col-start-3">{c.detail}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="sample-not" className="flex flex-col gap-2.5 border-t border-hairline pt-4" style={at(lastRow + 80)}>
        <h3 id="sample-not" className="t-section m-0 text-ink">
          What this doesn't prove
        </h3>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {NOT_PROVEN.map((n) => (
            <li key={n} className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-2.5 text-[13px] leading-[19px] text-ink-2">
              <span aria-hidden="true" className="text-center text-muted">
                –
              </span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-wrap items-center gap-2.5" style={at(lastRow + 120)}>
        <span className="flex-1 text-[13px] leading-[18px] text-ink-2">
          A real meeting's sheet also lists every check made in secure hardware when its notes were made, and can record its proof on NEAR.
        </span>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}

/** A check the sample can't run: a quiet dash, read as "not checked", never as a pass or a failure. */
function NotChecked() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" role="img" aria-label="Not checked" className="mt-px">
      <circle cx="9" cy="9" r="8.25" fill="none" stroke="var(--border)" strokeWidth="1.5" />
      <path d="M6 9h6" stroke="var(--muted)" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

/**
 * What was recorded with the notes but isn't a check: your notice, what the app
 * dropped, your edits to action items since, and the estimated cost. Label and words,
 * no tick, so none reads as passed.
 */
function Statements({ saved, delay }: { saved: SavedNotes; delay: number }) {
  const proof = saved.proof;
  const dropped = droppedLine(proof);
  // Compared with what the model signed, which these edits never change.
  const edits = itemEdits(saved.meeting, saved.notes);
  const rows: { label: string; text: string; list?: string[] }[] = [
    {
      label: "Notice",
      // Notes made before the notice was kept had it ticked but not saved: say that, not "none".
      text: hasStatements(proof) ? noticeLine(proof.notice) : "Not recorded: these notes were made before Aftercall kept the notice",
    },
    ...(dropped ? [{ label: "Dropped", text: dropped }] : []),
    {
      label: "Your edits after signing",
      text: editsLine(edits),
      list: edits.map((e) => {
        const was = e.fields.includes("text") ? ` (was “${e.original.text}”)` : "";
        return `“${e.text}”${was} · ${e.fields.map((f) => FIELD_WORDS[f]).join(", ")}`;
      }),
    },
  ];
  if (saved.cost) {
    const about = aboutCost(saved.cost);
    rows.push({
      label: "Processing cost",
      text: about
        ? `${about} · estimated from token counts and NEAR AI's public prices on ${pricesDay(saved.cost.pricesAsOf)}`
        : "Cost not reported · NEAR AI didn't say how many tokens the reply used",
    });
  }
  return (
    <section aria-labelledby="verify-stated" className="flex flex-col gap-2.5 border-t border-hairline pt-4" style={at(delay)}>
      <h3 id="verify-stated" className="t-section m-0 text-ink">
        Recorded with the notes, and your edits since <span className="font-medium text-muted">statements, not checks</span>
      </h3>
      <dl className="m-0 grid grid-cols-[160px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-[13px] leading-[19px] text-muted">{r.label}</dt>
            <dd className="selectable m-0 text-[13px] leading-[19px] text-ink-2">
              {r.text}
              {r.list && r.list.length > 0 && (
                <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
                  {r.list.map((line) => (
                    <li key={line} className="break-words">
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** A check's mark: a tinted circle that fills and a check that draws, or a caution cross. */
function Mark({ ok, delay }: { ok: boolean; delay: number }) {
  if (!ok) {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" role="img" aria-label="Failed" className="mt-px">
        <circle cx="9" cy="9" r="9" fill="var(--caution-tint)" />
        <path d="M6 6l6 6M12 6l-6 6" stroke="var(--caution)" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" role="img" aria-label="Passed" className="mt-px">
      <circle
        cx="9"
        cy="9"
        r="9"
        fill="var(--verdigris-tint)"
        style={{ transformBox: "fill-box", transformOrigin: "center", animation: `ac-fill 320ms ${delay}ms cubic-bezier(.3,1.5,.5,1) both` }}
      />
      <path
        d="M5.2 9.3l2.5 2.5 5-5.3"
        fill="none"
        stroke="var(--verdigris)"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="14"
        style={{ animation: `ac-draw 240ms ${delay + 160}ms var(--ease) both` }}
      />
    </svg>
  );
}

/** The 72px seal: it pops, fills and draws its check when everything passed. */
function Seal({ ok }: { ok: boolean }) {
  return (
    <span aria-hidden="true" className={cx("inline-flex size-[72px] shrink-0")} style={{ animation: "ac-pop 420ms var(--ease) both" }}>
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r="36" fill={ok ? "var(--verdigris-tint)" : "var(--caution-tint)"} />
        <circle cx="36" cy="36" r="30" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="0.5 5" stroke={ok ? "var(--verdigris)" : "var(--caution)"} />
        {ok ? (
          <>
            <circle
              cx="36"
              cy="36"
              r="22"
              fill="var(--verdigris)"
              style={{ transformBox: "fill-box", transformOrigin: "center", animation: "ac-fill 420ms 120ms cubic-bezier(.3,1.5,.5,1) both" }}
            />
            <g transform="translate(14 14) scale(2)">
              <path
                d="M6.5 11.5l3 3 6-6.5"
                fill="none"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="14"
                stroke="var(--on-verdigris)"
                style={{ animation: "ac-draw 300ms 320ms var(--ease) both" }}
              />
            </g>
          </>
        ) : (
          <path d="M36 24v14M36 46v.5" stroke="var(--caution)" strokeWidth="3.5" strokeLinecap="round" />
        )}
      </svg>
    </span>
  );
}
