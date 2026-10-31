import assert from 'node:assert/strict';
import test from 'node:test';
import { campusSearchIntentChanges, campusSearchIntentHref, editCampusSearchIntent, issueCampusSearchIntent, receiveCampusSearchIntent, retainNativeCampusSelection } from '../src/lib/campus-search-intent';

const route = (search = '', page = 1, extra = '') => ({
  contextKey: 'actor:campus:publication:live', entryKey: 'map-entry',
  href: `/more/virtual-campus?map_panel=search${search ? `&map_search=${encodeURIComponent(search)}` : ''}${page > 1 ? `&map_page=${page}` : ''}${extra}`,
  search, page,
});

test('delayed prefix acknowledgement retains the latest native input and persists it after convergence', () => {
  let intent = receiveCampusSearchIntent(null, route());
  intent = editCampusSearchIntent(intent, { search: 'C', page: 1 });
  intent = issueCampusSearchIntent(intent, route('C').href);
  for (const search of ['Co', 'Computing', 'Computing Centre II']) intent = editCampusSearchIntent(intent, { search, page: 1 });
  intent = receiveCampusSearchIntent(intent, route('C'));
  assert.equal(intent.value.search, 'Computing Centre II');
  assert.equal(intent.pending, true);
  assert.deepEqual(campusSearchIntentChanges(intent), { map_search: 'Computing Centre II', map_page: null });
  intent = issueCampusSearchIntent(intent, route(intent.value.search).href);
  intent = receiveCampusSearchIntent(intent, route('Computing Centre II'));
  assert.equal(intent.value.search, 'Computing Centre II');
  assert.equal(intent.pending, false);
  assert.deepEqual(intent.issuedHrefs, []);
  assert.deepEqual(campusSearchIntentChanges(intent), {});
});

test('deletion, clearing and replacement are latest intent, not prefix-only heuristics', () => {
  for (const replacement of ['', 'Library', 'Computing Centre I']) {
    let intent = receiveCampusSearchIntent(null, route('Computing Centre'));
    intent = editCampusSearchIntent(intent, { search: 'Computing Centre II', page: 1 });
    intent = issueCampusSearchIntent(intent, route(intent.value.search).href);
    intent = editCampusSearchIntent(intent, { search: replacement, page: 1 });
    intent = receiveCampusSearchIntent(intent, route('Computing Centre II'));
    assert.equal(intent.value.search, replacement);
    assert.equal(intent.pending, true);
    intent = issueCampusSearchIntent(intent, route(replacement).href);
    assert.equal(receiveCampusSearchIntent(intent, route(replacement)).pending, false);
  }
});

test('editing back to the current route before persistence does not leave a pending input', () => {
  let intent = receiveCampusSearchIntent(null, route('Library'));
  intent = editCampusSearchIntent(intent, { search: 'Library annex', page: 1 });
  intent = editCampusSearchIntent(intent, { search: 'Library', page: 1 });
  intent = issueCampusSearchIntent(intent, route('Library').href);
  assert.equal(intent.pending, false);
  assert.deepEqual(intent.issuedHrefs, []);
});

test('a click before search persistence carries the latest text and page into its route', () => {
  let intent = receiveCampusSearchIntent(null, route('Old search', 4));
  intent = editCampusSearchIntent(intent, { search: 'Computing Centre II', page: 1 });
  const selected = route(intent.value.search, 1, '&map_place=building-ii');
  intent = issueCampusSearchIntent(intent, selected.href);
  intent = receiveCampusSearchIntent(intent, selected);
  assert.deepEqual(intent.value, { search: 'Computing Centre II', page: 1 });
  assert.equal(intent.pending, false);
});

