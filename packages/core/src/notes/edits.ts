import type { ActionItem, EditedField, ItemEdit, Meeting } from "../meeting.ts";
import type { Notes } from "./schema.ts";

/**
 * Your edits to action items after the notes were signed. The model's signed output
 * (notes.action_items, covered by the proof's notesHash) never changes; the meeting's
 * action items carry the edits. Item ids are `a{i+1}` for index i in notes.action_items,
 * so the signed original of any item can always be found and restored.
 *
 * The Mac app saves edits in Rust (notes_file.rs, `edit_item`) with the same rules;
 * these functions do it in memory for the browser preview and compare for Verify.
 */

export const ITEM_TEXT_MAX = 300;
export const ITEM_OWNER_MAX = 80;
export const ITEM_DUE_MAX = 60;

/** The parts of an action item you can edit. */
export interface ItemFields {
  text: string;
  owner: string;
  due?: string;
}

/** How each field is named to people: "text, due date". */
export const FIELD_WORDS: Record<EditedField, string> = { text: "text", owner: "owner", due: "due date" };

const FIELDS: EditedField[] = ["text", "owner", "due"];

/** The index in notes.action_items behind an item id ("a3" is 2), or -1. */
export function signedIndex(id: string): number {
  const m = /^a([1-9]\d{0,3})$/.exec(id);
  return m ? Number(m[1]) - 1 : -1;
}

/** Fields as they are saved: trimmed, an empty owner is "Unassigned", an empty due date is none. */
function tidy(f: { text: string; owner?: string | null; due?: string | null }): ItemFields {
  const due = (f.due ?? "").trim();
  return { text: f.text.trim(), owner: (f.owner ?? "").trim() || "Unassigned", ...(due ? { due } : {}) };
}

/**
 * The model's signed item behind `id`, tidied the way a save tidies a draft ("Unassigned"
 * when it named no owner), so saving it unchanged is no edit.
 */
export function originalItem(notes: Pick<Notes, "action_items"> | undefined, id: string): ItemFields | null {
  const a = notes?.action_items[signedIndex(id)];
  if (!a) return null;
  return tidy(a);
}

/**
 * A draft as it is saved: trimmed, an empty owner is "Unassigned" and an empty due date
 * is none. An error in plain words when it can't be saved.
 */
export function cleanItemFields(draft: { text: string; owner: string; due?: string }): { fields: ItemFields } | { error: string } {
  const { text, owner, due = "" } = tidy(draft);
  const length = (s: string) => Array.from(s).length;
  if (!text) return { error: "Write what needs doing" };
  if (length(text) > ITEM_TEXT_MAX) return { error: `Keep it under ${ITEM_TEXT_MAX} characters` };
  if (length(owner) > ITEM_OWNER_MAX) return { error: `Keep the owner under ${ITEM_OWNER_MAX} characters` };
  if (length(due) > ITEM_DUE_MAX) return { error: `Keep the due date under ${ITEM_DUE_MAX} characters` };
  return { fields: { text, owner, ...(due ? { due } : {}) } };
}

/** Which fields of `now` differ from the signed original, in a fixed order, both tidied first. */
export function changedFields(original: ItemFields, now: ItemFields): EditedField[] {
  const a = tidy(original);
  const b = tidy(now);
  return FIELDS.filter((f) => (a[f] ?? "") !== (b[f] ?? ""));
}

function withFields(item: ActionItem, fields: ItemFields, edited: ItemEdit | undefined): ActionItem {
  const { due: _due, edited: _edited, ...rest } = item;
  return { ...rest, text: fields.text, owner: fields.owner, ...(fields.due ? { due: fields.due } : {}), ...(edited ? { edited } : {}) };
}

/**
 * The item with your edit applied. `edited` records which fields now differ from the
 * signed original; an edit back to the original clears it. Done, claims and
 * completions are left as they are.
 */
export function applyItemEdit(item: ActionItem, original: ItemFields, fields: ItemFields, at: string): ActionItem {
  const changed = changedFields(original, fields);
  return withFields(item, fields, changed.length ? { at, fields: changed } : undefined);
}

/** The item as the model signed it, keeping whether it's done and what agents did. */
export function restoreItem(item: ActionItem, original: ItemFields): ActionItem {
  return withFields(item, original, undefined);
}

export interface ItemEditSummary {
  id: string;
  /** The item as it reads now. */
  text: string;
  /** As the model signed it. */
  original: ItemFields;
  fields: EditedField[];
}

/**
 * Action items that differ from what the model signed, worked out by comparing the
 * meeting with notes.action_items (not from the `edited` marks, so nothing can hide).
 */
export function itemEdits(meeting: Pick<Meeting, "actionItems">, notes: Pick<Notes, "action_items"> | undefined): ItemEditSummary[] {
  return meeting.actionItems.flatMap((a) => {
    const original = originalItem(notes, a.id);
    if (!original) return [];
    const fields = changedFields(original, { text: a.text, owner: a.owner, ...(a.due ? { due: a.due } : {}) });
    return fields.length ? [{ id: a.id, text: a.text, original, fields }] : [];
  });
}

/** "None", "1 action item (owner)" or "2 action items (text, due date)". */
export function editsLine(edits: ItemEditSummary[]): string {
  if (edits.length === 0) return "None";
  const fields = FIELDS.filter((f) => edits.some((e) => e.fields.includes(f))).map((f) => FIELD_WORDS[f]);
  return `${edits.length} action ${edits.length === 1 ? "item" : "items"} (${fields.join(", ")})`;
}
