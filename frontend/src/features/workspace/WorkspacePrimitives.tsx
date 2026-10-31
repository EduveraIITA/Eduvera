import {
  ArrowRight,
  CheckCircle2,
  Clock3,
} from "lucide-react";
import { ProductIcon, productIconForDestination } from "../../components/ProductIcon";
import { InfoSummary } from "../../components/InfoSummary";
import { WorkspaceLink } from "./WorkspaceLink";
import { useLocation } from "react-router-dom";
import { portalReturnState } from "../navigation/portalReturnState";
import type { WorkspaceArea, WorkspaceEntry, WorkspaceIcon, WorkspaceMoreItem, WorkspaceWorkItem } from "./types";

function WorkspaceIconGlyph({ icon, href }: { readonly icon?: WorkspaceIcon | null; readonly href: string }) {
  return <ProductIcon name={productIconForDestination(href, icon)} size={30} />;
}

function EntryContent({ entry }: { readonly entry: WorkspaceEntry }) {
  return <>
    <span className="workspace-record__body">
      <span className="workspace-record__meta">
        {entry.status_label ? <b>{entry.status_label}</b> : null}
        {entry.time_label ? <span>{entry.time_label}</span> : null}
      </span>
      <strong>{entry.title}</strong>
      {entry.detail ? <small>{entry.detail}</small> : null}
      {entry.source_label ? <span className="workspace-record__source">
        {entry.source_label}{entry.source_at ? ` · ${entry.source_at}` : ""}
      </span> : null}
    </span>
    {entry.action_label ? <span className="workspace-record__action">
      {entry.action_label}<ArrowRight size={16} aria-hidden="true" />
    </span> : null}
  </>;
}

export function WorkspaceEntryRow({ entry, prominent = false }: { readonly entry: WorkspaceEntry; readonly prominent?: boolean }) {
  const className = `workspace-record is-${entry.tone ?? "neutral"}${prominent ? " is-prominent" : ""}`;
  if (entry.href) {
    return <WorkspaceLink className={className} href={entry.href} ariaLabel={`${entry.title}${entry.action_label ? `, ${entry.action_label}` : ""}`}>
      <EntryContent entry={entry} />
    </WorkspaceLink>;
  }
  return <article className={className}><EntryContent entry={entry} /></article>;
}

function agendaTime(entry: WorkspaceEntry, timeZone: string) {
  if (!entry.starts_at || !Number.isFinite(Date.parse(entry.starts_at))) return null;
  try {
    const start = new Date(entry.starts_at);
    const end = entry.ends_at && Number.isFinite(Date.parse(entry.ends_at)) ? new Date(entry.ends_at) : null;
    const date = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric' });
    const time = new Intl.DateTimeFormat('en-IN', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true });
    const endDate = end && date.format(end) !== date.format(start) ? date.format(end) : null;
    const clock = !end ? time.format(start) : endDate ? `${time.format(start)}–${time.format(end)}` : time.formatRange(start, end);
    return { date: date.format(start), time: clock, endDate };
  } catch { return null; }
}

/** Today prioritises the activity and its owning action, not repeated metadata. */
export function WorkspaceTodayEntry({ entry, current = false, timeZone = "UTC" }: { readonly entry: WorkspaceEntry; readonly current?: boolean; readonly timeZone?: string }) {
  const timing = agendaTime(entry, timeZone);
  const body = <>
    {timing ? <time className="workspace-agenda-entry__date" dateTime={entry.starts_at!}>{timing.date}</time> : null}
    <span className="workspace-agenda-entry__copy">
      {timing ? <span className="workspace-agenda-entry__time">{timing.time}{timing.endDate ? ` · ends ${timing.endDate}` : ""}</span> : entry.time_label ? <span className="workspace-agenda-entry__time">{entry.time_label}</span> : null}
      <strong>{entry.title}</strong>
      {entry.detail ? <small>{entry.detail}</small> : null}
      {entry.status_label && !["Now", "Next"].includes(entry.status_label) ? <span className="workspace-agenda-entry__status">{entry.status_label}</span> : null}
    </span>
    {entry.href ? <ArrowRight size={19} aria-hidden="true" /> : null}
  </>;
  if (!current) return entry.href
    ? <WorkspaceLink className={`workspace-agenda-entry is-${entry.tone ?? "neutral"}${timing ? " has-timing" : ""}`} href={entry.href} ariaLabel={`${entry.title}${entry.action_label ? `, ${entry.action_label}` : ""}`}>{body}</WorkspaceLink>
    : <article className={`workspace-agenda-entry${timing ? " has-timing" : ""}`}>{body}</article>;

  return <article className={`workspace-current-activity is-${entry.tone ?? "neutral"}`}>
    <div className="workspace-current-activity__context">
      <span className="workspace-current-activity__icon" aria-hidden="true"><ProductIcon name="today" size={30} /></span>
      {entry.time_label ? <p className="workspace-current-activity__time">{entry.time_label}</p> : null}
    </div>
    <h3>{entry.title}</h3>
    {entry.detail ? <p className="workspace-current-activity__detail">{entry.detail}</p> : null}
    {entry.href ? <WorkspaceLink className="workspace-current-activity__action" href={entry.href} ariaLabel={`${entry.title}${entry.action_label ? `, ${entry.action_label}` : ""}`}>
      {entry.action_label ?? "View activity"}<ArrowRight size={18} aria-hidden="true" />
    </WorkspaceLink> : null}
    {entry.source_label ? <details className="workspace-current-activity__evidence">
      <InfoSummary>Schedule details</InfoSummary>
      <p>{entry.source_label}{entry.source_at ? ` · ${entry.source_at}` : ""}</p>
    </details> : null}
  </article>;
}

