import type { FacilitiesChoice } from './facilities-operations';

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const label = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 500;

export type FacilitiesReportTarget = { kind: 'none' } | { kind: 'invalid' } | { kind: 'requested'; holdingId: string | null; spaceId: string | null };
export interface FacilitiesReportPrefill { holding: FacilitiesChoice | null; place: FacilitiesChoice | null }
export const facilitiesReportContextWarning = 'The linked resource or place could not be confirmed in this campus and world. Choose a current item or place, or describe the location before sending.';

/** Existing published-map links used report=1; explicit actions take precedence. */
export function facilitiesReportRequested(params: URLSearchParams) {
  return params.get('action') === 'report' || !params.has('action') && params.get('report') === '1';
}

export function facilitiesReportTarget(params: URLSearchParams): FacilitiesReportTarget {
  const holding = params.getAll('holding_id'), place = params.getAll('space_id');
  if (!holding.length && !place.length) return { kind: 'none' };
  if (holding.length > 1 || place.length > 1 || holding.length && !uuid(holding[0]) || place.length && !uuid(place[0])) return { kind: 'invalid' };
  return { kind: 'requested', holdingId: holding[0] ?? null, spaceId: place[0] ?? null };
}

/** A new URL target or actor/world scope gets a fresh editable draft. */
export function facilitiesReportContextKey(scopeKey: string, params: URLSearchParams) {
  return JSON.stringify([scopeKey, params.getAll('holding_id'), params.getAll('space_id')]);
}

export function facilitiesReportOptionsPath(root: string, target: FacilitiesReportTarget) {
  return target.kind !== 'requested' ? null : `${root}/options?${new URLSearchParams({ search: '', page: '1', ...(target.holdingId ? { holding_id: target.holdingId } : {}), ...(target.spaceId ? { space_id: target.spaceId } : {}) })}`;
}

export function facilitiesReportHref(target: { holdingId?: string | null; spaceId?: string | null }) {
  return `/areas/facilities?${new URLSearchParams({ action: 'report', ...(target.holdingId ? { holding_id: target.holdingId } : {}), ...(target.spaceId ? { space_id: target.spaceId } : {}) })}`;
}

function choice(value: unknown, holding: boolean): FacilitiesChoice | null {
  const row = object(value);
  if (!row || !uuid(row.id) || !label(row.label) || holding && !(row.asset_tag === null || typeof row.asset_tag === 'string') || row.map_status_supported !== undefined && typeof row.map_status_supported !== 'boolean') return null;
  return { id: row.id, label: row.label, ...(holding ? { mapStatus: row.map_status_supported === true } : {}) };
}

/** Only the owning options read's explicit selection can prefill. Paged/name
 * matches never establish identity or silently substitute a different target. */
export function facilitiesReportPrefill(target: FacilitiesReportTarget, value: unknown): FacilitiesReportPrefill | null {
  if (target.kind !== 'requested') return null;
  const data = object(value), selected = object(data?.selected), pagination = object(data?.pagination);
  if (!selected || !pagination || pagination.page !== 1 || pagination.page_size !== 25 || !['places_has_more', 'holdings_has_more', 'people_has_more'].every(key => typeof pagination[key] === 'boolean')) return null;
  const holding = selected.holding === null ? null : choice(selected.holding, true), place = selected.place === null ? null : choice(selected.place, false);
  if ((target.holdingId ? holding?.id !== target.holdingId : selected.holding !== null) || (target.spaceId ? place?.id !== target.spaceId : selected.place !== null)) return null;
  for (const [key, current, resource] of [['holdings', holding, true], ['places', place, false]] as const) {
    const rows = data?.[key];
    if (!Array.isArray(rows) || rows.length > 25) return null;
    const choices = rows.map(row => choice(row, resource));
    if (choices.some(row => !row) || new Set(choices.map(row => row!.id)).size !== choices.length) return null;
    const listed = current ? choices.find(row => row!.id === current.id) : null;
    if (listed && (listed.label !== current!.label || listed.mapStatus !== current!.mapStatus)) return null;
  }
  return { holding, place };
}
