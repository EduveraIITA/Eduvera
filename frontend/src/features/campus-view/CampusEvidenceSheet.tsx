import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight, X } from "lucide-react";
import type { SceneEvidenceRecord } from "../campus-scenes/sceneOperations.types";
import { portalReturnState } from "../navigation/portalReturnState";
import { sessionActionHref } from "../teaching-sessions/api";

export function CampusEvidenceSheet({ label, records, formatTime, returnFocus, onClose, onInspectPlace }: {
  label: string; records: readonly SceneEvidenceRecord[]; formatTime: (date: Date) => string;
  returnFocus: HTMLElement | SVGElement | null; onClose: () => void; onInspectPlace?: (spaceId: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), title = useRef<HTMLHeadingElement>(null);
  const location = useLocation(), origin = `${location.pathname}${location.search}`;
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    node.showModal(); title.current?.focus();
    const cancel = (event: Event) => { event.preventDefault(); onClose(); };
    node.addEventListener("cancel", cancel);
    return () => { node.removeEventListener("cancel", cancel); if (node.open) node.close(); window.setTimeout(() => returnFocus?.focus(), 0); };
  }, [onClose, returnFocus]);
  return <dialog ref={dialog} className="campus-map-panel" aria-labelledby="campus-evidence-title" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="campus-map-panel__surface">
      <header><div><span>Source records</span><h2 id="campus-evidence-title" ref={title} tabIndex={-1}>{label}</h2></div><button type="button" onClick={onClose} aria-label="Close evidence records"><X size={20} /></button></header>
      <p className="campus-map-panel__intro">{records.length} source {records.length === 1 ? "record" : "records"}. Plans, point events and current bounded evidence retain their source meaning.</p>
      <ol className="campus-evidence-records">{records.map(record => { const href = sessionActionHref(record.targetPath); return <li key={`${record.dimension}:${record.id}`}>
        <strong>{record.title}</strong>{record.detail ? <p>{record.detail}</p> : null}
        <small>{record.dimension} · {record.temporal === "current" ? "Current source window" : record.temporal === "upcoming" ? "Upcoming schedule" : record.temporal === "historical" ? "Historical record" : "Current state unknown"} · {record.sourceLabel}{record.occurredAt && Number.isFinite(Date.parse(record.occurredAt)) ? ` · ${formatTime(new Date(record.occurredAt))}` : ""}</small>
        {record.expectedCount !== undefined ? <p>{record.expectedCount} people expected by this assignment. Not a presence count.</p> : null}
        <div>{record.spaceId && onInspectPlace ? <button type="button" onClick={() => onInspectPlace(record.spaceId!)}>Inspect linked place</button> : !record.spaceId ? <small>No mapped campus place</small> : null}{href ? <Link to={href} state={portalReturnState(origin, href)}>Open source <ChevronRight size={16} /></Link> : null}</div>
      </li>; })}</ol>
    </div>
  </dialog>;
}
