import { useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { encodeLineDisclosure, formatClock, lineCheck, makeLineDisclosure, speakerLabel, type Attendee, type Meeting } from "@aftercall/core";
import { VERIFY_URL } from "./near";
import type { SavedNotes } from "./nearai";
import { Button, Dialog } from "./ui";

/**
 * "Share this line": a link to /verify that shows one transcript line and checks it is part
 * of the transcript this meeting's proof on NEAR commits to. The sheet says exactly what the
 * link shows; the link is made only after the line checks out on this Mac.
 */
export function ShareLineSheet({ meeting, saved, index, others, onClose }: { meeting: Pick<Meeting, "transcript">; saved: SavedNotes; index: number; others: Attendee[]; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const made = useMemo((): { link: string; owner: string; lines: number } | { error: string } => {
    if (!saved.onChain) return { error: "Record this meeting's proof on NEAR first, from Verify. The link checks the line against it." };
    try {
      const { network, contract, owner } = saved.onChain;
      const d = makeLineDisclosure({ network, contract, owner }, saved.proof, meeting.transcript, saved.lineKey, index);
      // The same check /verify runs on the line, before anything is copied.
      if (!lineCheck(d.bundle, d).ok) throw new Error("LINE_TREE_MISMATCH");
      return { link: `${VERIFY_URL}#${encodeLineDisclosure(d)}`, owner, lines: meeting.transcript.length };
    } catch (e) {
      return {
        error: /NO_LINE_TREE/.test(String(e))
          ? "This meeting's proof was made before lines could be shared."
          : "The transcript on this Mac no longer matches its proof, so this line can't be shared.",
      };
    }
  }, [saved, meeting.transcript, index]);

  const line = meeting.transcript[index];
  if (!line) return null;
  const you = line.speaker === "you";
  const shown = you ? "You" : speakerLabel("others", others);
  const named = !you && shown !== "Others";

  const copy = async () => {
    if (!("link" in made)) return;
    await navigator.clipboard.writeText(made.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Dialog onClose={onClose} title="Share this line" intro="Anyone with the link can check that this line is in this meeting's proof on NEAR." width={520}>
      <figure className="m-0 flex flex-col gap-1.5 rounded-sm bg-well px-4 py-3">
        <figcaption className="flex items-center gap-2 text-[12px] text-muted">
          <span className="font-semibold text-ink-2">{shown}</span>
          <span className="font-mono">{formatClock(line.at)}</span>
        </figcaption>
        <blockquote className="selectable m-0 font-serif text-[17px] leading-[26px] text-ink">“{line.text}”</blockquote>
      </figure>

      {"link" in made ? (
        <>
          <dl className="m-0 grid grid-cols-[112px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px] leading-[19px]">
            <dt className="text-muted">The link shows</dt>
            <dd className="m-0 text-ink-2">
              This line word for word. {you ? "That it came from your mic" : named ? `That it came from the call's side, not ${shown}'s name` : "That it came from the call's side"}. {formatClock(line.at)} into the call, and when the call started. Your NEAR account ({made.owner}), the proof's checks, and that the transcript has {made.lines} lines.
            </dd>
            <dt className="text-muted">Not in it</dt>
            <dd className="m-0 text-ink-2">The title, the other lines, the notes and your notes.</dd>
          </dl>
          <p className="m-0 text-[13px] leading-[19px] text-ink-2">
            It proves the line is in the transcript your Mac committed to on NEAR, not that anyone else heard it. Whoever gets the link can read the line.
          </p>
        </>
      ) : (
        <p role="status" className="m-0 text-[13px] leading-[19px] text-caution">
          {made.error}
        </p>
      )}

      <div className="flex justify-end gap-2.5">
        <Button onClick={onClose}>{"link" in made ? "Cancel" : "Close"}</Button>
        {"link" in made && (
          <Button variant="primary" icon={<Copy size={14} aria-hidden="true" />} onClick={copy}>
            {copied ? "Link copied" : "Copy link"}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