const workKindLabels: Record<WorkspaceWorkItem["kind"], string> = {
  request: "Request",
  task: "Task",
  offer: "Offer",
};

function WorkKindIcon({ kind }: { readonly kind: WorkspaceWorkItem["kind"] }) {
  return <ProductIcon name={kind === "request" ? "messages" : kind === "offer" ? "responsibilities" : "attendance"} size={28} />;
}

export function WorkspaceWorkRow({ item }: { readonly item: WorkspaceWorkItem }) {
  const location = useLocation();
  return <WorkspaceLink
    className={`workspace-work-item is-${item.urgency}`}
    href={item.href}
    ariaLabel={`${workKindLabels[item.kind]}: ${item.title}, ${item.status_label ? `${item.status_label}, ` : ""}${item.action_label}`}
    state={portalReturnState(`${location.pathname}${location.search}`, item.href)}
  >
    <span className="workspace-work-item__icon" aria-hidden="true"><WorkKindIcon kind={item.kind} /></span>
    <span className="workspace-work-item__body">
      <span className="workspace-work-item__meta">
        <b>{workKindLabels[item.kind]}</b>
        {item.status_label ? <span>{item.status_label}</span> : null}
        {item.due_label && item.due_label !== item.status_label ? <span>{item.due_label}</span> : null}
      </span>
      <strong>{item.title}</strong>
      {item.detail ? <small>{item.detail}</small> : null}
      {item.direction === "waiting" && item.state !== "waiting_for_review" && item.owner ? <small>Sent to {item.owner.label}</small> : null}
      {item.source_label ? <span className="workspace-record__source">
        {item.source_label}{item.source_at ? ` · ${item.source_at}` : ""}
      </span> : null}
    </span>
    <span className="workspace-record__action">{item.action_label}<ArrowRight size={16} aria-hidden="true" /></span>
  </WorkspaceLink>;
}

export function WorkspaceAreaRow({ area }: { readonly area: WorkspaceArea }) {
  return <WorkspaceLink className="workspace-directory-row" href={area.href} ariaLabel={`Open ${area.label}`}>
    <span className="workspace-directory-row__icon" data-icon={area.icon ?? "default"} aria-hidden="true"><WorkspaceIconGlyph icon={area.icon} href={area.href} /></span>
    <span className="workspace-directory-row__body">
      <strong>{area.label}</strong>
      {area.description ? <small>{area.description}</small> : null}
    </span>
    {area.attention_count ? <span className="workspace-directory-row__count" aria-label={`${area.attention_count} items need attention`}>{area.attention_count}</span> : null}
    <ArrowRight className="workspace-directory-row__arrow" size={17} aria-hidden="true" />
  </WorkspaceLink>;
}

export function WorkspaceMoreRow({ item }: { readonly item: WorkspaceMoreItem }) {
  return <WorkspaceLink className="workspace-directory-row" href={item.href} ariaLabel={`Open ${item.label}`}>
    <span className="workspace-directory-row__icon" data-icon={item.icon ?? "default"} aria-hidden="true"><WorkspaceIconGlyph icon={item.icon} href={item.href} /></span>
    <span className="workspace-directory-row__body">
      <strong>{item.label}</strong>
      {item.description ? <small>{item.description}</small> : null}
    </span>
    <ArrowRight className="workspace-directory-row__arrow" size={17} aria-hidden="true" />
  </WorkspaceLink>;
}

export function WorkspaceEmpty({ kind }: { readonly kind: "today" | "work" | "areas" | "more" }) {
  const copy = {
    today: ["No activities or actions to show", "Your available schedule and work will appear here when they become current."],
    work: ["No open work", "Requests, tasks and offers assigned to you or your team will appear here."],
    areas: ["No work areas are active", "Your available areas will appear when a responsibility or capability is assigned."],
    more: ["No additional tools", "Setup and lower-frequency tools will appear here when they are available to you."],
  }[kind];
  return <section className="workspace-empty" aria-labelledby={`workspace-${kind}-empty-title`}>
    <span aria-hidden="true"><CheckCircle2 size={21} /></span>
    <div>
      <h2 id={`workspace-${kind}-empty-title`}>{copy[0]}</h2>
      <p>{copy[1]}</p>
    </div>
  </section>;
}

export function WorkspaceFreshness({ label }: { readonly label: string }) {
  return <p className="workspace-freshness"><Clock3 size={13} aria-hidden="true" />{label}</p>;
}
