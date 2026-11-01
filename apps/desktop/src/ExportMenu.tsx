import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Printer, Share } from "lucide-react";
import { meetingExport, meetingMarkdown, type ExportOptions, type MeetingExport, type Meeting } from "@aftercall/core";
import { IconButton, Menu, cx, toast } from "./ui";

/** Said once, in the menu: what leaving Aftercall means for a copy. */
export const EXPORT_NOTE = "Copying puts the text on your clipboard. Copies and PDFs aren't encrypted, and Delete everything can't remove them.";

/**
 * The meeting page's Export menu: copy the meeting as Markdown, or print it (the
 * macOS print panel's PDF button saves it as a PDF). Your notes and the transcript
 * stay out unless you tick them, each time the page opens. Printing reads the
 * printable page this keeps in the document, hidden on screen (styles.css, @media print).
 */
export function ExportMenu({ meeting, sample, onNear, me }: { meeting: Meeting; sample?: ExportOptions["sample"]; onNear?: boolean; me?: readonly string[] }) {
  const [transcript, setTranscript] = useState(false);
  const [yourNotes, setYourNotes] = useState(false);
  const opts: ExportOptions = { transcript, yourNotes, sample, onNear, me };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(meetingMarkdown(meeting, opts));
      toast({ text: "Copied as Markdown", tone: "verdigris" });
    } catch (e) {
      toast({ text: `Couldn't copy: ${e instanceof Error ? e.message : String(e)}`, tone: "record" });
    }
  };
  // In the Mac app, Tauri's window.print opens the macOS print panel and returns a promise; browsers return nothing.
  const print = () =>
    Promise.resolve((window.print as () => unknown)()).catch((e: unknown) =>
      toast({ text: `Couldn't open the print panel: ${e instanceof Error ? e.message : String(e)}`, tone: "record" }),
    );

  return (
    <>
      <Menu
        label="Export this meeting"
        align="end"
        width={288}
        note={EXPORT_NOTE}
        trigger={(p) => (
          <IconButton {...p} aria-label="Export" tooltip="Export this meeting" tooltipSide="bottom" size="sm">
            <Share size={14} strokeWidth={2} aria-hidden="true" />
          </IconButton>
        )}
        items={[
          { label: "Copy as Markdown", icon: <Copy size={14} strokeWidth={2} aria-hidden="true" />, onSelect: copy },
          { label: "Print or save as PDF…", icon: <Printer size={14} strokeWidth={2} aria-hidden="true" />, onSelect: () => void print() },
          null,
          ...(meeting.yourNotes?.trim() ? [{ label: "Include your notes", checked: yourNotes, onSelect: () => setYourNotes((v) => !v) }] : []),
          { label: "Include the transcript", checked: transcript, onSelect: () => setTranscript((v) => !v) },
        ]}
      />
      {createPortal(<PrintPage x={meetingExport(meeting, opts)} />, document.body)}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 [break-inside:auto]">
      <h2 className="t-section m-0 text-ink [break-after:avoid]">{title}</h2>
      {children}
    </section>
  );
}

/**
 * The meeting as a printed page: one column, ink on white in the app's type, whatever
 * the app's theme. Shown only when printing.
 */
export function PrintPage({ x }: { x: MeetingExport }) {
  return (
    <div className="print-only bg-elevated text-ink" data-theme="light" aria-hidden="true">
      <article className="mx-auto flex max-w-[640px] flex-col gap-7">
        <header className="flex flex-col gap-2.5">
          <h1 className="t-display m-0">{x.title}</h1>
          {x.sample && <p className="m-0 text-ink-2">{x.sample}</p>}
          <p className="m-0 text-[13px] text-ink-2">
            {[x.date, x.length, x.project].join(" · ")}
            {x.people && (
              <>
                <br />
                {x.people}
              </>
            )}
          </p>
        </header>

        {x.summary.trim() && <p className="t-reading m-0 whitespace-pre-line">{x.summary}</p>}

        {x.yourNotes && (
          <Section title="Your notes, typed during the call">
            <p className="m-0 font-serif text-[16px] leading-[25px] whitespace-pre-line">{x.yourNotes}</p>
          </Section>
        )}

        {x.decisions.length > 0 && (
          <Section title="Decisions">
            <ol className="m-0 flex list-decimal flex-col gap-1 pl-[22px] font-serif text-[16px] leading-[25px]">
              {x.decisions.map((d, i) => (
                <li key={`${i}-${d}`} className="[break-inside:avoid]">
                  {d}
                </li>
              ))}
            </ol>
          </Section>
        )}

        {x.actionItems.length > 0 && (
          <Section title="Action items">
            <ul className="m-0 flex list-none flex-col p-0">
              {x.actionItems.map((a, i) => (
                <li key={`${i}-${a.text}`} className="flex items-start gap-2.5 border-b border-hairline py-2 [break-inside:avoid]">
                  <span className={cx("mt-[3px] inline-flex size-[15px] shrink-0 items-center justify-center rounded-[4px] border", a.done ? "border-ink bg-ink text-elevated" : "border-border")}>
                    {a.done && <Check size={11} strokeWidth={3} aria-hidden="true" />}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cx("text-[14px] leading-[21px]", a.done && "text-ink-2 line-through")}>
                      {a.text}
                      {a.edited && <span className="text-ink-2 no-underline"> (edited by you)</span>}
                    </span>
                    {(a.owner || a.due || a.note) && <span className="text-[12px] leading-[17px] text-ink-2">{[a.owner, a.due, a.note].filter(Boolean).join(" · ")}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {x.followUps.length > 0 && (
          <Section title="Follow-ups">
            <ul className="m-0 flex list-none flex-col p-0">
              {x.followUps.map((f, i) => (
                <li key={`${i}-${f.title}`} className="flex flex-col border-b border-hairline py-2 [break-inside:avoid]">
                  <span className="text-[14px] leading-[21px] font-semibold">{f.title}</span>
                  <span className="text-[12px] leading-[17px] text-ink-2">{f.status}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Verification">
          {x.verification.map((l) => (
            <p key={l} className="m-0 text-[13px] leading-[19px] text-ink-2">
              {l}
            </p>
          ))}
        </Section>

        {x.transcript && (
          <Section title="Transcript">
            {x.transcript.length === 0 && <p className="m-0 text-ink-2">This meeting has no transcript.</p>}
            <div className="flex flex-col gap-2">
              {x.transcript.map((l, i) => (
                <p key={`${l.at}-${i}`} className="m-0 font-serif text-[15px] leading-[23px] [break-inside:avoid]">
                  <span className="font-mono text-[11px] text-ink-2">{l.at}</span> <span className="font-sans text-[13px] font-semibold">{l.speaker}</span> {l.text}
                </p>
              ))}
            </div>
          </Section>
        )}

        <footer className="border-t border-hairline pt-3 text-[12px] text-ink-2">{x.footer}</footer>
      </article>
    </div>
  );
}
