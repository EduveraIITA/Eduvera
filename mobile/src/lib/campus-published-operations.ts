import type { CampusViewResponse } from '../../../packages/contracts/src/campus-view';
import { normalizeCampusView, type RawCampusViewResponse } from '../../../packages/contracts/src/campus-view-normalize';
import type { CampusKpiPage, CampusKpiRange, CampusKpiResponse, CampusKpiSeriesPoint, CampusKpiUnit } from '../../../packages/contracts/src/wire/features/campus-view/kpiApi';
import { isInternalHref } from './api-policy';

export interface CampusPublishedScope {
  schoolId: string;
  campusId: string;
  environment: { mode: 'live' | 'simulation'; namespace_id?: string | null; institution_id?: string | null };
}

type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value: unknown, maximum = 10000): value is string => typeof value === 'string' && value.length <= maximum;
const id = (value: unknown): value is string => text(value, 300) && value.length > 0;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const count = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0;
const nullable = (value: unknown, check: (value: unknown) => boolean) => value === null || check(value);
const optional = (value: unknown, check: (value: unknown) => boolean) => value === undefined || check(value);
const instant = (value: unknown): value is string => id(value) && Number.isFinite(Date.parse(value));
const rows = (value: unknown, check: (value: Row) => boolean, maximum = 10000): value is Row[] => Array.isArray(value) && value.length <= maximum && value.every(item => object(item) && check(item));
const oneOf = (value: unknown, options: readonly string[]) => typeof value === 'string' && options.includes(value);
const strings = (value: Row, keys: string[]) => keys.every(key => text(value[key]));
const numbers = (value: Row, keys: string[]) => keys.every(key => count(value[key]));
const dimensions = ['expected', 'observed', 'accepted', 'unknown'] as const;
const claimDimension = (claim: unknown, dimension: unknown) => claim === 'expected_context_only' ? dimension === 'expected' : oneOf(claim, ['point_observation_only', 'bounded_space_presence']) && oneOf(dimension, ['observed', 'accepted']);
const link = (value: unknown) => nullable(value, value => text(value, 4096));
const optionalLink = (value: unknown) => optional(value, link);
const dates = (value: Row, keys: string[]) => keys.every(key => nullable(value[key], instant));

function motionSource(value: unknown, revisionNullable = false) {
  return object(value) && id(value.domain) && id(value.record_id) && (revisionNullable && value.revision === null || count(value.revision));
}

function motionMatches(value: unknown, scope: CampusPublishedScope) {
  if (!object(value) || value.schema_version !== 1 || value.school_id !== scope.schoolId || value.campus_id !== scope.campusId || !instant(value.as_of)
    || !object(value.environment) || value.environment.kind !== scope.environment.mode
    || value.environment.namespace_id !== (scope.environment.mode === 'live' ? `live:${scope.schoolId}` : scope.environment.namespace_id)
    || !object(value.limits) || value.limits.subjects !== 128 || value.limits.claims !== 512 || value.limits.points !== 64 || typeof value.limits.source_limited !== 'boolean'
    || !Array.isArray(value.subjects) || value.subjects.length > 128 || !Array.isArray(value.points) || value.points.length > 64
    || !Array.isArray(value.limitations) || value.limitations.length > 128 || !value.limitations.every(item => text(item, 1000))) return false;
  const keys = new Set<string>(); let total = 0;
  for (const subject of value.subjects) {
    if (!object(subject) || !id(subject.subject_key) || keys.has(subject.subject_key) || !oneOf(subject.kind, ['self', 'person', 'group']) || !Array.isArray(subject.claims) || subject.claims.length > 512) return false;
    keys.add(subject.subject_key);
    for (const claim of subject.claims) {
      if (++total > 512 || !object(claim) || !id(claim.id) || !nullable(claim.space_id, id) || !instant(claim.starts_at) || !instant(claim.ends_at) || Date.parse(claim.starts_at) >= Date.parse(claim.ends_at)
        || !count(claim.expected_count) || claim.expected_count < 1 || claim.expected_count > 1000000 || subject.kind !== 'group' && claim.expected_count !== 1
        || claim.spatial_claim !== 'expected_context_only' || !motionSource(claim.source)) return false;
    }
  }
  return rows(value.points, point => id(point.id) && id(point.space_id) && instant(point.observed_at)
    && oneOf(point.dimension, ['observed', 'accepted']) && point.spatial_claim === 'point_observation_only' && motionSource(point.source, true), 64);
}