test('a selection made while an older search route is in flight survives that older acknowledgement', () => {
  let intent = receiveCampusSearchIntent(null, route());
  intent = editCampusSearchIntent(intent, { search: 'C', page: 1 });
  intent = issueCampusSearchIntent(intent, route('C').href);
  const destination = route('C', 1, '&map_place=building-ii&map_full=1');
  intent = issueCampusSearchIntent(intent, destination.href);
  intent = receiveCampusSearchIntent(intent, route('C'));
  assert.equal(intent.pending, true, 'the earlier text acknowledgement is not the selected destination');
  const target = new URL(campusSearchIntentHref(intent, route('C').href), 'https://thatcampus.invalid');
  assert.equal(target.searchParams.get('map_place'), 'building-ii');
  assert.equal(target.searchParams.get('map_full'), '1');
  intent = receiveCampusSearchIntent(intent, destination);
  assert.equal(intent.pending, false);
});

test('a retry updates newest text without discarding the latest intended panel or place', () => {
  let intent = receiveCampusSearchIntent(null, route());
  intent = editCampusSearchIntent(intent, { search: 'C', page: 1 });
  intent = issueCampusSearchIntent(intent, route('C', 1, '&map_place=building-ii').href);
  intent = editCampusSearchIntent(intent, { search: 'Computing Centre II', page: 1 });
  const target = new URL(campusSearchIntentHref(intent, route().href), 'https://thatcampus.invalid');
  assert.equal(target.searchParams.get('map_search'), 'Computing Centre II');
  assert.equal(target.searchParams.get('map_place'), 'building-ii');
});

test('Back, new route entries, publication and world changes restore the actual route', () => {
  let pending = receiveCampusSearchIntent(null, route('Initial', 3));
  pending = editCampusSearchIntent(pending, { search: 'Unacknowledged text', page: 1 });
  pending = issueCampusSearchIntent(pending, route(pending.value.search).href);
  for (const incoming of [
    { ...route('Back search', 2), entryKey: 'retained-parent-entry' },
    { ...route('Simulation search', 4), contextKey: 'actor:campus:publication:simulation-world' },
    { ...route('New publication'), contextKey: 'actor:campus:publication-2:live' },
    route('External deep link', 2),
  ]) {
    const restored = receiveCampusSearchIntent(pending, incoming);
    assert.deepEqual(restored.value, { search: incoming.search, page: incoming.page });
    assert.equal(restored.pending, false);
    assert.deepEqual(restored.issuedHrefs, []);
  }
});

test('query ordering and repeated renders do not turn own acknowledgements into external intent', () => {
  let intent = receiveCampusSearchIntent(null, route());
  intent = editCampusSearchIntent(intent, { search: 'Library', page: 2 });
  intent = issueCampusSearchIntent(intent, '/more/virtual-campus?map_page=2&map_search=Library&map_panel=search');
  assert.equal(receiveCampusSearchIntent(intent, route()), intent);
  intent = receiveCampusSearchIntent(intent, route('Library', 2));
  assert.equal(intent.pending, false);
  assert.equal(editCampusSearchIntent(intent, { search: 'Library', page: 2 }), intent);
});

test('native text and paging share the bounded URL presentation contract', () => {
  let intent = receiveCampusSearchIntent(null, route());
  intent = editCampusSearchIntent(intent, { search: 'x'.repeat(300), page: 50000 });
  assert.equal(intent.value.search.length, 200);
  assert.equal(intent.value.page, 10000);
  assert.equal(editCampusSearchIntent(intent, { search: '', page: NaN }).value.page, 1);
  for (let i = 0; i < 100; i++) intent = issueCampusSearchIntent(intent, route(String(i)).href);
  assert.equal(intent.issuedHrefs.length, 32);
});

test('search-only route updates retain selection identity; actual place/floor changes do not', () => {
  const selection = { selectedId: 'room', spaceId: 'room-place', buildingId: 'building', floorId: 'floor' };
  assert.equal(retainNativeCampusSelection(selection, { ...selection }), selection);
  for (const key of ['selectedId', 'spaceId', 'buildingId', 'floorId'] as const) {
    const changed = { ...selection, [key]: null };
    assert.equal(retainNativeCampusSelection(selection, changed), changed);
  }
});
