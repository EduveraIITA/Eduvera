import { ChevronDown, LocateFixed, MapPin } from "lucide-react";
import type { RiderStop } from "./stopFocus";
import { coordinates } from "./stopFocus";

export function RiderFocusControls({ mode, setMode, total, groups, group, selected, select, message, distance, nearby, disabled }: {
  mode: "all" | "nearby"; setMode: (value: "all" | "nearby") => void; total: number; groups: RiderStop[]; group: RiderStop | null;
  selected: string; select: (id: string) => void; message: string; distance: number | null; nearby: boolean; disabled: boolean;
}) {
  const point = group && coordinates(group.stop);
  return <div className="rider-focus-controls">
    <div className="rider-focus-switch" role="group" aria-label="Rider view">
      <button type="button" aria-pressed={mode === "all"} disabled={disabled} onClick={() => setMode("all")}>All riders · {total}</button>
      <button type="button" aria-pressed={mode === "nearby"} disabled={disabled} onClick={() => setMode("nearby")}><LocateFixed size={16} aria-hidden="true"/>Stop focus</button>
    </div>
    {mode === "nearby" ? <div className="rider-focus-context">
      <label><span className="rider-focus-label">Stop</span><span className="rider-focus-select"><select aria-label="Focused stop" disabled={disabled || !groups.length} value={groups.some(g => g.stop.id === selected) ? selected : "auto"} onChange={event => select(event.target.value)}><option value="auto">Follow location</option>{groups.map(item => <option key={item.stop.id} value={item.stop.id}>{item.stop.sequence}. {item.stop.name} · {item.riders.length}</option>)}</select><ChevronDown size={16} aria-hidden="true"/></span></label>
      {group ? <><div className="rider-focus-heading"><MapPin size={18} aria-hidden="true"/><div><h3>{group.stop.name}</h3><p>{group.action} · {group.riders.length} {group.riders.length === 1 ? "learner" : "learners"}{distance === null ? "" : ` · ${distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`} away`}</p></div>{nearby ? <span className="rider-focus-nearby">Nearby</span> : null}</div>
        <p className="rider-focus-hint" role="status">{message}</p>
        {point ? <a href={`https://www.google.com/maps/dir/?api=1&destination=${point.latitude},${point.longitude}&travelmode=walking`} target="_blank" rel="noreferrer">Walking directions to this stop ↗</a> : null}
      </> : <p role="status">All riders accounted for. You can review them in All riders.</p>}
    </div> : null}
  </div>;
}
