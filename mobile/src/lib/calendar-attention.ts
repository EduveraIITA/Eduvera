import type { ApiSchoolCalendarDay } from '../../../packages/contracts/src/wire/features/school/api';
import type { NativeScheduleAccess } from './schedule-access';
import { calendarAttentionKeys, nativeCalendarLocation } from './calendar-route';
import { nativeCalendarValidDate } from './native-calendar';

export interface CalendarAttentionProof { notificationId: string; openedTarget: string; cleanHref: string; key: string }
export type CalendarAttentionState = { resolution: 'none' | 'loading' | 'stale' | 'exact'; proof: CalendarAttentionProof | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const positive = (value: string | null) => !!value && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value));

/** The unpaged days owner proves one current created revision or absence after removal. */
export function nativeCalendarAttention(href: string, selected: NativeScheduleAccess, source: {
  loaded: boolean; days: readonly ApiSchoolCalendarDay[]; from: string; until: string;
}): CalendarAttentionState {
  const { path, params, hash, target } = nativeCalendarLocation(href), none = { resolution: 'none' as const, proof: null }, stale = { resolution: 'stale' as const, proof: null };
  // Other producer selectors may remain after a confirmed opening. Only the
  // notification selector requests acknowledgement; its absence cannot clear one.
  if (!params.has('attention_notification_id')) return none;
  if (path !== '/areas/calendar' || params.has('calendar_action') || params.has('calendar_date_id')) return none;
  const required = ['date', ...calendarAttentionKeys];
  if (required.some(key => params.getAll(key).length !== 1) || ['scope', 'student_id', 'surface'].some(key => params.getAll(key).length > 1)) return stale;
  const date = params.get('date')!, id = params.get('calendar_change_id')!, notificationId = params.get('attention_notification_id')!, kind = params.get('calendar_change_kind');
  if (!nativeCalendarValidDate(date) || !nativeCalendarValidDate(source.from) || !nativeCalendarValidDate(source.until) || source.from > date || source.until < date
    || !uuid.test(id) || !uuid.test(notificationId) || !positive(params.get('calendar_revision')) || !positive(params.get('calendar_record_revision')) || !['created', 'removed'].includes(kind ?? '')) return stale;
  if (selected.kind === 'self' || selected.kind === 'dependent') {
    if (!selected.studentId || params.get('scope') !== selected.kind || params.get('student_id') !== selected.studentId || params.has('surface')
      || !selected.surface.scopes.some(scope => scope.kind === selected.kind && scope.id === selected.studentId)) return stale;
  } else if (params.has('scope') || params.has('student_id') || params.has('surface') && params.get('surface') !== selected.kind) return stale;
  if (!source.loaded) return { resolution: 'loading', proof: null };
  const days = source.days.filter(day => day.date === date);
  const exact = kind === 'removed' ? days.length === 0 : days.length === 1 && days[0]!.id === id && days[0]!.is_instructional === false && days[0]!.revision === Number(params.get('calendar_record_revision'));
  if (!exact) return stale;
  params.delete('attention_notification_id');
  return { resolution: 'exact', proof: { notificationId, openedTarget: target, cleanHref: `${path}?${params}${hash}`, key: JSON.stringify([target, selected.surface.key, selected.studentId ?? '', id, params.get('calendar_record_revision')]) } };
}

/** This read acknowledgement is owner-idempotent; it never executes a Calendar command. */
export async function acknowledgeCalendarAttention(proof: CalendarAttentionProof, options: {
  capture(): { assertCurrent(): void }; isCurrent(): boolean; send(path: string, body: string): Promise<unknown>;
  confirmed(cleanHref: string, assertCurrent: () => void): Promise<void> | void;
}): Promise<void> {
  const context = options.capture();
  const assertCurrent = () => { context.assertCurrent(); if (!options.isCurrent()) throw new Error('The exact Calendar update is no longer visible in the foreground.'); };
  assertCurrent();
  const receipt = await options.send(`/api/v1/notifications/${proof.notificationId}/read/`, JSON.stringify({ opened_target: proof.openedTarget }));
  assertCurrent();
  const row = receipt as { id?: unknown; read_at?: unknown } | null;
  if (!row || row.id !== proof.notificationId || typeof row.read_at !== 'string' || !Number.isFinite(Date.parse(row.read_at))) throw new Error('The Calendar update was not confirmed as opened.');
  await options.confirmed(proof.cleanHref, assertCurrent); assertCurrent();
}
