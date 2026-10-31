import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import type { RouteNode } from 'expo-router/build/Route';
import { getStateFromPath } from 'expo-router/build/fork/getStateFromPath';
import { getPathFromState } from 'expo-router/build/fork/getPathFromState';
import { BaseRouter } from 'expo-router/build/react-navigation/routers/BaseRouter';
import { StackRouter, getStackBrowserHistoryAction } from 'expo-router/build/react-navigation/routers/StackRouter';
import { TabRouter } from 'expo-router/build/react-navigation/routers/TabRouter';
import {
  campusHrefForRoute,
  campusWorkspaceTabState,
  focusedCampusRoute,
  isFocusedCampusAncestor,
  projectCampusTabReset,
  type CampusNavigationState,
} from '../src/lib/back-policy';

const require = createRequire(import.meta.url);
const constantsPath = require.resolve('expo-constants');
const previousConstantsModule = require.cache[constantsPath];
// The actual SDK seeder imports an unrelated platform colour hook. Supply only
// its app configuration while loading it; the URL parser, seeder and reducers
// below are the installed SDK implementations, not navigation test doubles.
let createSeededRootState: typeof import('expo-router/build/global-state/createSeededNavigationState').createSeededRootState;
try {
  require.cache[constantsPath] = {
    id: constantsPath, filename: constantsPath, loaded: true,
    exports: { __esModule: true, default: { expoConfig: { extra: { router: { adaptiveColors: false, sitemap: false, notFound: false } } } } },
  } as NodeJS.Module;
  ({ createSeededRootState } = require('expo-router/build/global-state/createSeededNavigationState'));
} finally {
  if (previousConstantsModule) require.cache[constantsPath] = previousConstantsModule;
  else delete require.cache[constantsPath];
}

const scope = 'actor:campus:live';
const tabNames = ['today', 'work', 'areas', 'more'];
const coldHref = '/areas/insights/results?scope=assigned&period=90&class=class-a&compare=class';
const tabRouter = TabRouter({ backBehavior: 'fullHistory' });
const stackRouter = StackRouter({});
type TabState = Parameters<typeof tabRouter.getStateForDeclaredRoutes>[0];
type StackState = Parameters<typeof stackRouter.getStateForDeclaredRoutes>[0];
type ParsedState = NonNullable<ReturnType<typeof getStateFromPath>>;

function routeNode(route: string, children: RouteNode[] = [], anchor?: string): RouteNode {
  return {
    type: children.length ? 'layout' : 'route', route, contextKey: route + (children.length ? '/_layout.tsx' : '.tsx'), children,
    dynamic: route === '[...path]' ? [{ name: 'path', deep: true }] : null,
    loadRoute: () => anchor ? { unstable_settings: { anchor } } : {},
  };
}
const rootNode = routeNode('', [routeNode('(campus)', tabNames.map(name => routeNode(name,
  name === 'today' ? [routeNode('index')] : [routeNode('index'), routeNode('[...path]')], 'index')))]);
const tabScreens = Object.fromEntries(tabNames.map(name => [name, {
  path: name, initialRouteName: 'index', screens: name === 'today' ? { index: '' } : { index: '', '[...path]': '*path' },
}]));
const linking = { screens: { __root: { path: '', screens: { '(campus)': { path: '', screens: tabScreens } } } } };

