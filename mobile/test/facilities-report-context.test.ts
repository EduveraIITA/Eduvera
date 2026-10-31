import assert from 'node:assert/strict';
import test from 'node:test';
import { facilitiesReport } from '../../backend/src/facilities/facilities.contracts';
import { facilitiesReportBody } from '../src/lib/facilities-operations';
import { facilitiesReportContextKey, facilitiesReportHref, facilitiesReportOptionsPath, facilitiesReportPrefill, facilitiesReportRequested, facilitiesReportTarget } from '../src/lib/facilities-report-context';

const school = '11111111-1111-4111-8111-111111111111', holdingId = '22222222-2222-4222-8222-222222222222', spaceId = '33333333-3333-4333-8333-333333333333', otherId = '44444444-4444-4444-8444-444444444444';
const root = `/api/v1/schools/${school}/facilities`;
const holding = { id: holdingId, label: 'South entrance light', asset_tag: 'LAMP-031', map_status_supported: true }, place = { id: spaceId, label: 'South entrance' };
const options = () => ({ selected: { holding, place }, holdings: [], places: [], pagination: { page: 1, page_size: 25, people_has_more: false, places_has_more: true, holdings_has_more: true } });
const params = (query = `holding_id=${holdingId}&space_id=${spaceId}`) => new URLSearchParams(query);

test('canonical map resource and place report links open the native report action; legacy links remain supported', () => {
  for (const target of [{ holdingId, spaceId }, { spaceId }, { holdingId }, {}]) {
    const href = facilitiesReportHref(target), query = new URL(href, 'https://campus.example').searchParams;
    assert.equal(href.startsWith('/areas/facilities?action=report'), true);
    assert.equal(facilitiesReportRequested(query), true);
    assert.equal(query.get('holding_id'), target.holdingId ?? null);
    assert.equal(query.get('space_id'), target.spaceId ?? null);
  }
  assert.equal(facilitiesReportRequested(params('report=1')), true);
  for (const query of ['', 'report=true', 'report=0', 'action=settings&report=1', 'action=other&report=1']) assert.equal(facilitiesReportRequested(params(query)), false);
});

test('only well formed exact target identifiers are sent to the owning options read', () => {
  const target = facilitiesReportTarget(params());
  const path = new URL(facilitiesReportOptionsPath(root, target)!, 'https://campus.example');
  assert.equal(path.pathname, `${root}/options`);
  assert.equal(path.searchParams.get('holding_id'), holdingId);
  assert.equal(path.searchParams.get('space_id'), spaceId);
  assert.equal(path.searchParams.get('search'), '');
  assert.equal(path.searchParams.get('page'), '1');
  assert.deepEqual(facilitiesReportTarget(params('')), { kind: 'none' });
  for (const query of ['holding_id=', 'space_id=bad', 'holding_id=South%20entrance%20light', `holding_id=${holdingId}&holding_id=${otherId}`, `space_id=${spaceId}&space_id=${spaceId}`, 'holding_id=../other-campus']) {
    const invalid = facilitiesReportTarget(params(query));
    assert.deepEqual(invalid, { kind: 'invalid' });
    assert.equal(facilitiesReportOptionsPath(root, invalid), null);
  }
});

test('explicit selected rows prefill both exact identities even when neither is on the first search page', () => {
  const prefill = facilitiesReportPrefill(facilitiesReportTarget(params()), options());
  assert.deepEqual(prefill, { holding: { id: holdingId, label: holding.label, mapStatus: true }, place });
  assert.equal(facilitiesReportPrefill(facilitiesReportTarget(params()), { ...options(), selected: undefined, holdings: [holding], places: [place] }), null, 'paged choices are not a substitute for the validated selection');
});

