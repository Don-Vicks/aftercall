import { useEffect, useRef } from "react";

/**
 * Open overlays (dialogs, menus), newest last. Escape goes only to the topmost one:
 * this listener is registered when the module loads, before any component's, and
 * stops the key from reaching anything else while an overlay is open.
 */
interface Layer {
  id: number;
  onEscape: () => void;
}

const stack: Layer[] = [];
let nextId = 1;

if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || stack.length === 0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      stack[stack.length - 1].onEscape();
    },
    true,
  );
}

/**
 * Puts an overlay on the stack while `active`. Returns `isTop()`, true while nothing
 * newer is open above it (focus traps use it to stand aside for a menu on top).
 */
export function useLayer(active: boolean, onEscape: () => void): () => boolean {
  const escape = useRef(onEscape);
  escape.current = onEscape;
  const id = useRef(0);
  useEffect(() => {
    if (!active) return;
    const layer = { id: nextId++, onEscape: () => escape.current() };
    id.current = layer.id;
    stack.push(layer);
    return () => {
      const i = stack.indexOf(layer);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
  return () => stack.length > 0 && stack[stack.length - 1].id === id.current;
}

/** True while any dialog or menu is open. */
export const anyLayerOpen = () => stack.length > 0;

/** Every element Tab can reach inside `root`, in order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  const sel = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
  return Array.from(root.querySelectorAll<HTMLElement>(sel)).filter((el) => !el.hasAttribute("inert") && el.getClientRects().length > 0);
}
