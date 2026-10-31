import { visitDate } from "./VisitPrimitives";
import type { VisitHistory as HistoryEntry } from "./visitApi";

const actionLabel: Record<HistoryEntry["action"], string> = { arranged: "Visit arranged", changed: "Visit changed", cancelled: "Visit cancelled", movement_recorded: "Movement recorded" };
export function VisitHistory({ entries, hasMore, timezone }: { entries: HistoryEntry[]; hasMore: boolean; timezone: string }) {
  if (!entries.length) return null;
  return <details className="visits-history"><summary>History</summary>
    {hasMore ? <p className="visits-caption">Showing the latest {entries.length} changes.</p> : null}
    <ol>{entries.map(entry => <li key={entry.revision}>
      <strong>{entry.action === "movement_recorded" && entry.last_movement ? `${entry.last_movement.direction === "in" ? "Arrival" : "Departure"} recorded · ${entry.last_movement.observed_count} ${entry.last_movement.observed_count === 1 ? "person" : "people"}` : actionLabel[entry.action]}</strong>
      <small>{entry.actor.label} · {visitDate(entry.recorded_at, timezone)}</small>
      {entry.action === "changed" || entry.action === "arranged" ? <><p>{entry.title}{entry.guest_label || entry.guest_name ? ` · ${entry.guest_label ?? entry.guest_name}` : ""}</p><small>{visitDate(entry.starts_at, timezone)} – {visitDate(entry.ends_at, timezone)}{entry.place_label ? ` · ${entry.place_label}` : ""}</small>{entry.contact_label ? <small>Contact: {entry.contact_label}</small> : null}</> : entry.action === "movement_recorded" && entry.last_movement ? <small>Observed {visitDate(entry.last_movement.occurred_at, timezone)}</small> : null}
    </li>)}</ol>
  </details>;
}
