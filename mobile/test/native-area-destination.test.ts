import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceArea, WorkspaceAreaSurface, WorkspaceManifest } from '../../packages/contracts/src/workspace';
import { resolveNativeAreaDestination } from '../src/lib/native-area-destination';

const surface = (key: string, href: string, label = key): WorkspaceAreaSurface => ({
  key, href, label, description: `${label} description`, capabilities: ['read'], scopes: [],
});
const area = (key: string, surfaces: readonly WorkspaceAreaSurface[], href = `/areas/${key}`): WorkspaceArea => ({
  key, href, label: `${key} area`, description: `${key} area description`, capabilities: [], scopes: [], surfaces,
});
const manifest = (areas: readonly WorkspaceArea[], simulation = false): WorkspaceManifest => ({
  context: { actor_user_id: 'actor', institution_id: 'campus', environment: simulation ? { kind: 'simulation', namespace_id: 'world' } : { kind: 'live' } },
  areas,
} as unknown as WorkspaceManifest);
const institution = surface('institution', '/areas/insights?scope=institution', 'Institution insights');
const assigned = surface('assigned', '/areas/insights?scope=assigned', 'My work insights');
const insights = manifest([area('insights', [institution, assigned])]);

test('an Insights landing offers both contributed contexts, and each selected context is terminal', () => {
  const landing = resolveNativeAreaDestination(insights, '/areas/insights');
  assert.equal(landing.state, 'landing');
  assert.deepEqual(landing.surfaces, [institution, assigned]);
  assert.equal('label' in landing && landing.label, 'insights area');
  for (const expected of [institution, assigned]) {
    const selected = resolveNativeAreaDestination(insights, expected.href);
    assert.equal(selected.state, 'selected');
    if (selected.state !== 'selected') throw new Error('Expected selected surface');
    assert.equal(selected.surface, expected);
    assert.equal(selected.label, expected.label);
    assert.equal(selected.description, expected.description);
    assert.equal(selected.href, expected.href);
    assert.deepEqual(selected.surfaces, []);
  }
});

test('a selected surface retains query filters, parameter ordering, encoded values and fragment', () => {
  const expected = surface('person', '/areas/reports/detail?relationship=dependent&person_id=child%20a');
  const source = manifest([area('reports', [expected])]);
  const href = '/areas/reports/detail?date=2026-10-28&person_id=child+a&relationship=dependent&tab=attendance#history';
  const selected = resolveNativeAreaDestination(source, href);
  assert.equal(selected.state, 'selected');
  if (selected.state !== 'selected') throw new Error('Expected selected surface');
  assert.equal(selected.surface, expected);
  assert.equal(selected.href, href);
  assert.deepEqual(selected.surfaces, []);
});

test('duplicate or conflicting contributed selectors fail closed without offering another context', () => {
  for (const href of [
    '/areas/insights?scope=institution&scope=assigned',
    '/areas/insights?scope=assigned&scope=assigned',
    '/areas/insights?scope=assigned&%73cope=institution',
    '/areas/insights?scope=unknown',
    '/areas/insights?scope=',
  ]) {
    const resolved = resolveNativeAreaDestination(insights, href);
    assert.equal(resolved.state, 'unavailable', href);
    assert.deepEqual(resolved.surfaces, [], href);
  }
});

test('partially selected and mixed peer contexts cannot fall back to an area or broader surface', () => {
  const source = manifest([area('review', [
    surface('campus', '/areas/review?scope=campus'),
    surface('dependent', '/areas/review?scope=dependent&person_id=child'),
    surface('manage', '/areas/review?surface=manage'),
  ])]);
  for (const href of [
    '/areas/review?scope=dependent',
    '/areas/review?person_id=child',
    '/areas/review?scope=dependent&person_id=another',
    '/areas/review?scope=campus&person_id=child',
    '/areas/review?surface=manage&scope=dependent&person_id=child',
  ]) {
    const resolved = resolveNativeAreaDestination(source, href);
    assert.equal(resolved.state, 'unavailable', href);
    assert.deepEqual(resolved.surfaces, [], href);
  }
});

test('selector identities are supplied by the manifest rather than a fixed query-name list', () => {
  const expected = surface('custom', '/areas/review?review_context_key=one&resource_scope_id=asset');
  const source = manifest([area('review', [expected])]);
  assert.equal(resolveNativeAreaDestination(source, '/areas/review?resource_scope_id=asset&review_context_key=one&search=lamp').state, 'selected');
  assert.equal(resolveNativeAreaDestination(source, '/areas/review?review_context_key=one&resource_scope_id=other').state, 'unavailable');
  assert.equal(resolveNativeAreaDestination(source, '/areas/review?review_context_key=one&resource_scope_id=asset&resource_scope_id=asset').state, 'unavailable');
});

