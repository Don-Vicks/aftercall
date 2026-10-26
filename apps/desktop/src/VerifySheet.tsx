import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { NOT_PROVEN, encodePublicProof, verifyProof, type Check as ProofCheck } from "@aftercall/core";
import { VERIFY_URL, explorerTx, near } from "./near";
import type { SavedNotes } from "./nearai";
import { nearReady, recordProof } from "./proofs";
import { Button, Pill, SectionLabel, Spinner, cx } from "./ui";

/** The checks behind a meeting's Verified badge, run live against NEAR. */
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setChecks(null);
      setError(null);
      try {
        const onChain = saved.onChain ? await near.getProof(saved.onChain.owner, saved.proof.meetingId) : null;
        if (!cancelled) setChecks(verifyProof(saved.proof, onChain, saved.notes));
      } catch (e) {
        if (!cancelled) {
          setError(`Couldn't read NEAR: ${String(e)}`);
          setChecks(verifyProof(saved.proof, null, saved.notes));
        }
      }
      if (!saved.onChain) setCanRecord(await nearReady());
    })();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
    };
  }, [saved, onClose]);

  const record = async () => {
    setRecording(true);
    setError(null);
    try {
      onUpdated(await recordProof(recordingId, saved));
    } catch (e) {
      setError(String(e));
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

  const allOk = checks?.every((c) => c.ok);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6 pt-14" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Verify"
        onClick={(e) => e.stopPropagation()}
        className="flex w-[640px] flex-col gap-6 rounded-lg bg-elevated p-7 shadow-float"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <span className="t-label text-muted">Verify</span>
            <h2 className="m-0 font-serif text-[28px] leading-[34px] font-medium tracking-[-0.015em]">{saved.meeting.title}</h2>
          </div>
          <div className="flex items-center gap-3">
            {checks && (allOk ? <Pill tone="verdigris">All checks pass</Pill> : <Pill tone="caution">{checks.filter((c) => !c.ok).length} to look at</Pill>)}
            <button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink">
              <X size={18} />
            </button>
          </div>
        </div>

        <ol className="m-0 flex list-none flex-col p-0">
          {checks === null ? (
            <li className="flex items-center gap-3 py-4 text-muted">
              <Spinner /> Reading the proof from NEAR…
            </li>
          ) : (
            checks.map((c, i) => (
              <li key={c.id} className={cx("grid grid-cols-[28px_minmax(0,1fr)] gap-3 border-t border-hairline py-3", i === checks.length - 1 && "border-b")}>
                <span className="pt-0.5">
                  {c.ok ? <Check size={16} strokeWidth={1.75} className="text-verdigris" aria-label="Pass" /> : <X size={16} strokeWidth={1.75} className="text-caution" aria-label="Fail" />}
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="t-title">{c.label}</span>
                  <span className="selectable break-words text-muted">{c.detail}</span>
                </div>
              </li>
            ))
          )}
        </ol>

        {error && <p className="selectable m-0 break-words text-record">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-3">
          {saved.onChain ? (
            <>
              <button
                onClick={() => openUrl(explorerTx(saved.onChain!.network, saved.onChain!.txHash))}
                className="inline-flex items-center gap-1.5 font-semibold text-verdigris hover:text-verdigris-hover"
              >
                <ExternalLink size={13} aria-hidden="true" />
                View on NEAR
              </button>
              <Button variant="primary" onClick={copyLink}>
                <Copy size={13} aria-hidden="true" />
                {copied ? "Link copied" : "Copy public link"}
              </Button>
            </>
          ) : canRecord ? (
            <Button variant="primary" onClick={record} disabled={recording}>
              {recording && <Spinner size={12} />}
              Record proof on NEAR
            </Button>
          ) : (
            <Button onClick={onConnect}>Connect NEAR to record the proof</Button>
          )}
        </div>

        <section className="flex flex-col gap-2 rounded-sm bg-well p-4">
          <SectionLabel>What this does not prove</SectionLabel>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-muted">
            {NOT_PROVEN.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