function rawAssertion(value: Row, dimension: string) {
  if (!id(value.assertion_id) || value.dimension !== dimension || !dates(value, ['valid_from', 'valid_until', 'observed_at'])
    || !object(value.source) || !strings(value.source, ['label', 'domain']) || !optional(value.source.record_id, id) || !optionalLink(value.source.target_path)
    || !object(value.freshness) || !oneOf(value.freshness.status, ['current_at_as_of', 'point_in_time']) || !nullable(value.freshness.expires_at, instant)
    || !claimDimension(value.spatial_claim, dimension) || !optionalLink(value.target_path)) return false;
  if (object(value.context)) {
    for (const key of ['expected_count', 'student_count', 'participant_count']) if (value.context[key] !== undefined && value.context[key] !== null && !count(value.context[key])) return false;
    for (const key of ['title', 'subject_name', 'subject_label', 'activity_label', 'class_label', 'teacher_label', 'period_label', 'occurrence_id', 'assessment_id']) {
      if (value.context[key] !== undefined && value.context[key] !== null && !text(value.context[key])) return false;
    }
  }
  return true;
}

function expectedUse(value: Row, spaceId: unknown) {
  return id(value.id) && id(value.occurrence_id) && value.space_id === spaceId && text(value.title) && oneOf(value.slot_type, ['class', 'break', 'activity'])
    && nullable(value.class_label, text) && nullable(value.subject_label, text) && (value.teacher === null || object(value.teacher) && id(value.teacher.id) && text(value.teacher.label))
    && count(value.expected_count) && instant(value.starts_at) && instant(value.ends_at) && Date.parse(value.starts_at) < Date.parse(value.ends_at)
    && oneOf(value.state, ['in_progress', 'upcoming', 'ended']) && value.dimension === 'expected' && value.spatial_claim === 'expected_context_only'
    && object(value.source) && strings(value.source, ['label', 'domain']) && id(value.source.record_id) && count(value.source.revision) && optionalLink(value.source.target_path);
}

function normalizedActivity(value: Row) {
  return id(value.id) && instant(value.occurred_at) && strings(value, ['title', 'detail', 'source_label']) && oneOf(value.state_dimension, dimensions)
    && optional(value.state, value => oneOf(value, ['in_progress', 'upcoming', 'ended', 'point_event']))
    && (!oneOf(value.state, ['in_progress', 'upcoming', 'ended']) || value.state_dimension === 'expected')
    && optional(value.ends_at, value => nullable(value, instant)) && optional(value.space_id, value => nullable(value, id))
    && (value.spatial_claim === undefined || claimDimension(value.spatial_claim, value.state_dimension)) && optionalLink(value.target_path);
}

function operations(value: unknown) {
  return value === null || object(value) && id(value.local_date) && numbers(value, ['current_expected_sessions', 'expected_teachers'])
    && object(value.gate_movements) && numbers(value.gate_movements, ['entries', 'exits', 'accepted_points']) && value.gate_movements.dimension === 'accepted'
    && value.gate_movements.spatial_claim === 'point_observation_only' && oneOf(value.gate_movements.scope, ['selected_campus', 'institution']) && text(value.gate_movements.source_label)
    && object(value.visitors_inside) && count(value.visitors_inside.count) && value.visitors_inside.dimension === 'accepted' && value.visitors_inside.scope === 'institution' && text(value.visitors_inside.source_label);
}

