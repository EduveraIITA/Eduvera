import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Info, SlidersHorizontal, Maximize, Minimize, Search, CalendarDays, Activity, X } from "lucide-react";
import type { CampusMapPanel } from "./sceneMapPresentation";
import { useCampusMapImmersive } from "./useCampusMapImmersive";

export function CampusMapWorkspace({ map, panel, title, panelContent, onPanel, expanded, onExpanded, expandedContext, onExpandedChange, dialogOpen, hasPersonal, hasOperations, children }: {
  map: ReactNode; panel: CampusMapPanel | null; title: string; panelContent: ReactNode; onPanel: (panel: CampusMapPanel | null) => void;
  expanded: boolean; onExpanded: (value: boolean) => void; expandedContext?: ReactNode; onExpandedChange?: (value: boolean) => void;
  dialogOpen: boolean; hasPersonal: boolean; hasOperations: boolean; children?: ReactNode;
}) {
  const expandRef = useRef<HTMLButtonElement>(null), toolsRef = useRef<HTMLButtonElement>(null), contentRef = useRef<HTMLDivElement>(null), triggerRef = useRef<HTMLElement | SVGElement | null>(null);
  const previousPanel = useRef<CampusMapPanel | null>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  useCampusMapImmersive(expanded, expandRef, onExpandedChange);
  const open = (value: CampusMapPanel | null) => {
    if (value && value !== panel && panel !== "directions") {
      const active = document.activeElement;
      triggerRef.current = active?.closest(".campus-map-workspace__panel") ? toolsRef.current : active instanceof HTMLElement || active instanceof SVGElement ? active : null;
    }
    onPanel(value); setDetailsExpanded(false);
    if (!value) (triggerRef.current?.isConnected ? triggerRef.current : toolsRef.current)?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = panel && ["search", "layers", "day", "operations", "information"].includes(panel) ? scrollPositions.current.get(panel) ?? 0 : 0;
  }, [panel, title]);
  useEffect(() => {
    const changed = previousPanel.current !== panel;
    previousPanel.current = panel;
    if (changed && panel && !dialogOpen) {
      const active = document.activeElement;
      if (active && contentRef.current?.contains(active)) return;
      if ((active instanceof HTMLElement || active instanceof SVGElement) && active !== document.body && active.isConnected && !active.closest(".campus-map-workspace__panel")) triggerRef.current = active;
      contentRef.current?.focus({ preventScroll: true });
    }
  }, [panel, dialogOpen]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || dialogOpen || event.defaultPrevented || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
      if (expanded) { event.preventDefault(); onExpanded(false); }
      else if (panel) { event.preventDefault(); onPanel(null); (triggerRef.current?.isConnected ? triggerRef.current : toolsRef.current)?.focus({ preventScroll: true }); }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [expanded, panel, dialogOpen, onExpanded, onPanel]);
  return <div className={`campus-map-workspace${expanded ? " campus-map-workspace--expanded" : ""}`} data-panel={panel ?? "none"} data-details-expanded={detailsExpanded || undefined} aria-label="Campus map workspace" role="region">
    {expanded ? <h1 className="campus-scene-visually-hidden">Virtual campus</h1> : null}
    {expanded && expandedContext ? <div className="campus-map-workspace__context">{expandedContext}</div> : null}
    <div className="campus-map-workspace__body" inert={dialogOpen || undefined} aria-hidden={dialogOpen || undefined}>
      <div className="campus-map-workspace__map campus-scene-map-frame">
        {map}
        <div className="campus-map-workspace__top" aria-label="Map tools">
          <div className="campus-map-workspace__search-tools">
            <button type="button" className="campus-map-control campus-map-control--search" aria-label="Find a place" aria-expanded={panel === "search"} onClick={() => open(panel === "search" ? null : "search")}><Search size={19} /><span>Find a place</span></button>
            <button ref={toolsRef} type="button" className="campus-map-control campus-map-control--square" aria-label="Map tools" title="Map tools" aria-expanded={panel === "layers"} onClick={() => open(panel === "layers" ? null : "layers")}><SlidersHorizontal size={19} /></button>
          </div>
          <button ref={expandRef} type="button" className="campus-map-control campus-map-control--square" aria-label={expanded ? "Exit full screen" : "Full screen map"} aria-pressed={expanded} onClick={() => onExpanded(!expanded)}>{expanded ? <Minimize size={20} /> : <Maximize size={20} />}</button>
        </div>
        {children}
      </div>
      {panel ? <aside className="campus-map-workspace__panel" aria-label={panel === "layers" ? "Map tools" : title}>
        <header className="campus-map-workspace__panel-heading"><div><h2>{panel === "layers" ? "Map tools" : title}</h2></div><button type="button" className="campus-scene-icon-button campus-map-workspace__expand-details" aria-label={detailsExpanded ? "Collapse map details" : "Expand map details"} aria-expanded={detailsExpanded} onClick={() => setDetailsExpanded(value => !value)}>{detailsExpanded ? <ChevronDown size={19} /> : <ChevronUp size={19} />}</button><button type="button" className="campus-scene-icon-button" aria-label={panel === "directions" ? "Close place directions" : panel === "place" ? "Close place details" : panel === "search" ? "Close place list" : "Close map panel"} onClick={() => open(panel === "directions" ? "place" : null)}><X size={20} /></button></header>
        <div className="campus-map-workspace__panel-content" ref={contentRef} tabIndex={-1} onScroll={event => { if (panel && ["search", "layers", "day", "operations", "information"].includes(panel)) scrollPositions.current.set(panel, event.currentTarget.scrollTop); }}>
          {panel === "layers" ? <nav className="campus-map-tools" aria-label="Campus map tools">
            {hasPersonal ? <button type="button" onClick={() => open("day")}><CalendarDays size={19} /><span>My day</span><ChevronRight size={17} /></button> : null}
            {hasOperations ? <button type="button" onClick={() => open("operations")}><Activity size={19} /><span>Campus activity</span><ChevronRight size={17} /></button> : null}
            <button type="button" onClick={() => open("information")}><Info size={19} /><span>About this map</span><ChevronRight size={17} /></button>
          </nav> : null}
          {panelContent}
        </div>
      </aside> : null}
    </div>
  </div>;
}
