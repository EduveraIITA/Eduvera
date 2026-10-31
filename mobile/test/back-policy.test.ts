import assert from 'node:assert/strict';
import test from 'node:test';
import { BaseRouter } from 'expo-router/build/react-navigation/routers/BaseRouter';
import { getPathFromState } from 'expo-router/build/fork/getPathFromState';
import { TabRouter } from 'expo-router/build/react-navigation/routers/TabRouter';
import { getStackBrowserHistoryAction } from 'expo-router/build/react-navigation/routers/StackRouter';
import {
  campusBackFallback,
  campusExistingBackTarget,
  campusHrefForRoute,
  campusOwnerTitle,
  campusRemovedGuards,
  campusTransitionKind,
  focusedCampusRoute,
  isCampusWorkspaceRoot,
  isFocusedCampusAncestor,
  previousCampusStackRoute,
  projectCampusExistingBack,
  projectCampusOriginReturn,
  projectCampusTabReset,
  sameCampusHref,
  type CampusNavigationRoute,
  type CampusNavigationState,
  type CampusRouteOrigin,
} from '../src/lib/back-policy';

const liveScope = 'actor:campus:live';
const simulationScope = 'actor:campus:simulation:run-1';
type FixtureRoute = CampusNavigationRoute & { readonly isPreloaded?: true };

function navigator(
  key: string,
  type: 'stack' | 'tab',
  routes: readonly FixtureRoute[],
  index = routes.length - 1,
  history?: CampusNavigationState['history'],
): CampusNavigationState {
  return {
    key, type, stale: false, routeKeySeq: 20,
    routeNames: [...new Set(routes.map(route => route.name))],
    routes, index, ...(history ? { history } : {}),
  };
}

function findRoute(state: CampusNavigationState, key: string): FixtureRoute | undefined {
  for (const route of state.routes) {
    if (route.key === key) return route;
    const child = route.state && findRoute(route.state, key);
    if (child) return child;
  }
  return undefined;
}

