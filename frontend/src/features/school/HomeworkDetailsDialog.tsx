import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { ParentHomeData } from "../../pages/parent/parentTypes";
import "./attendance-ranking.css";
import "./homework-details.css";

export function HomeworkDetailsDialog({ items = [], total, onToggle, onClose }: {
  items?: ParentHomeData["homeworkItems"];
  total: number | undefined;
  onToggle?: (id: string, completed: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"pending" | "completed">("pending");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key === "Tab") {
        const controls = Array.from(document.querySelectorAll<HTMLElement>(".homework-details button:not(:disabled)"));
        if (!controls.length) return;
        const next = controls.indexOf(document.activeElement as HTMLElement) + (event.shiftKey ? -1 : 1);
        if (next < 0 || next >= controls.length) { event.preventDefault(); controls[next < 0 ? controls.length - 1 : 0]?.focus(); }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, [onClose]);
  const pending = items.filter((item) => !item.completedAt);
  const completed = items.filter((item) => item.completedAt);
  const displayed = tab === "pending" ? pending : completed;
  return createPortal(
    <div className="attendance-ranking__overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="attendance-ranking homework-details" role="dialog" aria-modal="true" aria-labelledby="homework-details-title">
        <header className="attendance-ranking__header">
          <div><span className="attendance-ranking__eyebrow">Term homework</span><h2 id="homework-details-title">Homework details</h2>
            <p>{total ?? items.length} assignments · Select a status to review the list</p></div>
          <button ref={closeRef} type="button" className="attendance-ranking__close" aria-label="Close homework details" onClick={onClose}><X size={20} /></button>
        </header>
        <div className="homework-details__tabs" role="tablist" aria-label="Homework status">
          <button type="button" role="tab" aria-selected={tab === "pending"} onClick={() => setTab("pending")}>Pending ({pending.length})</button>
          <button type="button" role="tab" aria-selected={tab === "completed"} onClick={() => setTab("completed")}>Completed ({completed.length})</button>
        </div>
        {error && <p className="homework-details__error" role="alert">{error}</p>}
        <div className="attendance-ranking__list homework-details__list" role="tabpanel" aria-label={`${tab} homework`}>
          {displayed.length ? displayed.map((item) => <article className="homework-details__item" key={item.id}>
            <div><strong>{item.title}</strong><small>{item.subject ?? "Class homework"}{item.dueAt ? ` · Due ${new Date(item.dueAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}</small>
              {item.body && <p>{item.body}</p>}</div>
            {onToggle && <button type="button" disabled={busy !== null} onClick={async () => {
              setBusy(item.id); setError("");
              try { await onToggle(item.id, tab === "pending"); } catch { setError("Could not update homework. Please try again."); } finally { setBusy(null); }
            }}>{busy === item.id ? "Saving..." : tab === "pending" ? "Mark complete" : "Move to pending"}</button>}
          </article>) : <p className="attendance-ranking__empty">{tab === "pending" ? "No pending homework." : "No homework marked complete yet."}</p>}
        </div>
        <footer>Completed means marked complete by the student or a linked guardian; it is not a school-verified submission.</footer>
      </section>
    </div>, document.body);
}