function parsed(href: string): ParsedState {
  const result = getStateFromPath(href, linking);
  assert.ok(result, 'the actual SDK parser must recognize the campus URL');
  return result;
}
function parsedTabs(state: ParsedState) {
  return state.routes[0]!.state!.routes[0]!.state!;
}
function fixture(retained = false) {
  let target = parsed(coldHref);
  const targetTabs = parsedTabs(target);
  if (retained) {
    const work = parsedTabs(parsed('/work/tasks?item=task-7&search=Ada&page=3&expanded=due&expanded=assigned')).routes[0]!;
    const more = parsedTabs(parsed('/more/account?view=preferences&search=profile')).routes[0]!;
    // Seed a restored tree with distinct real SDK-minted route keys, rather
    // than copying keys from separately seeded navigators into this one.
    const routes = [work, more, ...targetTabs.routes];
    const rootRoute = target.routes[0]!, appState = rootRoute.state!, campusRoute = appState.routes[0]!;
    target = { ...target, routes: [{ ...rootRoute, state: { ...appState, routes: [{ ...campusRoute, state: { ...targetTabs, routes, index: routes.length - 1 } }] } }] };
  }
  const state = createSeededRootState(target, rootNode) as CampusNavigationState;
  let tabs: CampusNavigationState | undefined = state;
  while (tabs && !tabNames.every(name => tabs!.routeNames?.includes(name))) tabs = tabs.routes[tabs.index]?.state;
  assert.ok(tabs);
  const area = tabs.routes[tabs.index]!.state;
  assert.ok(area);
  const focused = focusedCampusRoute(state);
  assert.ok(focused);
  return { state, tabs, area, focused };
}
function replaceState(state: CampusNavigationState, key: string, replacement: CampusNavigationState): CampusNavigationState {
  if (state.key === key) return replacement;
  const routes = state.routes.map(route => {
    const child = route.state && replaceState(route.state, key, replacement);
    return child && child !== route.state ? { ...route, state: child } : route;
  });
  return routes.some((route, index) => route !== state.routes[index]) ? { ...state, routes } : state;
}
function assertCompleteSeed(state: CampusNavigationState, keys = new Set<string>()) {
  assert.equal(state.stale, false);
  assert.equal(typeof state.key, 'string'); assert.ok(!keys.has(state.key)); keys.add(state.key);
  assert.ok(Number.isSafeInteger(state.routeKeySeq)); assert.ok(state.routeKeySeq! >= 0);
  assert.ok(state.routeNames); assert.ok(Number.isSafeInteger(state.index));
  assert.ok(state.routes.length ? state.index >= 0 && state.index < state.routes.length : state.index === -1);
  for (const route of state.routes) {
    assert.ok(!keys.has(route.key)); keys.add(route.key); assert.ok(state.routeNames.includes(route.name));
    if (route.state) assertCompleteSeed(route.state, keys);
  }
}
function reset(state: CampusNavigationState, focusedKey = focusedCampusRoute(state)!.key, requestScope = scope) {
  return projectCampusTabReset(state, { root: '/areas', focusedKey, scopeKey: requestScope }, scope);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

test('the actual cold SDK URL seed is complete yet has no stamped tab or stack type', () => {
  const { state, tabs, area, focused } = fixture();
  assertCompleteSeed(state);
  assert.equal(tabs.type, undefined); assert.equal(area.type, undefined);
  assert.equal(campusHrefForRoute(state, focused.key), coldHref);
  assert.equal(tabRouter.getStateForDeclaredRoutes(tabs as TabState, tabNames).type, undefined);
  assert.equal(stackRouter.getStateForDeclaredRoutes(area as StackState, ['index', '[...path]']).type, undefined);
  assert.equal(isFocusedCampusAncestor(state, state.routes[0]!.state!.routes[0]!.key), true);
  assert.equal(campusWorkspaceTabState(state), tabs);
  const plan = reset(state);
  assert.ok(plan);
  assert.equal(campusHrefForRoute(plan.state, focusedCampusRoute(plan.state)!.key), '/areas');
});

test('cold active-tab reset uses the actual SDK root RESET without adding a browser history visit', () => {
  const { state, area, focused } = fixture();
  freeze(state);
  const plan = reset(state);
  assert.ok(plan);
  const base = focusedCampusRoute(plan.state)!;
  assert.notEqual(base.key, focused.key); assert.notEqual(base.key, area.routes[0]!.key);
  assert.equal(base.name, 'index'); assert.equal(base.params, undefined); assert.equal(base.path, undefined);
  assert.equal(new URL(getPathFromState(plan.state as StackState, linking), 'https://campus.invalid').pathname, '/areas');
  const router = BaseRouter({});
  type RouterState = Parameters<typeof router.getStateForAction>[0];
  const action = { type: 'RESET' as const, payload: plan.state as RouterState };
  const result = router.getStateForAction(state as RouterState, action, { routeNames: [...state.routeNames!], routeGetIdList: {} });
  assert.ok(result && typeof result === 'object' && 'state' in result);
  assert.deepEqual(result.state, plan.state, 'the root accepts the already SDK-minted base route key');
  assert.equal(getStackBrowserHistoryAction(state as StackState, plan.state as StackState, action), undefined);
  const stackResult = stackRouter.getStateForAction(state as StackState, action, { routeNames: [...state.routeNames!], routeGetIdList: {} });
  assert.ok(stackResult && typeof stackResult === 'object' && 'state' in stackResult);
  assert.equal(stackResult.browserHistory, undefined, 'a root RESET refreshes its current browser slot');
  assert.equal(campusHrefForRoute(stackResult.state as CampusNavigationState, base.key), '/areas');
});

test('an SDK action can stamp the tab while its cold child stack remains untyped', () => {
  const { state, tabs, area } = fixture();
  const result = tabRouter.getStateForAction(tabs as TabState, { type: 'JUMP_TO', payload: { name: 'areas' } }, { routeNames: [...tabs.routeNames!], routeGetIdList: {} });
  assert.ok(result && typeof result === 'object' && 'state' in result);
  assert.equal(result.state.type, 'tab'); assert.equal(area.type, undefined);
  const warmed = replaceState(state, tabs.key, result.state as CampusNavigationState);
  assert.equal(campusWorkspaceTabState(warmed), result.state);
  const plan = reset(warmed);
  assert.ok(plan);
  assert.equal(campusHrefForRoute(plan.state, focusedCampusRoute(plan.state)!.key), '/areas');
});

test('reset of an SDK-seeded restored tree retains other exact entries, query state and chronology', () => {
  const { state, tabs, area } = fixture(true);
  const renderedTabs = tabRouter.getStateForDeclaredRoutes(tabs as TabState, tabNames) as CampusNavigationState;
  const restored = replaceState(state, tabs.key, renderedTabs);
  const before = structuredClone(restored);
  freeze(restored);
  const work = renderedTabs.routes.find(route => route.name === 'work')!, more = renderedTabs.routes.find(route => route.name === 'more')!;
  const workLeaf = focusedCampusRoute(work.state)!, moreLeaf = focusedCampusRoute(more.state)!;
  const plan = reset(restored);
  assert.ok(plan);
  const nextTabs = campusWorkspaceTabState(plan.state)!;
  assert.equal(nextTabs.routes.find(route => route.name === 'work'), work);
  assert.equal(nextTabs.routes.find(route => route.name === 'more'), more);
  assert.equal(nextTabs.history, renderedTabs.history);
  assert.equal(focusedCampusRoute(work.state), workLeaf); assert.equal(focusedCampusRoute(more.state), moreLeaf);
  assert.equal(campusHrefForRoute(plan.state, workLeaf.key), '/work/tasks?item=task-7&search=Ada&page=3&expanded=due&expanded=assigned');
  assert.equal(campusHrefForRoute(plan.state, moreLeaf.key), '/more/account?view=preferences&search=profile');
  assert.deepEqual(new Set(plan.removedKeys), new Set(area.routes.map(route => route.key)));
  assert.ok(!plan.removedKeys.includes(workLeaf.key)); assert.ok(!plan.removedKeys.includes(moreLeaf.key));
  assert.deepEqual(restored, before);
});

test('cold workspace discovery refuses explicit foreign types and ambiguous untyped declarations', () => {
  const { state, tabs, area } = fixture();
  assert.equal(campusWorkspaceTabState(undefined), undefined);
  for (const type of ['stack', 'drawer']) {
    const changed = replaceState(state, tabs.key, { ...tabs, type });
    assert.equal(campusWorkspaceTabState(changed), undefined, type);
    assert.equal(reset(changed), null, type);
  }
  for (const routeNames of [['areas'], ['today', 'work', 'areas'], ['today', 'work', 'more']]) {
    const changed = replaceState(state, tabs.key, { ...tabs, routeNames });
    assert.equal(campusWorkspaceTabState(changed), undefined, routeNames.join(','));
    assert.equal(reset(changed), null);
  }
  const wrongChild = replaceState(state, area.key, { ...area, type: 'tab' });
  assert.equal(reset(wrongChild), null, 'an explicitly different child navigator is never treated as the domain stack');
});

test('a typed retained workspace with a single materialized tab remains supported', () => {
  const { state, tabs, area } = fixture();
  const typed = replaceState(state, tabs.key, { ...tabs, type: 'tab', routeNames: ['areas'], routes: [{ ...tabs.routes[0]!, state: { ...area, type: 'stack' } }], index: 0 });
  assert.equal(campusWorkspaceTabState(typed)?.type, 'tab');
  assert.ok(reset(typed));
});

test('cold reset still refuses incomplete state, changed scope or focus and an undeclared base', () => {
  const { state, tabs, area, focused } = fixture();
  for (const changed of [
    { ...state, stale: true }, { ...state, routeKeySeq: undefined }, { ...state, routeNames: undefined },
    replaceState(state, area.key, { ...area, stale: true }),
    replaceState(state, area.key, { ...area, routeNames: ['[...path]'], routes: [area.routes[area.index]!], index: 0 }),
  ]) assert.equal(reset(changed), null);
  assert.equal(reset(state, focused.key, 'actor:another-campus:live'), null);
  assert.equal(reset(state, focused.key, 'actor:campus:simulation:another-run'), null);
  assert.equal(reset(state, area.routes[0]!.key), null);
  assert.equal(projectCampusTabReset(state, { root: '/more', focusedKey: focused.key, scopeKey: scope }, scope), null);
  const outside = replaceState(state, tabs.key, { ...tabs, routes: [{ ...tabs.routes[0]!, name: 'outside' }], index: 0 });
  assert.equal(campusWorkspaceTabState(outside), undefined);
  assert.equal(reset(outside), null);
});
