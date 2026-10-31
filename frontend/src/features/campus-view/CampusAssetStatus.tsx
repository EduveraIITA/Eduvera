import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { portalReturnState } from "../navigation/portalReturnState";
import { sessionActionHref } from "../teaching-sessions/api";
import { repairStateLabels } from "../facilities/FacilitiesPrimitives";
import { campusAssetLabel, campusAssetUnavailable } from "./campusOperational";
import type { CampusMapAsset } from "./campusOperational.types";

export function CampusAssetStatus({ asset, isLamp, timezone, showReport = true }: { asset: CampusMapAsset; isLamp: boolean; timezone: string; showReport?: boolean }) {
  const location = useLocation(), origin = `${location.pathname}${location.search}`;
  const reportHref = `/areas/facilities?${new URLSearchParams({ report: "1", holding_id: asset.holding_id, ...(asset.space_id ? { space_id: asset.space_id } : {}) })}`;
  const availability = { available: "Available", unavailable: "Unavailable", retired: "Retired", unknown: "Not confirmed" }[asset.native_state];
  const updated = asset.signal.updated_at && Number.isFinite(Date.parse(asset.signal.updated_at))
    ? new Intl.DateTimeFormat("en-IN", { timeZone: timezone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(asset.signal.updated_at)) : null;
  return <section className="campus-asset-status" aria-label={`${asset.name} status`}>
    <h3>Asset status</h3><dl><div><dt>Resource availability</dt><dd>{availability}</dd></div><div><dt>Reported asset status</dt><dd>{campusAssetLabel(asset)}</dd></div></dl>
    {asset.signal.open_reports > 0 ? <p>{asset.signal.open_reports} open {asset.signal.open_reports === 1 ? "report" : "reports"}{updated ? ` · Updated ${updated}` : ""}</p> : updated ? <p>Updated {updated}</p> : null}
    {isLamp && campusAssetUnavailable(asset) ? <p>Shown unlit because {asset.native_state === "unavailable" ? "this resource is marked unavailable" : "an active report marks this lamp as not working"}. This is not a physical switch reading.</p> : isLamp ? <p>Lighting is illustrative; its physical switch state is not measured.</p> : null}
    <div className="campus-asset-actions">{showReport && asset.reportable ? <Link className="campus-scene-button" to={reportHref} state={portalReturnState(origin, reportHref)}>Report problem</Link> : null}{asset.repairs.map(repair => {
      const href = sessionActionHref(repair.target_path);
      return href ? <Link key={repair.id} className="campus-asset-repair-link" to={href} state={portalReturnState(origin, href)}><span>{repair.action_label}<small>{repairStateLabels[repair.state]}</small></span><ChevronRight size={16} aria-hidden="true" /></Link> : null;
    })}</div>
    <details><summary>About this status</summary><p>Resource availability and reported problems are separate records. Reports are not verified physical measurements. Descriptions, photos and people remain private; only repairs you can access have an action here.</p></details>
  </section>;
}