test('foreign, missing, forged and conflicting selected rows never fall back to a same-name item', () => {
  const target = facilitiesReportTarget(params()), current = options();
  for (const changed of [
    null, {}, { ...current, selected: { holding: null, place } }, { ...current, selected: { holding, place: null } },
    { ...current, selected: { holding: { ...holding, id: otherId }, place } },
    { ...current, selected: { holding, place: { ...place, id: otherId } } },
    { ...current, selected: { holding: { ...holding, label: '' }, place } },
    { ...current, selected: { holding: { ...holding, map_status_supported: 'true' }, place } },
    { ...current, holdings: [holding, holding] }, { ...current, places: [place, place] },
    { ...current, holdings: [{ ...holding, label: 'Different current label' }] },
    { ...current, holdings: [{ ...holding, map_status_supported: false }] },
    { ...current, pagination: { ...current.pagination, page: 2 } },
    { ...current, pagination: { ...current.pagination, page_size: 1000 } },
  ]) assert.equal(facilitiesReportPrefill(target, changed), null);
});

test('place-only links stay place-only and absent map support cannot create a shared fault', () => {
  const current = options();
  assert.deepEqual(facilitiesReportPrefill(facilitiesReportTarget(params(`space_id=${spaceId}`)), { ...current, selected: { holding: null, place } }), { holding: null, place });
  assert.equal(facilitiesReportPrefill(facilitiesReportTarget(params(`space_id=${spaceId}`)), current), null, 'unsolicited holding is not linked');
  const { map_status_supported: _, ...unpublished } = holding;
  const prefill = facilitiesReportPrefill(facilitiesReportTarget(params(`holding_id=${holdingId}`)), { ...current, selected: { holding: unpublished, place: null } });
  assert.equal(prefill?.holding?.mapStatus, false);
  assert.equal(prefill?.place, null);
});

test('the report draft identity changes with target URL, actor, campus and selected world', () => {
  const key = facilitiesReportContextKey('actor:school:live', params());
  assert.equal(facilitiesReportContextKey('actor:school:live', params(`space_id=${spaceId}&holding_id=${holdingId}&page=5`)), key, 'unrelated query order and list paging preserve the draft');
  for (const scope of ['other-actor:school:live', 'actor:other-school:live', 'actor:school:scenario-1', 'actor:school:scenario-2']) assert.notEqual(facilitiesReportContextKey(scope, params()), key);
  assert.notEqual(facilitiesReportContextKey('actor:school:live', params(`holding_id=${otherId}&space_id=${spaceId}`)), key);
  assert.notEqual(facilitiesReportContextKey('actor:school:live', params('')), key);
  assert.notEqual(facilitiesReportContextKey('actor:school:live', params(`holding_id=${holdingId}&space_id=${spaceId}&space_id=${otherId}`)), key);
});

test('a reviewed prefill makes an ordinary owning repair command with both links and explicit fault choice', () => {
  const prefill = facilitiesReportPrefill(facilitiesReportTarget(params()), options())!;
  const input = { problem: 'Light is flickering', location: '', urgent: false, selected: { ...prefill.holding!, kind: 'holdings' as const }, place: prefill.place, reporter: null, impact: 'not_working' as const };
  const settings = { configured: true, can_manage: false } as Parameters<typeof facilitiesReportBody>[0];
  const body = facilitiesReportBody(settings, input);
  assert.equal(body.holding_id, holdingId);
  assert.equal(body.space_id, spaceId);
  assert.equal(body.asset_impact, 'not_working');
  assert.equal(facilitiesReport.safeParse({ ...body, command_id: otherId }).success, true);
  assert.throws(() => facilitiesReportBody(settings, { ...input, place: { ...place, id: 'forged' } }));
  assert.throws(() => facilitiesReportBody(settings, { ...input, selected: null }));
  assert.throws(() => facilitiesReportBody(settings, { ...input, selected: { ...place, kind: 'places' }, impact: null }));
  const cleared = facilitiesReportBody(settings, { ...input, selected: null, place: null, impact: null, location: 'Beside the entrance' });
  assert.equal(cleared.holding_id, null);
  assert.equal(cleared.space_id, null);
  assert.equal(cleared.asset_impact, null);
});
