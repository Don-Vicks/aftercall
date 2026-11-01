import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { Check } from "lucide-react";
import { isDesktop } from "../recorder";
import { cx } from "../ui";
import type { NotesSave } from "./session";

/** "Saved, encrypted on this Mac", "Saving…", or why it didn't save. */
export function SavedLabel({ save, error, className }: { save: NotesSave; error: string | null; className?: string }) {
  if (save === "idle") return null;
  return (
    <span
      aria-live="polite"
      className={cx("inline-flex items-center gap-1.5 text-[12px] leading-4", save === "error" ? "text-record" : "text-muted", className)}
    >
      {save === "saved" && <Check size={12} strokeWidth={2.2} aria-hidden="true" />}
      {save === "saving"
        ? "Saving…"
        : save === "error"
          ? `Not saved: ${error ?? "try again"}`
          : isDesktop
            ? "Saved, encrypted on this Mac"
            : "Kept in this preview only"}
    </span>
  );
}

/** The serif field you type your notes in, on the live page and in the drawer. */
export const NotesArea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<"textarea">>(function NotesArea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      spellCheck
      {...props}
      className={cx(
        "selectable w-full resize-y rounded-md border border-hairline bg-elevated px-[22px] py-5 font-serif text-[18px] leading-[29px] text-ink shadow-1 outline-none placeholder:text-muted focus:border-verdigris focus:shadow-[0_0_0_1px_var(--verdigris)]",
        className,
      )}
    />
  );
});

/** What the pipeline does with your notes, in one line. */
export const NOTES_HELP = "Aftercall reads these alongside the transcript to decide what matters. Every follow-up still needs a quote from the call.";
