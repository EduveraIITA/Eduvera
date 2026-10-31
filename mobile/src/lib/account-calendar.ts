import type { AccountConnectionContext } from './account-capabilities';

export type AccountCalendarMode = 'live' | 'simulation';
export interface AccountCalendarSubscription {
  id: string;
  token_hint: string;
  created_at: string;
  last_fetched_at: string | null;
  revision: number;
  evidence_mode?: AccountCalendarMode;
  external_subscription?: boolean;
}
export interface AccountCalendarStatus {
  scope: { portal: AccountConnectionContext['audience']; student_id: string | null; calendar_name: string };
  subscription: AccountCalendarSubscription | null;
  evidence_mode?: AccountCalendarMode;
  external_subscription?: boolean;
}
/** The owning create response intentionally omits last_fetched_at. */
export interface AccountCreatedCalendar extends Omit<AccountCalendarSubscription, 'last_fetched_at'> {
  last_fetched_at?: string | null;
  feed_url: string;
  calendar_name: string;
  /** A public configured host can differ from the authenticated API proxy. */
  feedOrigin: string | null;
}

const endpoint = '/api/v1/calendar-connections';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const audiences = new Set(['principal', 'teacher', 'parent', 'student']);
const invalid = (): never => { throw new Error('The calendar connection did not match the requested context. Refresh before continuing.'); };
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
const own = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const identifier = (value: unknown): value is string => typeof value === 'string' && uuid.test(value);
function displayText(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) invalid();
  return value as string;
}
function civilDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function instant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  return !!match && civilDay(match[1]) && Number(match[2]) < 24 && Number(match[3]) < 60 && Number(match[4]) < 60
    && (match[5] === 'Z' || Number(match[6]) < 24 && Number(match[7]) < 60) && Number.isFinite(Date.parse(value));
}
function modeValue(mode: AccountCalendarMode) { if (mode !== 'live' && mode !== 'simulation') invalid(); }
function contextValue(context: AccountConnectionContext) {
  if (!context || !audiences.has(context.audience) || context.studentId !== undefined && !identifier(context.studentId)
    || (context.audience === 'principal' || context.audience === 'teacher') && context.studentId !== undefined) invalid();
}
/** Optional markers are checked independently; absence is valid on status reads. */
function evidence(value: Record<string, unknown>, mode: AccountCalendarMode, required = false) {
  modeValue(mode);
  if (own(value, 'evidence_mode') && value.evidence_mode !== mode || own(value, 'external_subscription') && value.external_subscription !== (mode === 'live')
    || required && (value.evidence_mode !== mode || value.external_subscription !== (mode === 'live'))) invalid();
  return {
    ...(own(value, 'evidence_mode') ? { evidence_mode: mode } : {}),
    ...(own(value, 'external_subscription') ? { external_subscription: mode === 'live' } : {}),
  };
}
function subscription(value: unknown, mode: AccountCalendarMode, created: boolean) {
  const row = record(value);
  if (!identifier(row.id) || !instant(row.created_at) || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1
    || !created && !own(row, 'last_fetched_at') || own(row, 'last_fetched_at') && row.last_fetched_at !== null && !instant(row.last_fetched_at)) invalid();
  const hint = displayText(row.token_hint, 64);
  if (!/^[A-Za-z0-9_-]+$/.test(hint)) invalid();
  return { id: row.id as string, token_hint: hint, created_at: row.created_at as string, revision: row.revision as number,
    ...(own(row, 'last_fetched_at') ? { last_fetched_at: row.last_fetched_at as string | null } : {}), ...evidence(row, mode) };
}

export function calendarParameters(context: AccountConnectionContext): URLSearchParams {
  contextValue(context);
  return new URLSearchParams({ portal: context.audience, ...(context.studentId ? { student_id: context.studentId } : {}) });
}