function plan(value: unknown) {
  return value === null || object(value) && id(value.id) && id(value.version) && text(value.label) && oneOf(value.source_kind, ['mapped', 'generated_schematic'])
    && optional(value.placement_kind, value => oneOf(value, ['configured_schematic', 'generated_grid'])) && object(value.view_box)
    && ['x', 'y', 'width', 'height'].every(key => finite(value.view_box && (value.view_box as Row)[key])) && Number(value.view_box.width) > 0 && Number(value.view_box.height) > 0
    && rows(value.elements, element => id(element.id) && element.kind === 'space' && id(element.space_id) && optional(element.floor_id, value => nullable(value, id))
      && text(element.label) && ['x', 'y', 'width', 'height'].every(key => finite(element[key])));
}

/** A private snapshot has authority only for its exact selected institution, campus and world. */
export function campusPublishedSnapshot(raw: unknown, scope: CampusPublishedScope): CampusViewResponse | null {
  if (!id(scope.schoolId) || !id(scope.campusId) || !oneOf(scope.environment.mode, ['live', 'simulation'])
    || scope.environment.institution_id != null && scope.environment.institution_id !== scope.schoolId
    || scope.environment.mode === 'simulation' && !id(scope.environment.namespace_id)
    || !object(raw) || raw.schema_version !== 1 || !object(raw.school) || raw.school.id !== scope.schoolId || !text(raw.school.name)
    || !optional(raw.school.timezone, value => nullable(value, text)) || raw.selected_campus_id !== scope.campusId || !instant(raw.generated_at) || !instant(raw.as_of)
    || !rows(raw.campuses, campus => id(campus.id) && strings(campus, ['name', 'code']) && typeof campus.is_primary === 'boolean' && optional(campus.timezone, value => nullable(value, text)), 1000)
    || raw.campuses.filter(campus => campus.id === scope.campusId).length !== 1 || new Set(raw.campuses.map(campus => campus.id)).size !== raw.campuses.length
    || !motionMatches(raw.motion, scope) || !object(raw.motion) || !instant(raw.motion.as_of) || Date.parse(raw.motion.as_of) !== Date.parse(raw.as_of)
    || !plan(raw.plan) || !operations(raw.operations)) return null;
  let evidenceCount = 0;
  if (!rows(raw.spaces, space => {
    if (!id(space.id) || space.campus_id !== scope.campusId || !nullable(space.parent_space_id, id) || !strings(space, ['name', 'code', 'kind']) || !nullable(space.capacity, count)
      || !nullable(space.floor_id, text) || !nullable(space.floor_label, text) || !oneOf(space.state_dimension, dimensions)
      || !optional(space.expected_activity, value => nullable(value, text)) || !object(space.assertions)) return false;
    for (const dimension of ['expected', 'observed', 'accepted']) {
      if (!rows(space.assertions[dimension], value => rawAssertion(value, dimension))) return false;
      evidenceCount += (space.assertions[dimension] as Row[]).length;
    }
    if (!optional(space.expected_now, value => rows(value, value => expectedUse(value, space.id))) || !optional(space.day_activity_count, count)) return false;
    evidenceCount += Array.isArray(space.expected_now) ? space.expected_now.length : 0;
    if (evidenceCount > 50000) return false;
    return optional(space.gate_activity_today, value => value === null || object(value) && numbers(value, ['entries', 'exits', 'accepted_points']) && instant(value.latest_observed_at)
      && value.dimension === 'accepted' && value.spatial_claim === 'point_observation_only' && text(value.source_label));
  }) || new Set(raw.spaces.map(space => space.id)).size !== raw.spaces.length
    || !rows(raw.activity, item => id(item.id) && instant(item.occurred_at) && strings(item, ['kind', 'action', 'state', 'actor_label']) && nullable(item.subject_label, text)
      && count(item.item_count) && object(item.source) && text(item.source.label))
    || !optional(raw.day_activity, value => rows(value, normalizedActivity))
    || !rows(raw.signals, signal => id(signal.id) && oneOf(signal.severity, ['review', 'important'])
      && ['person_label', 'class_label', 'activity_label', 'owner'].every(key => optional(signal[key], text))
      && optional(signal.gate_observed_at, value => nullable(value, instant)))) return null;
  const normalized = normalizeCampusView(raw as unknown as RawCampusViewResponse);
  if (!normalized.spaces.every(space => Array.isArray(space.expected_now) && Array.isArray(space.assertions.expected) && Array.isArray(space.assertions.observed) && Array.isArray(space.assertions.accepted)
    && [...space.assertions.expected, ...space.assertions.observed, ...space.assertions.accepted].every(assertion => text(assertion.label) && text(assertion.source_label) && nullable(assertion.count, finite)))
    || !rows(normalized.activity, normalizedActivity)
    || !rows(normalized.signals, signal => id(signal.id) && strings(signal, ['title', 'detail']) && instant(signal.occurred_at))) return null;
  return normalized;
}

