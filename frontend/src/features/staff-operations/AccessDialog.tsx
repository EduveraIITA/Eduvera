import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function AccessDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    if (element?.showModal) element.showModal();
    else element?.setAttribute("open", "");
    return () => { element?.close?.(); previous?.focus(); };
  }, []);
  return <dialog className="staff-access-dialog" ref={dialog} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><h2 id={titleId}>{title}</h2><button type="button" onClick={onClose} aria-label="Close"><X size={20} /></button></header>
    {children}
  </dialog>;
}
