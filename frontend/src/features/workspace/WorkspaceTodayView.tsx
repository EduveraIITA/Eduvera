import { ChevronDown, ChevronRight, CircleAlert } from 'lucide-react';
import { WorkspaceEmpty, WorkspaceEntryRow, WorkspaceFreshness, WorkspaceTodayEntry, WorkspaceWorkRow } from './WorkspacePrimitives';
import { WorkspaceLink } from './WorkspaceLink';
import type { WorkspaceFreshness as Freshness, WorkspaceManifest } from './types';
import './workspace-today.css';

function freshnessLabel(freshness: Freshness) {
  if (freshness.state === 'refreshing') return `Updating · ${freshness.as_of}`;
  if (freshness.state === 'stale') return `Last confirmed ${freshness.as_of}`;
  if (freshness.state === 'unknown') return 'Freshness is not available';
  return `Current as of ${freshness.as_of}`;
}

function WorkspaceAttention({ manifest }: { manifest: WorkspaceManifest }) {
  const { attention } = manifest.today;
  const owned = manifest.work.items.filter(item => item.direction !== 'waiting');
  if (!attention.total && !owned.length) return null;
  const preview = owned.slice(0, 2);
  const labels = [attention.overdue ? `${attention.overdue} overdue` : null, attention.due_soon ? `${attention.due_soon} due soon` : null].filter(Boolean).join(' · ');
  return <section className="workspace-section workspace-today-attention" aria-labelledby="workspace-attention-title">
    <header>
      <h2 id="workspace-attention-title">Needs attention</h2>
      <WorkspaceLink className="workspace-section__link" href="/work" ariaLabel="View all open work">All work <ChevronRight size={15} aria-hidden="true" /></WorkspaceLink>
    </header>
    {preview.length ? <>
      {labels ? <p className="workspace-today-attention__status">{labels}</p> : null}
      <ul className="workspace-today-actions">
        {preview.map(item => <li key={item.id}><WorkspaceWorkRow item={item} /></li>)}
      </ul>
      {owned.length > preview.length ? <WorkspaceLink className="workspace-today-attention__remaining" href="/work">{owned.length - preview.length} more needing you <ChevronRight size={15} aria-hidden="true" /></WorkspaceLink> : null}
    </> : <WorkspaceLink className="workspace-attention" href="/work" ariaLabel={`${attention.total} work items need attention, view all work`}>
      <CircleAlert size={20} aria-hidden="true" />
      <span className="workspace-attention__copy"><strong>{attention.total} {attention.total === 1 ? 'item needs' : 'items need'} your attention</strong><small>{labels || 'Open Work to review the available requests, tasks and offers.'}</small></span>
      <ChevronRight size={17} aria-hidden="true" />
    </WorkspaceLink>}
  </section>;
}

export function WorkspaceTodayView({ manifest, showPageHeading = true }: { manifest: WorkspaceManifest; showPageHeading?: boolean }) {
  const { today } = manifest;
  const hasContent = today.now.length || today.attention.total || today.next.length || manifest.work.items.some(item => item.direction !== 'waiting');
  const calendar = manifest.areas.find(area => area.key === 'calendar');
  const timeZone = manifest.context.time_zone ?? 'UTC';
  const upcoming = today.next.slice(0, 3);
  const more = today.next.slice(3);
  return <div className="workspace-view workspace-today">
    {showPageHeading ? <header className="workspace-view__heading"><div><h1>Today</h1>{manifest.context.date_label ? <p>{manifest.context.date_label}</p> : null}</div><WorkspaceFreshness label={freshnessLabel(manifest.freshness)} /></header>
      : <div className="workspace-today__context">{manifest.context.date_label ? <strong>{manifest.context.date_label}</strong> : null}<WorkspaceFreshness label={freshnessLabel(manifest.freshness)} /></div>}

    {manifest.work.coverage === 'partial' ? <p role="alert" className="workspace-today-warning">Some work could not be included. Check Work and the owning areas before treating this view as complete.</p> : null}
    {!hasContent && manifest.work.coverage !== 'partial' ? <WorkspaceEmpty kind="today" /> : null}

    {today.now.length ? <section className="workspace-section" aria-labelledby="workspace-now-title">
      <header><h2 id="workspace-now-title">Now</h2></header>
      <div className="workspace-current-list">
        <WorkspaceTodayEntry entry={today.now[0]!} current timeZone={timeZone} />
        {today.now.length > 1 ? <ul className="workspace-today-agenda workspace-today-agenda--current">{today.now.slice(1).map(entry => <li key={entry.id}><WorkspaceTodayEntry entry={entry} timeZone={timeZone} /></li>)}</ul> : null}
      </div>
    </section> : null}

    <WorkspaceAttention manifest={manifest} />

    {today.next.length ? <section className="workspace-section workspace-today-plan" aria-labelledby="workspace-next-title">
      <header><h2 id="workspace-next-title">Next</h2>{calendar ? <WorkspaceLink className="workspace-section__link" href={calendar.href} ariaLabel="View calendar">Calendar <ChevronRight size={15} aria-hidden="true" /></WorkspaceLink> : null}</header>
      <ul className="workspace-today-agenda">{upcoming.map(entry => <li key={entry.id}><WorkspaceTodayEntry entry={entry} timeZone={timeZone} /></li>)}</ul>
      {more.length ? <details className="workspace-upcoming-more"><summary>More upcoming <span>{more.length} more</span><ChevronDown size={17} aria-hidden="true" /></summary>
        <ul className="workspace-today-agenda">{more.map(entry => <li key={entry.id}><WorkspaceTodayEntry entry={entry} timeZone={timeZone} /></li>)}</ul>
      </details> : null}
    </section> : null}

    {today.completed_automatically?.length ? <details className="workspace-automatic"><summary><span>Completed automatically</span><small>{today.completed_automatically.length}</small><ChevronDown size={17} aria-hidden="true" /></summary><div className="workspace-record-list">{today.completed_automatically.map(entry => <WorkspaceEntryRow key={entry.id} entry={entry} />)}</div></details> : null}
  </div>;
}
