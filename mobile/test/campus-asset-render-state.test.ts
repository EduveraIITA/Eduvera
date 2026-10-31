import assert from 'node:assert/strict';
import test from 'node:test';
import type { CampusMapAsset, CampusOperationalProjection } from '../../packages/contracts/src/campus-operation';
import type { CampusScenePublished } from '../../packages/contracts/src/campus-scenes/contracts';
import type { CampusSceneDocument, CampusSceneElement } from '../../packages/contracts/src/campus-scenes/types';
import { nativeCampusAssetRenderStates } from '../src/lib/campus-asset-render-state';
import { nativeCampusLayersMatch } from '../src/lib/native-campus';
import { campusBlockedLiftIds } from '../../packages/contracts/src/campus-operation-presentation';

const fixture = (id: string, asset_key: CampusSceneElement['asset_key']): CampusSceneElement => ({
  id, kind: 'fixture', asset_key, holding_id: `holding-${id}`, label: 'Same visible label', floor_id: null, space_id: null,
  review_state: 'reviewed', geometry: { type: 'point', points: [{ x: 20, y: 20 }] },
});
const lamp = fixture('road-lamp', 'lamp'), pump = fixture('water-pump', 'equipment'), lift = { ...fixture('lift', 'equipment'), navigation_connector: { kind: 'lift' as const, from_floor_id: 'floor-a', to_floor_id: 'floor-b', status: 'open' as const, accessible: true } };
const scene: CampusSceneDocument = { schema_version: 1, name: 'Any campus', bounds: { width: 100, height: 100, unit: 'metres' }, source: { kind: 'manual', label: 'Reviewed layout' }, elements: [lamp, pump, lift] };
const asset = (element = lamp, changes: Partial<CampusMapAsset> = {}): CampusMapAsset => ({
  element_id: element.id, holding_id: element.holding_id!, name: element.label, asset_tag: 'EXACT-ITEM', space_id: 'courtyard', native_state: 'available', reportable: true,
  signal: { state: 'unknown', impact: null, open_reports: 0, updated_at: null }, repairs: [], ...changes,
});
const publication: CampusScenePublished = { campus: { id: 'campus', name: 'Campus', code: 'MAIN' }, scene: { id: 'publication', version: 2, published_at: '2026-10-29T00:00:00Z', document: scene }, places: [], can_edit: false };
const projection: CampusOperationalProjection = { schema_version: 1, school_id: 'school', campus_id: 'campus', as_of: '2026-10-29T10:00:00Z', environment: { kind: 'live', namespace_id: 'live:school' }, publication: { id: 'publication', version: 2 }, assets: [asset()], activities: [], limitations: [] };

test('exact resource state becomes a minimal render projection without private repair data', () => {
  const source = asset(lamp, { native_state: 'unavailable', repairs: [{ id: 'private-repair', revision: 3, state: 'reported', target_path: '/areas/facilities?repair=private-repair', action_label: 'Open repair' }] });
  const before = structuredClone({ scene, source });
  const result = nativeCampusAssetRenderStates(scene, [source]);
  assert.deepEqual(result[0], { elementId: lamp.id, holdingId: lamp.holding_id, availability: 'unavailable', reportState: 'unknown', impact: null, openReports: 0, suppressNightGlow: true });
  assert.doesNotMatch(JSON.stringify(result), /private-repair|EXACT-ITEM|courtyard|target_path|reportable/);
  assert.deepEqual({ scene, source }, before);
});

test('reported and awaiting-check not-working suppress glow; reduced service and verified repair do not', () => {
  for (const reportState of ['reported_fault', 'awaiting_verification', 'verified_resolution', 'unknown'] as const) {
    for (const impact of ['not_working', 'degraded', null] as const) {
      const source = asset(lamp, { signal: { state: reportState, impact, open_reports: reportState === 'unknown' ? 0 : 1, updated_at: '2026-10-29T10:00:00Z' } });
      const state = nativeCampusAssetRenderStates(scene, [source])[0];
      assert.equal(state.reportState, reportState);
      assert.equal(state.impact, impact);
      assert.equal(state.suppressNightGlow, impact === 'not_working' && ['reported_fault', 'awaiting_verification'].includes(reportState));
    }
  }
  const checkedButUnavailable = asset(lamp, { native_state: 'unavailable', signal: { state: 'verified_resolution', impact: null, open_reports: 0, updated_at: null } });
  assert.equal(nativeCampusAssetRenderStates(scene, [checkedButUnavailable])[0].suppressNightGlow, true);
});

