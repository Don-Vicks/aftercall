import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Pencil } from "lucide-react";
import { FIELD_WORDS, cleanItemFields, type ActionItem, type ItemFields } from "@aftercall/core";
import { Button, IconButton, Input, cx } from "./ui";

/**
 * Editing an action item's text, owner and due date, used on the meeting page and on
 * Action items. `fields` null puts back what the model signed. Saved in notes.json by
 * the app (`edit_action_item`); the signed notes and their proof never change.
 */
export type EditItem = (meetingId: string, itemId: string, fields: ItemFields | null) => void;

/** The signed item behind a meeting's action item, for "Restore original". */
export type OriginalOf = (meetingId: string, itemId: string) => ItemFields | null;

/**
 * Whether a row is being edited, and the Edit button's id so focus goes back to it
 * when the editor closes (Save, Cancel or Escape). The id comes from the row's key
 * (meeting and item), not the component, because a new due date or owner can move the
 * row to another section, where it mounts again. When the row has left the page (another
 * tab now holds it), `onGone` picks what gets focus instead.
 */
export function useItemEditing(rowKey: string, onGone?: () => void) {
  const [editing, setEditing] = useState(false);
  const buttonId = `edit-item-${rowKey}`;
  const close = () => {
    setEditing(false);
    // After React has drawn the saved row, wherever it now is.
    requestAnimationFrame(() => {
      const button = document.getElementById(buttonId);
      if (button) button.focus();
      else onGone?.();
    });
  };
  return { editing, open: () => setEditing(true), close, buttonId };
}

/**
 * The quiet pencil, just left of the row's owner and date; it shows on hover and on
 * keyboard focus. It sits over the end of the text column (which keeps room for it),
 * so the owner and date stay flush with the row's right edge.
 */
export function EditItemButton({ id, text, onClick }: { id: string; text: string; onClick: () => void }) {
  return (
    <span className="absolute top-1/2 right-full mr-1.5 flex -translate-y-1/2">
      <IconButton
        id={id}
        size="sm"
        variant="quiet"
        aria-label={`Edit “${text}”`}
        tooltip="Edit"
        onClick={onClick}
        className="opacity-0 transition-opacity duration-(--dur-1) group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Pencil size={14} strokeWidth={2} aria-hidden="true" />
      </IconButton>
    </span>
  );
}

/** "edited", muted, after an item's text. */
export function EditedMark({ item }: { item: ActionItem }) {
  if (!item.edited) return null;
  const what = item.edited.fields.map((f) => FIELD_WORDS[f]).join(", ");
  return (
    <span className="ml-1.5 text-[12px] whitespace-nowrap text-muted">
      edited<span className="sr-only">: {what} changed by you after the notes were signed</span>
    </span>
  );
}

/**
 * The row as a small form: what, who and when, then Save and Cancel. Enter saves,
 * Escape cancels. When the item was edited, "Restore original" shows the signed words
 * and puts them back.
 */
export function ItemEditor({
  item,
  original,
  onSave,
  onRestore,
  onCancel,
  className,
}: {
  item: ActionItem;
  original: ItemFields | null;
  onSave: (fields: ItemFields) => void;
  onRestore: () => void;
  onCancel: () => void;
  className?: string;
}) {
  const [text, setText] = useState(item.text);
  const [owner, setOwner] = useState(item.owner === "Unassigned" ? "" : item.owner);
  const [due, setDue] = useState(item.due ?? "");
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const ids = { text: useId(), owner: useId(), due: useId(), error: useId(), original: useId() };

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const cleaned = cleanItemFields({ text, owner, due });
    if ("error" in cleaned) {
      // Announced by the alert below; focus goes to the text, which is what's wrong.
      setError(cleaned.error);
      textRef.current?.focus();
      return;
    }
    onSave(cleaned.fields);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    onCancel();
  };

  const edited = Boolean(item.edited) && original !== null;
  const signedLine = original ? [original.text, original.owner === "Unassigned" ? "no owner" : original.owner, original.due ?? "no due date"].join(" · ") : "";

  return (
    <form
      onSubmit={submit}
      onKeyDown={onKeyDown}
      aria-label={`Edit “${item.text}”`}
      className={cx("flex w-full flex-col gap-2.5", className)}
      style={{ animation: "ac-in 240ms var(--ease) both" }}
    >
      <label htmlFor={ids.text} className="sr-only">
        What needs doing
      </label>
      <Input
        ref={textRef}
        id={ids.text}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        invalid={Boolean(error)}
        aria-describedby={cx(error && ids.error, edited && ids.original) || undefined}
        className="h-9 text-[15px]!"
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label htmlFor={ids.owner} className="flex items-center gap-2 text-[13px] text-ink-2">
          Owner
          <Input id={ids.owner} value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="No owner" className="h-8 w-32!" />
        </label>
        <label htmlFor={ids.due} className="flex items-center gap-2 text-[13px] text-ink-2">
          Due
          <Input id={ids.due} value={due} onChange={(e) => setDue(e.target.value)} placeholder="e.g. Friday, 13 Nov" className="h-8 w-36!" />
        </label>
        <span className="ml-auto flex items-center gap-2">
          {edited && (
            <Button variant="quiet" size="sm" onClick={onRestore}>
              Restore original
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit">
            Save
          </Button>
        </span>
      </div>
      {error && (
        <span id={ids.error} role="alert" className="text-[13px] leading-[18px] text-record">
          {error}
        </span>
      )}
      {edited && (
        <span id={ids.original} className="selectable text-[13px] leading-[18px] text-ink-2">
          <span className="text-muted">As signed: </span>
          {signedLine}
        </span>
      )}
    </form>
  );
}
