import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { portalReturnState } from "../navigation/portalReturnState";
import { sessionActionHref } from "../teaching-sessions/api";
import { campusDateFormatter } from "./campusSceneRecords";
import { campusActivityState } from "./campusOperational";
import type { CampusMapActivity, CampusMapLayer } from "./campusOperational.types";

const labels = { classes: "Classes", events: "Events", maintenance: "Maintenance" };
export function CampusLayerRecords({ items, layer, timezone, page, onPage }: { items: readonly CampusMapActivity[]; layer: Exclude<CampusMapLayer, "none">; timezone: string; page: number; onPage: (page: number) => void }) {
  const location = useLocation(), format = campusDateFormatter(timezone, true);
  const sorted = [...items].sort((a, b) => Number(a.state !== "in_progress") - Number(b.state !== "in_progress") || (a.starts_at ?? "9999").localeCompare(b.starts_at ?? "9999"));
  const pages = Math.max(1, Math.ceil(sorted.length / 8)), current = Math.min(page, pages);
  return <details className="campus-layer-records"><summary>{labels[layer]} in your view · {items.length}</summary>
    <p>{layer === "maintenance" ? "Your authorised repair work. Shared asset reports appear on linked fixtures." : "Scheduled activities you can access. These do not indicate physical presence."}</p>
    {sorted.length ? <ul>{sorted.slice((current - 1) * 8, current * 8).map(item => {
      const href = sessionActionHref(item.target_path), time = item.starts_at && Number.isFinite(Date.parse(item.starts_at)) ? format.format(new Date(item.starts_at)) : null;
      const content = <span><strong>{item.title}</strong><small>{campusActivityState(item)}{time ? ` · ${time}` : ""}{!item.space_id ? " · Place not assigned" : ""}</small></span>;
      return <li key={item.id}>{href ? <Link to={href} state={portalReturnState(`${location.pathname}${location.search}`, href)} aria-label={`${item.title}, ${item.action_label}`}>{content}<ChevronRight size={17} aria-hidden="true" /></Link> : content}</li>;
    })}</ul> : <p role="status">No {labels[layer].toLowerCase()} are available in your current authorised view.</p>}
    {pages > 1 ? <nav aria-label={`${labels[layer]} pages`}><button type="button" className="campus-scene-button" disabled={current === 1} onClick={() => onPage(current - 1)}>Previous</button><span>{current} / {pages}</span><button type="button" className="campus-scene-button" disabled={current === pages} onClick={() => onPage(current + 1)}>Next</button></nav> : null}
  </details>;
}