test('each linked fixture stays explicitly unknown when status is absent, replaced or unrelated', () => {
  for (const sources of [[], [asset(lamp, { holding_id: 'replacement-holding' })], [asset(lamp, { element_id: 'nearby-lamp' })]]) {
    const state = nativeCampusAssetRenderStates(scene, sources)[0];
    assert.deepEqual(state, { elementId: lamp.id, holdingId: lamp.holding_id, availability: 'unknown', reportState: 'unknown', impact: null, openReports: null, suppressNightGlow: false });
  }
  assert.deepEqual(nativeCampusAssetRenderStates(null, [asset()]), []);
});

test('decorative, draft and road geometry do not acquire asset identity from names or proximity', () => {
  const illustration = { ...lamp, id: 'decorative-lamp', holding_id: null }, draft = { ...pump, id: 'unreviewed-pump', review_state: 'needs_review' as const };
  const road: CampusSceneElement = { ...lamp, id: 'road', kind: 'road', asset_key: 'generic' };
  const result = nativeCampusAssetRenderStates({ ...scene, elements: [illustration, draft, road, lamp] }, [asset(illustration), asset(draft), asset(road), asset(lamp)]);
  assert.deepEqual(result.map(state => state.elementId), [lamp.id]);
});

test('duplicate status or scene bindings do not select an arbitrary source row', () => {
  for (const sources of [[asset(), asset()], [asset(), asset(pump, { holding_id: lamp.holding_id! })]]) {
    const state = nativeCampusAssetRenderStates(scene, sources)[0];
    assert.equal(state.availability, 'unknown'); assert.equal(state.openReports, null);
  }
  const duplicateHolding = { ...pump, holding_id: lamp.holding_id };
  const duplicateScene = { ...scene, elements: [lamp, duplicateHolding, { ...lamp }] };
  const states = nativeCampusAssetRenderStates(duplicateScene, [asset()]);
  assert.deepEqual(states.map(state => state.elementId), [lamp.id, pump.id]);
  assert.ok(states.every(state => state.availability === 'unknown' && state.openReports === null));
});

test('malformed source condition does not become a working or failed asset default', () => {
  for (const source of [
    asset(lamp, { native_state: 'working' as any }),
    asset(lamp, { signal: { state: 'verified' as any, impact: null, open_reports: 0, updated_at: null } }),
    asset(lamp, { signal: { state: 'reported_fault', impact: 'broken' as any, open_reports: 1, updated_at: null } }),
    asset(lamp, { signal: { state: 'reported_fault', impact: 'not_working', open_reports: -1, updated_at: null } }),
  ]) {
    const state = nativeCampusAssetRenderStates(scene, [source])[0];
    assert.equal(state.availability, 'unknown'); assert.equal(state.reportState, 'unknown'); assert.equal(state.suppressNightGlow, false);
  }
});

test('current world/publication gate feeds unknown instead of borrowing foreign Live state', () => {
  const simulated = { ...projection, environment: { kind: 'simulation' as const, namespace_id: 'world-a' } };
  for (const [source, environment] of [
    [projection, { mode: 'simulation' as const, namespace_id: 'world-a' }],
    [simulated, { mode: 'simulation' as const, namespace_id: 'world-b' }],
    [simulated, { mode: 'simulation' as const, namespace_id: 'world-a', unavailable: true }],
    [{ ...projection, publication: { id: 'old-publication', version: 1 } }, { mode: 'live' as const }],
    [{ ...projection, school_id: 'other-school' }, { mode: 'live' as const }],
  ] as const) {
    const accepted = nativeCampusLayersMatch(source, 'school', 'campus', environment, publication) ? source.assets : [];
    assert.equal(nativeCampusAssetRenderStates(scene, accepted)[0].availability, 'unknown');
    assert.equal(nativeCampusAssetRenderStates(scene, accepted)[0].openReports, null);
    assert.deepEqual(campusBlockedLiftIds(scene, accepted), [lift.id]);
  }
  assert.equal(nativeCampusLayersMatch(simulated, 'school', 'campus', { mode: 'simulation', namespace_id: 'world-a' }, publication), true);
  assert.equal(nativeCampusAssetRenderStates(scene, simulated.assets)[0].availability, 'available');
});

test('missing lift state blocks routing while explicit unknown state keeps its honest limitation', () => {
  assert.deepEqual(campusBlockedLiftIds(scene, []), [lift.id]);
  const unknown = asset(lift, { native_state: 'unknown' });
  assert.equal(nativeCampusAssetRenderStates(scene, [unknown]).find(state => state.elementId === lift.id)?.availability, 'unknown');
  assert.deepEqual(campusBlockedLiftIds(scene, [unknown]), []);
  const failed = asset(lift, { signal: { state: 'awaiting_verification', impact: 'not_working', open_reports: 1, updated_at: null } });
  assert.deepEqual(campusBlockedLiftIds(scene, [failed]), [lift.id]);
});
