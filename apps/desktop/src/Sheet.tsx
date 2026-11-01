import type { ReactNode } from "react";
import { Dialog } from "./ui";

/**
 * A floating sheet over the window, closed with Escape or a click outside. A thin
 * wrapper over the Dialog primitive; new code can use Dialog directly.
 */
export function Sheet({ title, intro, children, onClose }: { title: string; intro: string; children: ReactNode; onClose: () => void }) {
  return (
    <Dialog title={title} intro={intro} onClose={onClose}>
      {children}
    </Dialog>
  );
}
