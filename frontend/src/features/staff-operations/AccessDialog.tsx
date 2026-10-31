import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";

export function AccessDialog({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useUnsavedChangesGuard(busy, "An access update is still pending. If you leave, review the saved assignments before trying again.");
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    if (element?.showModal) element.showModal();
    else element?.setAttribute("open", "");
    return () => { element?.close?.(); previous?.focus(); };
  }, []);
  return <dialog className="staff-access-dialog" ref={dialog} aria-labelledby={titleId} aria-busy={busy || undefined} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2 id={titleId}>{title}</h2><button type="button" disabled={busy} onClick={() => { if (!busy) onClose(); }} aria-label="Close"><X size={20} /></button></header>
    {children}
  </dialog>;
}