test('only contributed selectors distinguish context; unrelated filters may repeat without choosing a peer', () => {
  const selected = resolveNativeAreaDestination(insights, '/areas/insights?filter=attendance&scope=assigned&filter=learning');
  assert.equal(selected.state, 'selected');
  assert.equal(selected.state === 'selected' && selected.surface, assigned);
  const landing = resolveNativeAreaDestination(insights, '/areas/insights?search=attendance');
  assert.equal(landing.state, 'landing');
  assert.deepEqual(landing.surfaces, [institution, assigned]);
});

test('a surface identical to its area route is terminal and does not offer itself or its peers', () => {
  const expected = surface('default', '/areas/review');
  const source = manifest([area('review', [expected, surface('detail', '/areas/review/detail')])]);
  const selected = resolveNativeAreaDestination(source, '/areas/review?date=2026-10-28');
  assert.equal(selected.state, 'selected');
  assert.equal(selected.state === 'selected' && selected.surface, expected);
  assert.deepEqual(selected.surfaces, []);
});

test('a more specific contributed context cannot be absorbed by a broader peer with the same selectors', () => {
  const broad = surface('self', '/areas/review?scope=self');
  const specific = surface('person', '/areas/review?scope=self&person_id=one');
  const source = manifest([area('review', [broad, specific])]);
  assert.equal(resolveNativeAreaDestination(source, broad.href).state, 'selected');
  const selected = resolveNativeAreaDestination(source, specific.href);
  assert.equal(selected.state === 'selected' && selected.surface, specific);
  assert.equal(resolveNativeAreaDestination(source, '/areas/review?scope=self&person_id=other').state, 'unavailable');
});

test('unknown paths, unoffered contexts and unsafe links never substitute a contributed destination', () => {
  for (const href of [
    '/areas/insights/detail', '/areas/unknown', '/areas/insights?scope=foreign',
    'https://elsewhere.invalid/areas/insights?scope=assigned', '//elsewhere.invalid/areas/insights',
    '/areas/../insights', '/areas/%2e%2e/insights', '/areas%2finsights', '/areas\\insights',
  ]) {
    const resolved = resolveNativeAreaDestination(insights, href);
    assert.equal(resolved.state, 'unavailable', href);
    assert.deepEqual(resolved.surfaces, [], href);
    assert.equal('surface' in resolved, false, href);
    assert.equal('area' in resolved, false, href);
  }
});

test('ambiguous contributions fail closed instead of taking the first surface or area', () => {
  const duplicate = manifest([area('insights', [institution, { ...institution, key: 'different' }])]);
  const selected = resolveNativeAreaDestination(duplicate, institution.href);
  assert.equal(selected.state, 'unavailable');
  assert.equal(selected.state === 'unavailable' && selected.reason, 'ambiguous');
  assert.deepEqual(selected.surfaces, []);
  assert.equal(resolveNativeAreaDestination(manifest([area('first', [], '/areas/review'), area('second', [], '/areas/review')]), '/areas/review').state, 'unavailable');
});

test('malformed contributed selectors are not a destination or a chooser option', () => {
  const invalid = surface('invalid', '/areas/insights?scope=assigned&scope=institution');
  const source = manifest([area('insights', [assigned, invalid])]);
  const landing = resolveNativeAreaDestination(source, '/areas/insights');
  assert.equal(landing.state, 'landing');
  assert.deepEqual(landing.surfaces, [assigned]);
  assert.equal(resolveNativeAreaDestination(manifest([area('insights', [invalid])]), '/areas/insights?scope=institution').state, 'unavailable');
});

test('the same contributed route resolves identically in Live and Simulation without changing the manifest', () => {
  const source = manifest([Object.freeze(area('insights', Object.freeze([institution, assigned])))], true);
  Object.freeze(source.areas);
  Object.freeze(source);
  const selected = resolveNativeAreaDestination(source, '/areas/insights?scope=assigned&date=2026-10-28');
  assert.equal(selected.state === 'selected' && selected.surface, assigned);
  assert.deepEqual(selected, resolveNativeAreaDestination(insights, '/areas/insights?scope=assigned&date=2026-10-28'));
});
