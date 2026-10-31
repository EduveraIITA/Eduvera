import type { WorkspaceManifest } from '../../../packages/contracts/src/workspace';
import { resolveNativeScheduleAccess, type NativeScheduleAccess } from './schedule-access';

export const calendarAttentionKeys = ['calendar_change_id', 'calendar_change_kind', 'calendar_revision', 'calendar_record_revision', 'attention_notification_id'] as const;

/** Keep fragment text out of source selectors and the server's opened_target. */
export function nativeCalendarLocation(href: string) {
  const hashAt = href.indexOf('#'), target = hashAt < 0 ? href : href.slice(0, hashAt), hash = hashAt < 0 ? '' : href.slice(hashAt);
  const queryAt = target.indexOf('?');
  return { path: queryAt < 0 ? target : target.slice(0, queryAt), params: new URLSearchParams(queryAt < 0 ? '' : target.slice(queryAt + 1)), hash, target };
}

/** A sole relationship is made explicit without losing its incoming exact update. */
export function nativeCalendarExactContextHref(manifest: WorkspaceManifest, selected: NativeScheduleAccess, href: string): string | null {
  const location = nativeCalendarLocation(href);
  if (location.path !== '/areas/calendar') return null;
  const current = resolveNativeScheduleAccess(manifest, location.target);
  if (!current || current.surface.key !== selected.surface.key || current.kind !== selected.kind || current.studentId !== selected.studentId) return null;
  if (selected.kind !== 'self' && selected.kind !== 'dependent') return href;
  if (!selected.studentId) return null;
  const { params } = location;
  if (params.get('scope') === selected.kind && params.get('student_id') === selected.studentId) return href;
  params.set('scope', selected.kind); params.set('student_id', selected.studentId);
  return `${location.path}?${params}${location.hash}`;
}

/** Ordinary presentation changes retain the current exact context and search. */
export function nativeCalendarChangeHref(href: string, values: Record<string, string>, moving = false): string {
  const { path, params, hash } = nativeCalendarLocation(href);
  for (const [key, value] of Object.entries(values)) { if (value) params.set(key, value); else params.delete(key); }
  if (!('calendar_page' in values)) params.delete('calendar_page');
  if (!('entry' in values)) params.delete('entry');
  params.delete('dining_page');
  if (moving) for (const key of calendarAttentionKeys) params.delete(key);
  return `${path}${params.size ? `?${params}` : ''}${moving ? '' : hash}`;
}

export function nativeCalendarDateReturnHref(href: string, item?: { id: string; starts_on: string }): string {
  const { path, params, hash } = nativeCalendarLocation(href);
  params.delete('calendar_action'); params.delete('calendar_date_id');
  if (item) {
    params.set('date', item.starts_on); params.set('entry', `milestones:${item.id}`); params.delete('calendar_page');
    for (const key of calendarAttentionKeys) params.delete(key);
  }
  return `${path}${params.size ? `?${params}` : ''}${item ? '' : hash}`;
}
