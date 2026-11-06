import { useEffect, useId, useState } from "react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { ChevronRight } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Meeting, Network } from "@aftercall/core";
import { cx, enter, exit } from "./ui";
import { grow } from "./SettingsParts";
import { explorerTx, near } from "./near";
import { isDesktop } from "./recorder";
import { meetingTrail, type TrailEntry } from "./trailEntries";
import type { SavedNotes } from "./nearai";

const shortHash = (h: string) => (h.length > 12 ? `${h.slice(0, 4)}…${h.slice(-4)}` : h);

/**
 * "Where this meeting went": what left the Mac and the secure hardware, who said yes,
 * and what is kept where. Closed by default, like the dropped items under the notes.
 */
export function MeetingTrail({ meeting, saved, sample }: { meeting: Meeting; saved?: SavedNotes; sample?: boolean }) {
  const [open, setOpen] = useState(false);
  const [network, setNetwork] = useState<Network | null>(null);
  const id = useId();
  const still = useReducedMotion();

  // Payments' explorer links need the network; the proof carries its own.
  useEffect(() => {
    if (!isDesktop || !open) return;
    let live = true;
    near
      .getConfig()
      .then((c) => live && setNetwork(c?.network ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open]);

  const entries = meetingTrail({ meeting, saved, network });
  if (!entries.length && !sample) return null;

  return (
    <section aria-label="Where this meeting went" className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        className="press inline-flex w-fit items-center gap-1.5 rounded-sm text-[13px] leading-[19px] text-ink-2 hover:text-ink"
      >
        <ChevronRight size={14} strokeWidth={2} aria-hidden="true" className={cx("text-muted transition-transform duration-(--dur-2) ease-calm", open && "rotate-90")} />
        <span>
          <span className="font-semibold">Where this meeting went</span> · what left, who approved, what's kept
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <m.div
            key="trail"
            id={id}
            initial={still ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto", transition: still ? enter : grow }}
            exit={still ? { opacity: 0, transition: exit } : { opacity: 0, height: 0, transition: exit }}
            className="overflow-hidden"
          >
            {entries.length > 0 && (
              <ol className="m-0 mt-2.5 flex list-none flex-col border-t border-hairline p-0">
                {entries.map((e) => (
                  <Row key={e.id} entry={e} />
                ))}
              </ol>
            )}
            <p className="m-0 mt-2 pl-5 text-[13px] leading-[19px] text-ink-2">
              {sample
                ? "This meeting is made up, so nothing here really left this Mac. A real meeting also lists its notes, its audio and its proof on NEAR."
                : "Built from what this Mac already keeps. Follow-ups keep a clock time only. Agent reads are listed in Coding agents."}
            </p>
          </m.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function Row({ entry: e }: { entry: TrailEntry }) {
  return (
    <li className="flex items-start gap-3 border-b border-hairline py-2.5 pl-5">
      <span className="w-[84px] shrink-0 pt-px font-mono text-[12px] leading-5 text-muted">{e.when ?? "—"}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="selectable text-[14px] leading-5 text-ink">{e.what}</span>
        {e.detail && <span className="selectable text-[13px] leading-[19px] break-words text-ink-2">{e.detail}</span>}
        <span className="text-[12px] leading-4 text-muted">
          {e.who && <>Approved by: {e.who} · </>}
          Kept: {e.kept}
          {e.tx && (
            <>
              {" · "}
              {e.tx.network ? (
                <button
                  type="button"
                  onClick={() => openUrl(explorerTx(e.tx!.network!, e.tx!.hash))}
                  aria-label={`Open transaction ${shortHash(e.tx.hash)} on NEAR`}
                  className="font-mono text-verdigris hover:text-verdigris-hover"
                >
                  {shortHash(e.tx.hash)}
                </button>
              ) : (
                <span className="font-mono">{shortHash(e.tx.hash)}</span>
              )}
            </>
          )}
        </span>
      </span>
    </li>
  );
}
