import { useEffect, type ReactNode } from "react";

/** A floating sheet over the window, closed with Escape or a click outside. */
export function Sheet({ title, intro, children, onClose }: { title: string; intro: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()} className="flex w-[560px] flex-col gap-5 rounded-lg bg-elevated p-8 shadow-float">
        <div className="flex flex-col gap-1.5">
          <h2 className="m-0 font-serif text-[28px] leading-[34px] font-medium tracking-[-0.015em]">{title}</h2>
          <p className="m-0 text-muted">{intro}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