function findState(state: CampusNavigationState, key: string): CampusNavigationState | undefined {
  if (state.key === key) return state;
  for (const route of state.routes) {
    const child = route.state && findState(route.state, key);
    if (child) return child;
  }
  return undefined;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function retainedFixture(options: { emptyUnrelated?: boolean; preload?: boolean; history?: CampusNavigationState['history']; sourceCovered?: boolean } = {}) {
  const source: FixtureRoute = {
    key: 'work-item:0-1-1', name: '[...path]',
    params: { path: ['tasks'], item: 'task-7', date: '2026-10-29', search: 'Ada', page: '3', expanded: ['due', 'assigned'], scope: 'responsibility' },
    path: '/work/tasks?item=task-7&date=2026-10-29&search=Ada&page=3',
  };
  const work = navigator('navigator:0-1', 'stack', [
    { key: 'work-index:0-1-0', name: 'index', params: { view: 'mine', search: 'Ada', page: '3' } },
    source,
    ...(options.sourceCovered ? [{ key: 'work-other:0-1-2', name: '[...path]', params: { path: ['tasks'], item: 'task-8' } }] : []),
  ]);
  const destination: FixtureRoute = {
    key: 'area-loan:0-2-1', name: '[...path]',
    params: { path: ['resources'], loan_id: 'loan-9', date: '2026-10-29', search: 'microscope', page: '2', scope: 'responsibility' },
    path: '/areas/resources?loan_id=loan-9&search=microscope&page=2',
  };
  const preload: FixtureRoute = { key: 'area-preload:0-2-2', name: '[...path]', params: { path: ['calendar'], entry: 'event-4' }, isPreloaded: true };
  const areas = navigator('navigator:0-2', 'stack', [
    { key: 'area-index:0-2-0', name: 'index', params: { search: 'science' } },
    destination,
    ...(options.preload ? [preload] : []),
  ], 1);
  const today = navigator('navigator:0-0', 'stack', [{ key: 'today-index:0-0-0', name: 'index', params: { date: '2026-10-29' } }]);
  const more = navigator('navigator:0-3', 'stack', options.emptyUnrelated ? [] : [{ key: 'more-index:0-3-0', name: 'index', params: { search: 'policy' } }]);
  const tabs = navigator('navigator:0', 'tab', [
    { key: 'today:0-0', name: 'today', state: today },
    { key: 'work:0-1', name: 'work', state: work },
    { key: 'areas:0-2', name: 'areas', state: areas },
    { key: 'more:0-3', name: 'more', state: more },
  ], 2, options.history ?? [{ type: 'route', key: 'today:0-0' }, { type: 'route', key: 'work:0-1' }, { type: 'route', key: 'areas:0-2' }]);
  const state = freeze(navigator('navigator:root', 'stack', [{ key: '(campus):0', name: '(campus)', state: tabs }]));
  const origin: CampusRouteOrigin = { scopeKey: liveScope, destinationKey: destination.key, originKey: source.key };
  return { state, origin, source, destination, preload, work, areas, today, more };
}

test('Work to Areas returns to the exact retained Work entry and preserves its view state', () => {
  const fixture = retainedFixture();
  const before = structuredClone(fixture.state);
  const projected = projectCampusOriginReturn(fixture.state, fixture.origin, liveScope);
  assert.ok(projected);
  assert.equal(focusedCampusRoute(projected), fixture.source);
  assert.equal(findRoute(projected, fixture.source.key), fixture.source);
  assert.equal(findState(projected, fixture.work.key), fixture.work);
  assert.equal(findState(projected, fixture.today.key), fixture.today);
  assert.equal(findState(projected, fixture.more.key), fixture.more);
  assert.deepEqual(focusedCampusRoute(projected)?.params, fixture.source.params);
  assert.equal(focusedCampusRoute(projected)?.path, fixture.source.path);
  assert.equal(findRoute(projected, fixture.destination.key), undefined);
  assert.deepEqual(findState(projected, fixture.areas.key)?.routes.map(route => route.key), ['area-index:0-2-0']);
  assert.equal(findState(projected, fixture.areas.key)?.index, 0);
  assert.equal(projected.key, fixture.state.key);
  assert.equal(projected.routeKeySeq, fixture.state.routeKeySeq);
  assert.equal(findState(projected, 'navigator:0')?.routeKeySeq, 20);
  assert.deepEqual(fixture.state, before, 'projection must not mutate the retained router tree');
});

test('an unrelated complete empty navigator does not block an exact retained return', () => {
  const { state, origin, more, source } = retainedFixture({ emptyUnrelated: true });
  assert.equal(more.index, -1);
  assert.deepEqual(more.routes, []);
  const projected = projectCampusOriginReturn(state, origin, liveScope);
  assert.ok(projected);
  assert.equal(focusedCampusRoute(projected)?.key, source.key);
  assert.equal(findState(projected, more.key), more);
});

test('preloaded routes after the active destination survive its removal unchanged', () => {
  const { state, origin, preload, areas } = retainedFixture({ preload: true });
  const projected = projectCampusOriginReturn(state, origin, liveScope);
  assert.ok(projected);
  const nextAreas = findState(projected, areas.key)!;
  assert.equal(nextAreas.index, 0);
  assert.deepEqual(nextAreas.routes.map(route => route.key), ['area-index:0-2-0', preload.key]);
  assert.equal(nextAreas.routes[1], preload);
  assert.equal((nextAreas.routes[1] as FixtureRoute).isPreloaded, true);
  assert.equal(nextAreas.routeKeySeq, areas.routeKeySeq);
});

test('tab history trims to the most recent actual origin visit', () => {
  const { state, origin } = retainedFixture({ history: [
    { type: 'route', key: 'work:0-1' }, { type: 'route', key: 'today:0-0' },
    { type: 'route', key: 'work:0-1' }, { type: 'route', key: 'more:0-3' },
    { type: 'route', key: 'areas:0-2' },
  ] });
  const projected = projectCampusOriginReturn(state, origin, liveScope);
  assert.ok(projected);
  assert.deepEqual(findState(projected, 'navigator:0')?.history, [
    { type: 'route', key: 'work:0-1' }, { type: 'route', key: 'today:0-0' }, { type: 'route', key: 'work:0-1' },
  ]);
});

test('initial-route tab history can omit the retained source without retaining the departed target as Back', () => {
  const { state, origin } = retainedFixture({ history: [
    { type: 'route', key: 'today:0-0' }, { type: 'custom', key: 'retained-metadata' }, { type: 'route', key: 'areas:0-2' },
  ] });
  const projected = projectCampusOriginReturn(state, origin, liveScope);
  assert.ok(projected);
  assert.deepEqual(findState(projected, 'navigator:0')?.history, [
    { type: 'route', key: 'today:0-0' }, { type: 'custom', key: 'retained-metadata' }, { type: 'route', key: 'work:0-1' },
  ]);
});

test('retained returns refuse account or Live/Simulation scope changes', () => {
  const { state, origin } = retainedFixture();
  for (const scope of [simulationScope, 'another-actor:campus:live', 'actor:another-campus:live']) {
    assert.equal(projectCampusOriginReturn(state, origin, scope), null, scope);
  }
});

test('retained returns refuse missing, identical, or no longer focused route keys', () => {
  const { state, origin } = retainedFixture();
  for (const changed of [
    { ...origin, originKey: 'removed-source' },
    { ...origin, destinationKey: 'removed-destination' },
    { ...origin, destinationKey: origin.originKey },
    { ...origin, destinationKey: 'area-index:0-2-0' },
  ]) assert.equal(projectCampusOriginReturn(state, changed, liveScope), null);
});

test('a newer screen above the retained source cannot be discarded to return to the old editor', () => {
  const { state, origin } = retainedFixture({ sourceCovered: true });
  assert.equal(projectCampusOriginReturn(state, origin, liveScope), null);
});

test('incomplete navigation state is refused rather than relying on RESET to invent keys', () => {
  const { state, origin } = retainedFixture();
  for (const changed of [{ ...state, stale: true }, { ...state, routeKeySeq: undefined }, { ...state, index: -1 }, { ...state, routeNames: undefined }]) {
    assert.equal(projectCampusOriginReturn(changed, origin, liveScope), null);
  }
});

test('same-stack return removes only the current detail and preserves a preload', () => {
  const first = { key: 'root:0', name: 'index', params: { search: 'Ada' } };
  const source = { key: 'source:1', name: '[...path]', params: { path: ['resources'], search: 'microscope', page: '2' } };
  const destination = { key: 'destination:2', name: '[...path]', params: { path: ['resources'], loan_id: 'loan-9' } };
  const preload: FixtureRoute = { key: 'preload:3', name: '[...path]', params: { path: ['calendar'] }, isPreloaded: true };
  const state = freeze(navigator('navigator:root', 'stack', [first, source, destination, preload], 2));
  assert.equal(previousCampusStackRoute(state), source);
  const projected = projectCampusOriginReturn(state, { scopeKey: liveScope, originKey: source.key, destinationKey: destination.key }, liveScope);
  assert.ok(projected);
  assert.equal(projected.index, 1);
  assert.deepEqual(projected.routes, [first, source, preload]);
  assert.equal(focusedCampusRoute(projected), source);
});

test('a root in the innermost stack has no previous screen borrowed from an ancestor stack', () => {
  const inner = navigator('navigator:1', 'stack', [{ key: 'inner-index:1-0', name: 'index' }]);
  const state = navigator('navigator:root', 'stack', [{ key: 'old:0', name: 'index' }, { key: 'current:1', name: 'areas', state: inner }]);
  assert.equal(previousCampusStackRoute(state), null);
});

function coldFixture() {
  const anchor: FixtureRoute = { key: 'updates:0-0-1', name: '[...path]', params: { path: ['messages', 'updates'], scope: 'dependent', student_id: 'student-4', search: 'trip', updates_page: '2' } };
  const detail: FixtureRoute = { key: 'notice:0-0-2', name: '[...path]', params: { path: ['messages', 'updates', 'notice-7'], scope: 'dependent', student_id: 'student-4' } };
  const editor: FixtureRoute = { key: 'notice-edit:0-0-3', name: '[...path]', params: { path: ['messages', 'updates', 'notice-7', 'edit'], scope: 'dependent', student_id: 'student-4' } };
  const preload: FixtureRoute = { key: 'preload:0-0-4', name: '[...path]', params: { path: ['calendar'] }, isPreloaded: true };
  const areas = navigator('navigator:0-0', 'stack', [{ key: 'area-index:0-0-0', name: 'index' }, anchor, detail, editor, preload], 3);
  const work = navigator('navigator:0-1', 'stack', [{ key: 'unrelated:0-1-0', name: '[...path]', params: { path: ['messages', 'updates'], scope: 'dependent', student_id: 'student-4', search: 'trip', updates_page: '2' } }]);
  const tabs = navigator('navigator:0', 'tab', [{ key: 'areas:0-0', name: 'areas', state: areas }, { key: 'work:0-1', name: 'work', state: work }], 0, [{ type: 'route', key: 'areas:0-0' }]);
  const state = freeze(navigator('navigator:root', 'stack', [{ key: '(campus):0', name: '(campus)', state: tabs }]));
  return { state, areas, work, anchor, detail, editor, preload };
}

test('cold anchors derive their actual href from route params, including scope and repeated query values', () => {
  const { state, anchor } = coldFixture();
  assert.equal(campusHrefForRoute(state, anchor.key), '/areas/messages/updates?scope=dependent&student_id=student-4&search=trip&updates_page=2');
  assert.equal(campusHrefForRoute(state, 'area-index:0-0-0'), '/areas');
  assert.equal(campusHrefForRoute(state, 'missing'), null);
  const repeated = navigator('navigator:root', 'stack', [{ key: 'areas:0', name: 'areas', state: navigator('navigator:0', 'stack', [{ key: 'filter:0-0', name: '[...path]', params: { path: ['people'], search: ['Ada', 'Grace'], screen: 'ignored', initial: 'ignored' } }]) }]);
  assert.equal(campusHrefForRoute(repeated, 'filter:0-0'), '/areas/people?search=Ada&search=Grace');
});

test('an existing semantic parent pops the focused stack without touching a retained tab or preload', () => {
  const { state, areas, work, anchor, editor, preload } = coldFixture();
  const href = '/areas/messages/updates?updates_page=2&search=trip&student_id=student-4&scope=dependent';
  assert.equal(campusExistingBackTarget(state, href), anchor);
  const projected = projectCampusExistingBack(state, editor.key, anchor.key);
  assert.ok(projected);
  assert.equal(focusedCampusRoute(projected), anchor);
  assert.deepEqual(findState(projected, areas.key)?.routes.map(route => route.key), ['area-index:0-0-0', anchor.key, preload.key]);
  assert.equal(findState(projected, areas.key)?.index, 1);
  assert.equal(findRoute(projected, preload.key), preload);
  assert.equal(findState(projected, work.key), work);
  assert.equal(findState(projected, areas.key)?.routeKeySeq, areas.routeKeySeq);
});

test('existing-parent projection refuses another retained stack, a future preload, and an unfocused destination', () => {
  const { state, anchor, detail, editor, preload } = coldFixture();
  assert.equal(projectCampusExistingBack(state, editor.key, 'unrelated:0-1-0'), null);
  assert.equal(projectCampusExistingBack(state, editor.key, preload.key), null);
  assert.equal(projectCampusExistingBack(state, detail.key, anchor.key), null);
  assert.equal(projectCampusExistingBack(state, editor.key, editor.key), null);
  assert.equal(campusExistingBackTarget(state, '/work/messages/updates?scope=dependent&student_id=student-4&search=trip&updates_page=2'), null);
});

test('focused ancestry follows only the actual active route branch', () => {
  const { state, source, destination } = retainedFixture();
  assert.equal(isFocusedCampusAncestor(state, '(campus):0'), true);
  assert.equal(isFocusedCampusAncestor(state, 'areas:0-2'), true);
  assert.equal(isFocusedCampusAncestor(state, destination.key), true);
  assert.equal(isFocusedCampusAncestor(state, source.key), false);
  assert.equal(isFocusedCampusAncestor(undefined, destination.key), false);
});

test('the installed SDK 58 BaseRouter accepts the full projected RESET without reminting route keys', () => {
  const { state, origin } = retainedFixture({ preload: true, emptyUnrelated: true });
  const projected = projectCampusOriginReturn(state, origin, liveScope);
  assert.ok(projected);
  const router = BaseRouter({});
  type RouterState = Parameters<typeof router.getStateForAction>[0];
  const current = structuredClone(state) as RouterState;
  const payload = structuredClone(projected) as RouterState;
  const result = router.getStateForAction(current, { type: 'RESET', payload }, { routeNames: current.routeNames, routeGetIdList: {} });
  assert.equal(typeof result, 'object', 'RESET must be handled rather than rejected as a partial state');
  assert.ok(result && typeof result === 'object' && 'state' in result);
  assert.deepEqual(result.state, projected);
  assert.equal(result.state.key, state.key);
  assert.equal(result.state.routeKeySeq, state.routeKeySeq);
  assert.equal(result.affectedRouteKey, '(campus):0');
});

test('SDK 58 JUMP_TO creates a declared but unvisited tab without resetting the current tab', () => {
  const more = navigator('navigator:0-0', 'stack', [{ key: 'more-index:0-0-0', name: 'index', params: { search: 'policies', page: '2' } }]);
  const router = TabRouter({ backBehavior: 'fullHistory' });
  type RouterState = Parameters<typeof router.getStateForAction>[0];
  const state = {
    ...navigator('navigator:0', 'tab', [{ key: 'more:0-0', name: 'more', state: more }], 0, [{ type: 'route', key: 'more:0-0' }]),
    routeNames: ['today', 'work', 'areas', 'more'],
  } as RouterState;
  assert.equal(state.routes.find(route => route.name === 'areas'), undefined);
  assert.equal(state.routeNames.includes('areas'), true);
  const result = router.getStateForAction(state, { type: 'JUMP_TO', target: state.key, payload: { name: 'areas' } }, { routeNames: state.routeNames, routeGetIdList: {} });
  assert.ok(result && typeof result === 'object' && 'state' in result);
  const selected = result.state.routes[result.state.index]!;
  assert.equal(selected.name, 'areas');
  assert.ok(selected.key);
  assert.notEqual(selected.key, state.routes[0]!.key);
  assert.equal(result.state.routes.find(route => route.name === 'more')?.state, more);
  assert.equal(result.state.routeKeySeq, state.routeKeySeq + 1);
  assert.deepEqual(result.browserHistory, { type: 'push' });
});

test('SDK 58 repeated retained tab selection preserves child identity and query state', () => {
  const fixture = retainedFixture();
  const tabs = findState(fixture.state, 'navigator:0')!;
  const router = TabRouter({ backBehavior: 'fullHistory' });
  type RouterState = Parameters<typeof router.getStateForAction>[0];
  let state = tabs as RouterState;
  const originalAreas = state.routes.find(route => route.name === 'areas')!;
  const originalWork = state.routes.find(route => route.name === 'work')!;
  for (const name of ['work', 'areas', 'work', 'areas', 'areas']) {
    const retained = state.routes.find(route => route.name === name)!;
    const result = router.getStateForAction(state, { type: 'JUMP_TO', target: state.key, payload: { name, ...(retained.params ? { params: retained.params } : {}) } }, { routeNames: state.routeNames, routeGetIdList: {} });
    assert.ok(result && typeof result === 'object' && 'state' in result);
    state = result.state;
    assert.equal(state.routes[state.index]!.name, name);
    assert.equal(state.routes.find(route => route.name === 'areas'), originalAreas);
    assert.equal(state.routes.find(route => route.name === 'work'), originalWork);
    assert.equal(state.routes.find(route => route.name === 'areas')?.state, fixture.areas);
    assert.equal(state.routes.find(route => route.name === 'work')?.state, fixture.work);
    assert.equal(focusedCampusRoute(fixture.areas)?.params, fixture.destination.params);
    assert.equal(focusedCampusRoute(fixture.work)?.params, fixture.source.params);
    assert.equal(state.routeKeySeq, tabs.routeKeySeq);
  }
});

const detailQueries: readonly [string, string][] = [
  ['attendance', 'register_id=register-1'], ['attendance', 'occurrence_id=occurrence-1'], ['attendance', 'session_id=session-1'], ['attendance', 'class_section_id=class-1'], ['attendance', 'review_case=case-1'], ['attendance', 'leave_id=leave-1'], ['attendance', 'request=request-1'], ['attendance', 'view=apply'], ['attendance', 'tab=apply'], ['attendance', 'attendance_record_id=record-1'], ['attendance', 'authority_change_id=change-1'],
  ['messages', 'conversation=conversation-1'], ['messages', 'conversation_id=conversation-1'], ['messages', 'compose=new'], ['messages', 'notice_id=notice-1'], ['messages', 'assignment=assignment-1'], ['messages', 'item=item-1'], ['messages', 'diary_id=diary-1'], ['messages', 'practice=practice-1'], ['messages', 'report=report-1'], ['messages', 'section=section-1'], ['messages', 'edit=notice-1'], ['messages', 'create=new'],
  ['people', 'person_id=person-1'], ['people', 'group_id=group-1'], ['people', 'student=student-1'], ['people', 'guardian=guardian-1'], ['people', 'edit=person-1'], ['people', 'profile_view=profile-1'],
  ['resources', 'loan_id=loan-1'], ['resources', 'action=return'], ['resources', 'view=setup'], ['facilities', 'repair_id=repair-1'], ['facilities', 'action=report'],
  ['accommodation', 'stay_id=stay-1'], ['accommodation', 'room_id=room-1'], ['accommodation', 'offer=offer-1'], ['accommodation', 'repair_id=repair-1'],
  ['dining', 'service_id=service-1'], ['dining', 'session_id=session-1'], ['dining', 'issue_id=issue-1'], ['dining', 'plan_id=plan-1'], ['dining', 'series_id=series-1'], ['dining', 'action=report'],
  ['assessments', 'assessment=assessment-1'], ['assessments', 'assessment_id=assessment-1'], ['assessments', 'publication_id=publication-1'], ['assessments', 'report_batch_id=batch-1'],
  ['results', 'assessment=assessment-1'], ['results', 'assessment_id=assessment-1'], ['results', 'publication_id=publication-1'], ['results', 'report_batch_id=batch-1'],
  ['fees', 'invoice=invoice-1'], ['fees', 'invoice_id=invoice-1'], ['fees', 'receipt=receipt-1'],
  ['responsibilities', 'request=request-1'], ['responsibilities', 'coverage=coverage-1'], ['responsibilities', 'assignment=assignment-1'], ['responsibilities', 'create=leave'],
  ['in-out', 'visitor=visitor-1'], ['in-out', 'visit=visit-1'], ['in-out', 'shared=visit-1'],
  ['departure', 'request_id=request-1'], ['departure', 'trip_id=trip-1'], ['departure', 'plan_id=plan-1'], ['departure', 'swap=swap-1'],
  ['timetable', 'period_id=period-1'], ['timetable', 'occurrence_id=occurrence-1'], ['timetable', 'session_id=session-1'], ['timetable', 'assignment=assignment-1'], ['timetable', 'learner=learner-1'], ['timetable', 'item=item-1'], ['timetable', 'diary_id=diary-1'], ['timetable', 'practice=practice-1'],
  ['calendar', 'entry=event-1'], ['campus-view', 'place_id=place-1'], ['campus-view', 'place=place-1'], ['assistant', 'thread=thread-1'], ['feedback', 'campaign=campaign-1'],
];

for (const [area, query] of detailQueries) {
  test(`${area} ${query} opens a navigation level and removing that detail returns`, () => {
    const list = `/areas/${area}?date=2026-10-29&search=Ada&page=2&scope=dependent&student_id=student-4`;
    const detail = `${list}&${query}`;
    assert.equal(campusTransitionKind(list, detail), 'open');
    assert.equal(campusTransitionKind(detail, list), 'return');
  });
}

for (const key of ['period_id', 'occurrence_id']) {
  test(`timetable changing ${key} selects a new detail while date and roster filters only update it`, () => {
    const detail = `/areas/timetable?${key}=one&date=2026-10-29&scope=responsibility`;
    assert.equal(campusTransitionKind(detail, `/areas/timetable?${key}=two&date=2026-10-29&scope=responsibility`), 'open');
    assert.equal(campusTransitionKind(detail, `${detail}&search=Ada&page=3&view=week&student_id=student-4`), 'update');
    const fallback = campusBackFallback(`${detail}&attention_notification_id=attention-1&period_revision=7&occurrence_revision=8`);
    assert.ok(fallback);
    assert.equal(fallback.title, 'Timetable');
    assert.equal(new URL(fallback.href, 'https://campus.invalid').searchParams.has(key), false);
    assert.equal(new URL(fallback.href, 'https://campus.invalid').searchParams.get('date'), '2026-10-29');
    assert.equal(new URL(fallback.href, 'https://campus.invalid').searchParams.has('attention_notification_id'), false);
    assert.equal(new URL(fallback.href, 'https://campus.invalid').searchParams.has('period_revision'), false);
  });
}

test('search, date, scope, pagination and non-editor view changes update the current route', () => {
  for (const href of ['/areas/attendance', '/areas/timetable', '/areas/messages/updates', '/areas/resources', '/areas/dining', '/areas/people', '/work', '/more/account']) {
    assert.equal(campusTransitionKind(href, `${href}?search=Ada&q=Grace&date=2026-10-29&page=2&updates_page=3&scope=dependent&student_id=student-4&view=week`), 'update', href);
  }
});

test('Work items and More policy/Simulation details create and remove navigation levels', () => {
  for (const query of ['item=work-1', 'request=request-1', 'request_id=request-1', 'invoice=invoice-1', 'invoice_id=invoice-1', 'visit=visit-1', 'leave_id=leave-1']) {
    assert.equal(campusTransitionKind('/work?filter=mine', `/work?filter=mine&${query}`), 'open');
    assert.equal(campusTransitionKind(`/work?filter=mine&${query}`, '/work?filter=mine'), 'return');
  }
  for (const [base, query] of [['/more/policies', 'policy=policy-1'], ['/more/simulation', 'run=run-1'], ['/more/simulation', 'view=manage']]) {
    assert.equal(campusTransitionKind(base!, `${base}?${query}`), 'open');
    assert.equal(campusTransitionKind(`${base}?${query}`, base!), 'return');
  }
});

test('a real path parent returns while sibling details open and reordered query parameters do nothing', () => {
  assert.equal(campusTransitionKind('/areas/messages/updates/notice-1/edit', '/areas/messages/updates/notice-1'), 'return');
  assert.equal(campusTransitionKind('/areas/messages/updates/notice-1', '/areas/messages/updates'), 'return');
  assert.equal(campusTransitionKind('/areas/messages/updates/notice-1', '/areas/messages/updates/notice-2'), 'open');
  assert.equal(campusTransitionKind('/areas/fees?invoice=one', '/areas/fees?invoice=two'), 'open');
  assert.equal(campusTransitionKind('/areas/timetable?period_id=p&date=2026-10-29', '/areas/timetable?date=2026-10-29&period_id=p'), 'none');
  assert.equal(sameCampusHref('/areas/timetable/?date=one', '/areas/timetable?date=one'), true);
});

test('removing one nested query detail returns without dropping the retained outer identity', () => {
  assert.equal(campusTransitionKind('/areas/timetable?period_id=p&occurrence_id=o&search=Ada', '/areas/timetable?period_id=p&search=Ada'), 'return');
  assert.deepEqual(campusBackFallback('/areas/timetable?period_id=p&occurrence_id=o&search=Ada'), { href: '/areas/timetable?period_id=p&search=Ada', title: 'Timetable' });
});

const ownerLabels: readonly [string, string][] = [
  ['/today', 'Today'], ['/work', 'Work'], ['/areas', 'Areas'], ['/more', 'More'],
  ['/areas/attendance?register_id=one', 'Attendance'], ['/areas/messages/updates?notice_id=one', 'Updates'], ['/areas/messages/conversations?conversation=one', 'Messages'],
  ['/areas/people?person_id=one', 'People'], ['/areas/resources?loan_id=one', 'Resources'], ['/areas/facilities?repair_id=one', 'Repairs'], ['/areas/accommodation?stay_id=one', 'Accommodation'],
  ['/areas/dining?service_id=one', 'Dining'], ['/areas/assessments?assessment_id=one', 'Assessments'], ['/areas/results?report_batch_id=one', 'Results & progress'], ['/areas/fees?invoice=one', 'Fees & receipts'],
  ['/areas/responsibilities?assignment=one', 'Responsibilities'], ['/work/staff-leave?request=one', 'Staff leave'], ['/areas/in-out?visit=one', 'In & Out'], ['/areas/departure?trip_id=one', 'Departure'],
  ['/areas/calendar?entry=one', 'Calendar'], ['/areas/timetable?period_id=one', 'Timetable'], ['/areas/session?item=one', 'Teaching sessions'], ['/areas/campus-view?place_id=one', 'Campus'],
  ['/areas/assistant?thread=one', 'Assistant'], ['/areas/feedback?campaign=one', 'Teaching feedback'], ['/areas/events?item=one', 'Events & activities'], ['/areas/reports?scheme=one', 'Reports'],
  ['/areas/reports/remarks?batch=one', 'Report remarks'], ['/more/policies?policy=one', 'Policies'], ['/more/simulation?run=one', 'Simulation'], ['/more/notifications?item=one', 'Notifications'], ['/more/account?edit=one', 'Account'], ['/more/account/security?edit=one', 'Account security'],
];

for (const [href, title] of ownerLabels) {
  test(`${href} has an explicit cold-link owner label`, () => {
    assert.equal(campusOwnerTitle(href), title);
    const fallback = campusBackFallback(href);
    if (new URL(href, 'https://campus.invalid').search) {
      assert.ok(fallback);
      assert.equal(fallback.title, title);
      assert.notEqual(fallback.href, href);
    }
  });
}

test('cold path parents preserve usable list context and workspace roots have no synthetic Back', () => {
  assert.deepEqual(campusBackFallback('/areas/messages/updates/notice-1?scope=dependent&student_id=student-4&date=2026-10-29&search=trip&updates_page=2&attention_notification_id=attention-1'), {
    href: '/areas/messages/updates?scope=dependent&student_id=student-4&date=2026-10-29&search=trip&updates_page=2', title: 'Updates',
  });
  assert.deepEqual(campusBackFallback('/areas/timetable'), { href: '/areas', title: 'Areas' });
  for (const href of ['/today', '/work', '/areas', '/more', '/work?search=Ada&page=2']) {
    assert.equal(campusBackFallback(href), null, href);
    assert.equal(isCampusWorkspaceRoot(href), true, href);
  }
  assert.equal(isCampusWorkspaceRoot('/work?item=work-1'), false);
  assert.equal(isCampusWorkspaceRoot('/areas/timetable'), false);
});


test('a cold index-anchor return cleans actual SDK serialization while retaining meaningful query parameters', () => {
  const meaningful = { scope: 'dependent',student_id: 'student-4',date: '2026-10-29',search: 'Ada',page: '3',expanded: ['due','assigned'] };
  const anchor: FixtureRoute = { key: 'area-index',name: 'index',params: { path: ['assessments','manage'],...meaningful } };
  const detail: FixtureRoute = { key: 'manage',name: '[...path]',params: { path: ['assessments','manage'] } };
  const preload: FixtureRoute = { key: 'future',name: '[...path]',params: { path: ['calendar'] },isPreloaded: true };
  const area = navigator('areas-stack','stack',[anchor,detail,preload],1);
  const state = freeze(navigator('tabs','tab',[{ key: 'areas-tab',name: 'areas',state: area }]));
  const projected = projectCampusExistingBack(state,detail.key,anchor.key)!;
  assert.ok(projected); const index = focusedCampusRoute(projected)!;
  assert.equal(index.key,anchor.key); assert.deepEqual(index.params,meaningful);
  assert.deepEqual(anchor.params,{ path: ['assessments','manage'],...meaningful });
  assert.equal(findRoute(projected,preload.key),preload);
  const options = { screens: { areas: { path: 'areas',screens: { index: '', '[...path]': '*path' } } } };
  const before = getPathFromState({ ...state,routes: [{ ...state.routes[0]!,state: { ...area,index: 0 } }] } as Parameters<typeof getPathFromState>[0],options);
  assert.deepEqual(new URL(before,'https://campus.invalid').searchParams.getAll('path'),['assessments','manage']);
  const after = getPathFromState(projected as Parameters<typeof getPathFromState>[0],options);
  const url = new URL(after,'https://campus.invalid');
  assert.equal(url.pathname,'/areas'); assert.equal(url.searchParams.has('path'),false);
  assert.equal(url.searchParams.get('student_id'),'student-4'); assert.equal(url.searchParams.get('date'),'2026-10-29'); assert.equal(url.searchParams.get('search'),'Ada'); assert.equal(url.searchParams.get('page'),'3');
  assert.deepEqual(url.searchParams.getAll('expanded'),['due','assigned']);
});

test('a native retained-origin return cleans newly revealed index anchors in both real stacks', () => {
  const source: FixtureRoute = { key: 'work-index',name: 'index',params: { path: ['old-work-path'],view: 'mine',search: 'Ada' } };
  const anchor: FixtureRoute = { key: 'area-index',name: 'index',params: { path: ['assessments','manage'],date: '2026-10-29' } };
  const detail: FixtureRoute = { key: 'manage',name: '[...path]',params: { path: ['assessments','manage'] } };
  const work = navigator('work-stack','stack',[source]), areas = navigator('areas-stack','stack',[anchor,detail]);
  const state = freeze(navigator('tabs','tab',[{ key: 'work-tab',name: 'work',state: work },{ key: 'areas-tab',name: 'areas',state: areas }],1,[{ type: 'route',key: 'work-tab' },{ type: 'route',key: 'areas-tab' }]));
  const projected = projectCampusOriginReturn(state,{ scopeKey: liveScope,originKey: source.key,destinationKey: detail.key },liveScope)!;
  assert.ok(projected); assert.equal(focusedCampusRoute(projected)?.key,source.key);
  assert.deepEqual(findRoute(projected,source.key)?.params,{ view: 'mine',search: 'Ada' });
  assert.deepEqual(findRoute(projected,anchor.key)?.params,{ date: '2026-10-29' });
  assert.deepEqual(source.params,{ path: ['old-work-path'],view: 'mine',search: 'Ada' });
  assert.deepEqual(anchor.params,{ path: ['assessments','manage'],date: '2026-10-29' });
});

test('active Areas reselect mints one clean base entry and retains all other tab instances and chronology', () => {
  const fixture = retainedFixture({ preload: true });
  const request = { root: '/areas', focusedKey: fixture.destination.key, scopeKey: liveScope };
  const plan = projectCampusTabReset(fixture.state, request, liveScope);
  assert.ok(plan);
  const base = focusedCampusRoute(plan.state)!;
  assert.equal(base.name, 'index');
  assert.equal(base.params, undefined); assert.equal(base.path, undefined);
  assert.equal(campusHrefForRoute(plan.state, base.key), '/areas');
  assert.notEqual(base.key, fixture.areas.routes[0]!.key);
  assert.equal(findState(plan.state, fixture.areas.key)?.routeKeySeq, fixture.areas.routeKeySeq! + 1);
  assert.equal(findState(plan.state, fixture.areas.key)?.routes.length, 1);
  assert.equal(findState(plan.state, fixture.work.key), fixture.work);
  assert.equal(findState(plan.state, fixture.today.key), fixture.today);
  assert.equal(findState(plan.state, fixture.more.key), fixture.more);
  assert.equal(findState(plan.state, 'navigator:0')?.history, findState(fixture.state, 'navigator:0')?.history);
  assert.deepEqual(new Set(plan.removedKeys), new Set(fixture.areas.routes.map(route => route.key)));
  assert.equal(fixture.areas.routes.length, 3, 'the immutable source still contains its preload and detail');
});

test('base-page reselect resets base filters/scroll identity and removes stale deep-link anchor segments', () => {
  const base = { key: 'areas-old', name: 'index', params: { path: ['assessments','manage'], search: 'Ada', page: '3' }, path: '/areas?search=Ada&page=3' };
  const stack = navigator('areas-stack', 'stack', [base]);
  const state = freeze(navigator('tabs', 'tab', [{ key: 'areas-tab', name: 'areas', state: stack }]));
  const plan = projectCampusTabReset(state, { root: '/areas', focusedKey: base.key, scopeKey: liveScope }, liveScope);
  assert.ok(plan); assert.equal(campusHrefForRoute(plan.state, focusedCampusRoute(plan.state)!.key), '/areas');
  assert.notEqual(focusedCampusRoute(plan.state)?.key, base.key);
  assert.deepEqual(focusedCampusRoute(plan.state)?.params, undefined);
});

test('tab reset rejects stale scope/focus, a different tab, incomplete state, and an undeclared base', () => {
  const fixture = retainedFixture();
  const request = { root: '/areas', focusedKey: fixture.destination.key, scopeKey: liveScope };
  assert.equal(projectCampusTabReset(fixture.state, request, simulationScope), null);
  assert.equal(projectCampusTabReset(fixture.state, { ...request, focusedKey: fixture.source.key }, liveScope), null);
  assert.equal(projectCampusTabReset(fixture.state, { ...request, root: '/work' }, liveScope), null);
  assert.equal(projectCampusTabReset(fixture.state, { ...request, root: '/areas/assessments' }, liveScope), null);
  assert.equal(projectCampusTabReset({ ...fixture.state, stale: true }, request, liveScope), null);
  const noIndex = navigator('only-detail', 'stack', [fixture.destination]);
  const state = navigator('tabs', 'tab', [{ key: 'area-tab', name: 'areas', state: noIndex }]);
  assert.equal(projectCampusTabReset(state, request, liveScope), null);
});

test('cold detail with declared index can reset through the actual SDK without a pre-existing anchor', () => {
  const detail = { key: 'cold-detail', name: '[...path]', params: { path: ['assessments','manage'] } };
  const child = { ...navigator('areas-stack', 'stack', [detail]), routeNames: ['index','[...path]'] };
  const state = navigator('root', 'stack', [{ key: 'campus', name: '(campus)', state: navigator('tabs', 'tab', [{ key: 'area-tab', name: 'areas', state: child }]) }]);
  const plan = projectCampusTabReset(state, { root: '/areas', focusedKey: detail.key, scopeKey: liveScope }, liveScope);
  assert.ok(plan);
  const router = BaseRouter({}); type RouterState = Parameters<typeof router.getStateForAction>[0];
  const result = router.getStateForAction(state as RouterState, { type: 'RESET', payload: plan.state as RouterState }, { routeNames: [...state.routeNames!], routeGetIdList: {} });
  assert.ok(result && typeof result === 'object' && 'state' in result);
  assert.deepEqual(result.state, plan.state, 'root reset preserves the child key already minted by the SDK');
  assert.equal(getStackBrowserHistoryAction(state as RouterState, plan.state as RouterState, { type: 'RESET', payload: plan.state }), undefined, 'the root RESET refreshes the current browser slot; it adds no root visit above the detail');
});

test('tab reset aggregates retained underlying editors only in the exact removed scope', () => {
  const guards = [
    { key: 'retained-editor', scope: liveScope, dirty: true },
    { key: 'current-detail', scope: liveScope, blocked: true },
    { key: 'other-tab', scope: liveScope, dirty: true, blocked: true },
    { key: 'retained-editor', scope: simulationScope, blocked: true },
  ];
  assert.deepEqual(campusRemovedGuards(guards, [], liveScope), { blocked: false, dirty: [] }, 'switching tabs never claims retained drafts are removed');
  assert.deepEqual(campusRemovedGuards(guards, ['retained-editor'], liveScope), { blocked: false, dirty: [guards[0]] });
  assert.deepEqual(campusRemovedGuards(guards, ['retained-editor','current-detail'], liveScope), { blocked: true, dirty: [guards[0]] });
});