/** Source links stay within canonical native journeys; displayable evidence need not have a usable link. */
export function campusPublishedSourceHref(path: unknown): string | null {
  if (!text(path, 4096) || path !== path.trim() || !isInternalHref(path) || !/^\/(?:areas|work|more|today)(?:\/|[?#]|$)/.test(path) || path.includes('//')) return null;
  try {
    const decoded = decodeURIComponent(path);
    return /[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.includes('//') ? null : path;
  } catch { return null; }
}

const kpiPages = ['overview', 'teaching', 'movement', 'spaces', 'coordination', 'data_health'] as const;
const kpiRanges = ['today', '7d', '30d', '90d', '1y'] as const;
const kpiUnits = ['count', 'percent', 'minutes', 'people', 'sessions', 'spaces', 'records'] as const;
const availability = ['available', 'partial', 'unavailable'] as const;
const valueContexts = ['active_at_as_of', 'current_at_as_of', 'trailing_15_minutes', 'selected_period', 'latest_interval_with_response_evidence'] as const;
const metricScope = (value: unknown) => oneOf(value, ['selected_campus', 'institution']);
const numericValue = (value: unknown) => nullable(value, finite);
const basis = (value: unknown) => nullable(value, value => finite(value) && value >= 0);
const timezone = (value: unknown) => { if (!id(value)) return false; try { new Intl.DateTimeFormat('en-IN', { timeZone: value }); return true; } catch { return false; } };

function seriesPoint(point: Row) {
  return instant(point.bucket_start) && instant(point.bucket_end) && Date.parse(point.bucket_start) < Date.parse(point.bucket_end)
    && numericValue(point.value) && basis(point.numerator) && basis(point.denominator) && count(point.unknown_count);
}

function kpiMetric(metric: Row) {
  return id(metric.key) && strings(metric, ['label', 'description', 'source_label']) && oneOf(metric.unit, kpiUnits)
    && numericValue(metric.value) && basis(metric.numerator) && basis(metric.denominator) && count(metric.unknown_count) && oneOf(metric.availability, availability)
    && metricScope(metric.scope) && Array.isArray(metric.evidence_dimensions) && metric.evidence_dimensions.length <= 3 && metric.evidence_dimensions.every(value => oneOf(value, dimensions.slice(0, 3)))
    && nullable(metric.source_max_at, instant) && nullable(metric.unavailable_reason, text) && optional(metric.value_context, value => oneOf(value, valueContexts))
    && optionalLink(metric.target_path) && rows(metric.series, seriesPoint, 800);
}

function headline(item: Row) {
  return id(item.key) && text(item.label) && numericValue(item.value) && oneOf(item.unit, kpiUnits) && oneOf(item.availability, availability) && oneOf(item.value_context, valueContexts)
    && optional(item.secondary, value => object(value) && id(value.key) && text(value.label) && numericValue(value.value) && oneOf(value.availability, availability));
}

export function campusKpiResponse(raw: unknown, page: CampusKpiPage, range: CampusKpiRange, campusId: string | null): CampusKpiResponse | null {
  if (!oneOf(page, kpiPages) || !oneOf(range, kpiRanges) || !object(raw) || raw.schema_version !== 1 || raw.page !== page || raw.range !== range || !instant(raw.generated_at)
    || !object(raw.scope) || raw.scope.campus_id !== campusId || !text(raw.scope.campus_label)
    || !object(raw.period) || !instant(raw.period.from) || !instant(raw.period.to) || Date.parse(raw.period.from) > Date.parse(raw.period.to) || !timezone(raw.period.timezone)
    || !object(raw.bucket) || !oneOf(raw.bucket.kind, ['15_minute', 'hour', 'day']) || !text(raw.bucket.label)
    || !rows(raw.metrics, kpiMetric, 200) || new Set(raw.metrics.map(metric => metric.key)).size !== raw.metrics.length) return null;
  if (raw.overview !== undefined) {
    const overview = raw.overview;
    if (!object(overview) || !Array.isArray(overview.headline_keys) || overview.headline_keys.length > 200 || !overview.headline_keys.every(id)
      || !optional(overview.headlines, value => rows(value, headline, 200)) || !optional(overview.evidence_state, value => oneOf(value, availability))
      || !object(overview.composition) || !strings(overview.composition, ['label', 'unit'])
      || !rows(overview.composition.slices, slice => id(slice.key) && text(slice.label) && finite(slice.value) && slice.value >= 0 && oneOf(slice.tone, [...dimensions, 'review']), 200)
      || !rows(overview.bottlenecks, item => id(item.id) && strings(item, ['label', 'detail', 'source_label']) && count(item.count) && oneOf(item.severity, ['review', 'important'])
        && metricScope(item.scope) && oneOf(item.evidence_dimension, dimensions) && optionalLink(item.target_path), 1000)) return null;
  }
  return raw as unknown as CampusKpiResponse;
}

const number = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
export function campusKpiValue(value: number | null, unit: CampusKpiUnit): string {
  if (value === null || !Number.isFinite(value)) return 'Not enough evidence';
  const formatted = number.format(value);
  return unit === 'percent' ? `${formatted}%` : unit === 'minutes' ? `${formatted} min` : formatted;
}

export interface CampusKpiPlotPoint { x: number; y: number; index: number; value: number }
export function campusKpiSeriesSegments(points: readonly CampusKpiSeriesPoint[], width = 300, height = 96, unit: CampusKpiUnit = 'count'): { segments: CampusKpiPlotPoint[][]; max: number } {
  const plotWidth = Number.isFinite(width) && width > 0 ? Math.min(width, 100000) : 300;
  const plotHeight = Number.isFinite(height) && height > 0 ? Math.min(height, 100000) : 96;
  let max = unit === 'percent' ? 100 : 1;
  if (unit !== 'percent') for (const point of points) if (finite(point?.value)) max = Math.max(max, point.value);
  const segments: CampusKpiPlotPoint[][] = []; let current: CampusKpiPlotPoint[] = [];
  points.forEach((point, index) => {
    if (!finite(point?.value)) { if (current.length) segments.push(current); current = []; return; }
    current.push({ x: points.length < 2 ? plotWidth / 2 : index / (points.length - 1) * plotWidth,
      y: plotHeight * (1 - Math.max(0, Math.min(max, point.value)) / max), index, value: point.value });
  });
  if (current.length) segments.push(current);
  return { segments, max };
}

export function campusActivityEvidence(item: CampusViewResponse['activity'][number]): string {
  if (item.state === 'in_progress') return 'In progress · Expected plan';
  if (item.state === 'upcoming') return 'Later today · Expected plan';
  if (item.state === 'ended') return 'Earlier today · Expected plan';
  if (item.spatial_claim === 'point_observation_only' && item.state_dimension === 'accepted') return 'Accepted point event';
  if (item.spatial_claim === 'point_observation_only' && item.state_dimension === 'observed') return 'Observed point event';
  if (item.state_dimension === 'accepted') return 'Accepted record';
  if (item.state_dimension === 'observed') return 'Observed point';
  if (item.state_dimension === 'expected') return 'Expected plan';
  return 'Recorded state needs review';
}