/** Scope identity is checked after the ordinary selected-world transport guard. */
export function parseCalendarStatus(value: unknown, context: AccountConnectionContext, mode: AccountCalendarMode): AccountCalendarStatus {
  contextValue(context);
  const body = record(value), scope = record(body.scope), markers = evidence(body, mode);
  const learner = context.audience === 'parent' || context.audience === 'student';
  if (scope.portal !== context.audience || (learner ? !identifier(scope.student_id) || context.studentId !== undefined && scope.student_id !== context.studentId : scope.student_id !== null)) invalid();
  const calendarName = displayText(scope.calendar_name, 500);
  if (!own(body, 'subscription')) invalid();
  const item = body.subscription === null ? null : subscription(body.subscription, mode, false) as AccountCalendarSubscription;
  return { scope: { portal: context.audience, student_id: scope.student_id as string | null, calendar_name: calendarName }, subscription: item, ...markers };
}

function publicFeed(value: unknown): { feed_url: string; feedOrigin: string } {
  if (typeof value !== 'string' || value.length > 2048 || value !== value.trim() || /[\\?#\u0000-\u0020\u007f]/.test(value)) invalid();
  let url: URL;
  try { url = new URL(value as string); } catch { return invalid(); }
  const authority = /^https:\/\/([^/]+)\//.exec(value as string)?.[1];
  if (url.protocol !== 'https:' || !authority || authority.toLowerCase() !== url.hostname.toLowerCase() || url.username || url.password || url.port || url.search || url.hash
    || (value as string).slice(8 + authority.length) !== url.pathname
    || !/^\/api\/v1\/calendar-connections\/subscriptions\/[A-Za-z0-9_-]{43}\/feed\.ics$/.test(url.pathname)) invalid();
  return { feed_url: value as string, feedOrigin: url.origin };
}
/**
 * Live links use the server's configured PUBLIC_URL, which may differ from origin.
 * origin verifies the caller's authenticated transport binding for Simulation;
 * its returned URL must remain the exact authenticated relative route.
 */
export function parseCreatedCalendar(value: unknown, context: AccountConnectionContext, mode: AccountCalendarMode, origin: string): AccountCreatedCalendar {
  contextValue(context); modeValue(mode);
  const body = record(value), item = subscription(body, mode, true), markers = evidence(body, mode, mode === 'simulation');
  const name = displayText(body.calendar_name, 500);
  if (mode === 'simulation') {
    const path = `${endpoint}/subscriptions/${item.id}/preview.ics`;
    if (body.feed_url !== path || body.token_hint !== 'simulation') invalid();
    // A valid caller origin is part of the existing authenticated transport binding.
    try { const api = new URL(origin); if (!['https:', 'http:'].includes(api.protocol) || api.username || api.password || api.pathname !== '/' || api.search || api.hash) invalid(); } catch { return invalid(); }
    return { ...item, ...markers, feed_url: path, calendar_name: name, feedOrigin: null };
  }
  return { ...item, ...markers, ...publicFeed(body.feed_url), calendar_name: name };
}

/** Pass a campus-local civil day when its zone differs; Date means UTC civil day. */
export function calendarExportPath(context: AccountConnectionContext, dateOrCivilDay: Date | string): string {
  const parameters = calendarParameters(context);
  const day = dateOrCivilDay instanceof Date && Number.isFinite(dateOrCivilDay.getTime()) ? dateOrCivilDay.toISOString().slice(0, 10) : dateOrCivilDay;
  if (!civilDay(day)) invalid();
  const shift = (amount: number) => { const date = new Date(`${day}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + amount); const result = date.toISOString().slice(0, 10); if (!civilDay(result)) invalid(); return result; };
  parameters.set('from', shift(-7)); parameters.set('to', shift(360));
  return `${endpoint}/export.ics?${parameters.toString()}`;
}

export function calendarDisconnectPath(id: string): string {
  if (!identifier(id)) invalid();
  return `${endpoint}/subscriptions/${id}`;
}
