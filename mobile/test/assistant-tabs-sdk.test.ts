import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { getRoutes } from 'expo-router/build/getRoutesCore';
import { getReactNavigationConfig } from 'expo-router/build/getReactNavigationConfig';
import type { RequireContext } from 'expo-router/build/types';
import { createRequire } from 'node:module';
import test from 'node:test';
import type { RouteNode } from 'expo-router/build/Route';
import { getStateFromPath } from 'expo-router/build/fork/getStateFromPath';
import { getPathFromState } from 'expo-router/build/fork/getPathFromState';
import { TabRouter } from 'expo-router/build/react-navigation/routers/TabRouter';
import { ASSISTANT_TAB_HREF, campusTabs, campusTabForHref } from '../src/lib/campus-tabs';
import { campusBackFallback, campusHrefForRoute, campusRemovedGuards, campusWorkspaceTabState, focusedCampusRoute, isCampusWorkspaceRoot, projectCampusTabReset, type CampusNavigationState } from '../src/lib/back-policy';
import { assistantPresentationPermitted, assistantRetainedTabOrigin } from '../src/lib/assistant-presentation-policy';
import { assistantEntryAvailable } from '../src/lib/assistant-access';

const require = createRequire(import.meta.url), constantsPath = require.resolve('expo-constants'), previous = require.cache[constantsPath];
let seed: typeof import('expo-router/build/global-state/createSeededNavigationState').createSeededRootState;
try {
  require.cache[constantsPath] = { id: constantsPath,filename: constantsPath,loaded: true,exports: { __esModule: true,default: { expoConfig: { extra: { router: { adaptiveColors: false,sitemap: false,notFound: false } } } } } } as NodeJS.Module;
  ({ createSeededRootState: seed } = require('expo-router/build/global-state/createSeededNavigationState'));
} finally { if (previous) require.cache[constantsPath] = previous; else delete require.cache[constantsPath]; }
const names = campusTabs.map(tab => tab.name), scope = 'actor:campus:live';
function node(route: string, children: RouteNode[] = [], anchor?: string): RouteNode {
  return { type: children.length ? 'layout' : 'route',route,contextKey: route + (children.length ? '/_layout.tsx' : '.tsx'),children,dynamic: route === '[...path]' ? [{ name: 'path',deep: true }] : null,loadRoute: () => anchor ? { unstable_settings: { anchor } } : {} };
}
const rootNode = node('',[node('(campus)',campusTabs.map(tab => node(tab.name,tab.name === '(assistant)' ? [node(tab.baseRouteName)] : tab.name === 'today' ? [node('index')] : [node('index'),node('[...path]')],tab.baseRouteName)))]);
// The competing Areas catch-all remains present. The real SDK parser, rather
// than an application redirect or href-prefix switch, must select the static leaf.
const screens = Object.fromEntries(campusTabs.map(tab => [tab.name,tab.name === '(assistant)' ? { path: '',initialRouteName: tab.baseRouteName,screens: { [tab.baseRouteName]: 'areas/assistant/conversation' } } : { path: tab.name,initialRouteName: 'index',screens: tab.name === 'today' ? { index: '' } : { index: '', '[...path]': '*path' } }]));
const linking = { screens: { __root: { path: '',screens: { '(campus)': { path: '',screens } } } } };
type Parsed = NonNullable<ReturnType<typeof getStateFromPath>>;
function parsed(href: string): Parsed { const state = getStateFromPath(href,linking); assert.ok(state); return state; }
function parsedTabs(state: Parsed) { return state.routes[0]!.state!.routes[0]!.state!; }
function fixture(href = ASSISTANT_TAB_HREF + '?thread=thread-a&student=student-a') {
  let target = parsed(href); const tabs = parsedTabs(target);
  const retained = ['/work/tasks?item=task-a&search=Ada&page=3','/areas/events/manage/new?date=2026-10-29','/more/account?view=preferences'].map(path => parsedTabs(parsed(path)).routes[0]!);
  const root = target.routes[0]!, app = root.state!, campus = app.routes[0]!;
  const routes = [...retained,...tabs.routes];
  target = { ...target,routes: [{ ...root,state: { ...app,routes: [{ ...campus,state: { ...tabs,routes,index: routes.length - 1 } }] } }] };
  const state = seed(target,rootNode) as CampusNavigationState;
  const actualTabs = campusWorkspaceTabState(state); assert.ok(actualTabs);
  const focused = focusedCampusRoute(state); assert.ok(focused);
  return { state,tabs: actualTabs,focused };
}
function replace(state: CampusNavigationState, key: string, next: CampusNavigationState): CampusNavigationState {
  if (state.key === key) return next;
  const routes = state.routes.map(route => route.state ? { ...route,state: replace(route.state,key,next) } : route);
  return { ...state,routes };
}

test('the actual SDK chooses the one static Assistant owner over Areas catch-all at the canonical URL', () => {
  const value = parsedTabs(parsed(ASSISTANT_TAB_HREF + '?thread=thread-a'));
  assert.equal(value.routes[value.index ?? value.routes.length - 1]!.name,'(assistant)');
  const { state,tabs,focused } = fixture();
  assert.equal(tabs.routes[tabs.index]!.name,'(assistant)');
  assert.equal(focused.name,'areas/assistant/conversation');
  assert.equal(campusHrefForRoute(state,focused.key),ASSISTANT_TAB_HREF + '?thread=thread-a&student=student-a');
  assert.equal(getPathFromState(state as Parameters<typeof getPathFromState>[0],linking),ASSISTANT_TAB_HREF + '?thread=thread-a&student=student-a');
  assert.equal(campusTabForHref(ASSISTANT_TAB_HREF + '?thread=a')?.name,'(assistant)');
  assert.equal(campusTabForHref('/areas/events/manage')?.name,'areas');
  assert.deepEqual(names,['today','work','(assistant)','areas','more']);
});

test('actual SDK tab switch preserves Assistant thread and all unrelated keyed editors; returning does not push Areas', () => {
  const { state,tabs,focused } = fixture();
  const router = TabRouter({ backBehavior: 'fullHistory' });
  type State = Parameters<typeof router.getStateForAction>[0];
  const original = tabs.routes.find(route => route.name === '(assistant)')!;
  const otherKeys = tabs.routes.filter(route => route.name !== '(assistant)').map(route => route.key);
  const out = router.getStateForAction(tabs as State,{ type: 'JUMP_TO',payload: { name: 'more' } },{ routeNames: names,routeGetIdList: {} });
  assert.ok(out && typeof out === 'object' && 'state' in out);
  assert.equal(out.state.routes.find(route => route.name === '(assistant)'),original);
  const back = router.getStateForAction(out.state,{ type: 'JUMP_TO',payload: { name: '(assistant)' } },{ routeNames: names,routeGetIdList: {} });
  assert.ok(back && typeof back === 'object' && 'state' in back);
  assert.equal(back.state.routes[back.state.index]!.key,original.key);
  const returned = replace(state,tabs.key,back.state as CampusNavigationState);
  assert.equal(focusedCampusRoute(returned)?.key,focused.key);
  assert.equal(campusHrefForRoute(returned,focused.key),ASSISTANT_TAB_HREF + '?thread=thread-a&student=student-a');
  assert.deepEqual(back.state.routes.filter(route => route.name !== '(assistant)').map(route => route.key),otherKeys);
  assert.equal(back.state.history?.at(-1)?.key,original.key);
});

test('Assistant active-tab reset mints the static base key, clears its selectors and retains every other tab exactly', () => {
  const { state,tabs,focused } = fixture();
  const plan = projectCampusTabReset(state,{ root: ASSISTANT_TAB_HREF,focusedKey: focused.key,scopeKey: scope },scope);
  assert.ok(plan);
  const base = focusedCampusRoute(plan.state)!;
  assert.notEqual(base.key,focused.key); assert.equal(base.name,'areas/assistant/conversation');
  assert.equal(base.params,undefined);
  assert.equal(campusHrefForRoute(plan.state,base.key),ASSISTANT_TAB_HREF);
  assert.equal(getPathFromState(plan.state as Parameters<typeof getPathFromState>[0],linking),ASSISTANT_TAB_HREF);
  const nextTabs = campusWorkspaceTabState(plan.state)!;
  for (const route of tabs.routes.filter(route => route.name !== '(assistant)')) assert.equal(nextTabs.routes.find(item => item.key === route.key),route);
  assert.equal(nextTabs.history,tabs.history);
  assert.deepEqual(campusRemovedGuards([{ key: focused.key,scope,dirty: true },{ key: 'another',scope,blocked: true }],plan.removedKeys,scope),{ blocked: false,dirty: [{ key: focused.key,scope,dirty: true }] });
  assert.equal(isCampusWorkspaceRoot(ASSISTANT_TAB_HREF),true);
  assert.equal(isCampusWorkspaceRoot(ASSISTANT_TAB_HREF + '?thread=a'),false);
  assert.equal(campusBackFallback(ASSISTANT_TAB_HREF),null);
  assert.deepEqual(campusBackFallback(ASSISTANT_TAB_HREF + '?thread=a'),{ href: ASSISTANT_TAB_HREF,title: 'Assistant' });
});

test('reset refuses another actor/world/focus and a non-owning Areas fallback', () => {
  const { state,focused } = fixture();
  for (const scopeKey of ['other:campus:live','actor:campus:simulation:run-a']) assert.equal(projectCampusTabReset(state,{ root: ASSISTANT_TAB_HREF,focusedKey: focused.key,scopeKey },scope),null);
  assert.equal(projectCampusTabReset(state,{ root: ASSISTANT_TAB_HREF,focusedKey: 'departed',scopeKey: scope },scope),null);
  assert.equal(projectCampusTabReset(state,{ root: '/areas',focusedKey: focused.key,scopeKey: scope },scope),null);
});

test('Pro is conditional on confirmed Live preference and current owning perspective, never copied into selected Simulation', () => {
  for (const enabled of [false,undefined]) assert.equal(assistantEntryAvailable({ mode: 'live' },enabled,'principal'),false);
  assert.equal(assistantEntryAvailable({ mode: 'live' },true,'principal'),true);
  assert.equal(assistantEntryAvailable({ mode: 'live',unavailable: true },true,'principal'),false);
  assert.equal(assistantEntryAvailable({ mode: 'live' },true,null),false);
  assert.equal(assistantEntryAvailable({ mode: 'simulation' },true,'principal'),false);
});


test('the current on-disk route manifest has one canonical Assistant owner on iOS, Android and web', () => {
  const app = fileURLToPath(new URL('../app/',import.meta.url)), files: string[] = [];
  function walk(directory: string,prefix = './') { for (const item of readdirSync(directory,{ withFileTypes: true })) { if (item.isDirectory()) walk(directory + item.name + '/',prefix + item.name + '/'); else if (/\.[tj]sx?$/.test(item.name)) files.push(prefix + item.name); } }
  walk(app);
  // Load only static layout anchor metadata, without importing RN screen bodies.
  const context = Object.assign((path: string) => {
    const source = ts.createSourceFile(path,readFileSync(app + path.slice(2),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    let anchor: string | undefined;
    function visit(value: ts.Node) { if (ts.isVariableDeclaration(value) && value.name.getText(source) === 'unstable_settings' && value.initializer && ts.isObjectLiteralExpression(value.initializer)) for (const prop of value.initializer.properties) if (ts.isPropertyAssignment(prop) && prop.name.getText(source) === 'anchor' && ts.isStringLiteral(prop.initializer)) anchor = prop.initializer.text; ts.forEachChild(value,visit); }
    visit(source); return { default() {},...(anchor ? { unstable_settings: { anchor } } : {}) };
  },{ keys: () => files,id: 'current-campus-routes',resolve: (path: string) => path }) as RequireContext;
  for (const platform of ['ios','android','web']) {
    const actual = getRoutes(context,{ platform,platformRoutes: true,skipGenerated: true,ignoreEntryPoints: true,getSystemRoute: () => { throw new Error('No generated system route should be required'); } });
    assert.ok(actual);
    const config = { screens: { __root: { path: '',...getReactNavigationConfig(actual,true) } } };
    const parsed = getStateFromPath(ASSISTANT_TAB_HREF + '?thread=kept',config); assert.ok(parsed,platform);
    const seeded = seed(parsed,actual) as CampusNavigationState;
    const tabs = campusWorkspaceTabState(seeded); assert.ok(tabs,platform);
    assert.equal(tabs.routes[tabs.index]!.name,'(assistant)',platform);
    assert.equal(focusedCampusRoute(seeded)?.name,'areas/assistant/conversation',platform);
    assert.equal(campusHrefForRoute(seeded,focusedCampusRoute(seeded)!.key),ASSISTANT_TAB_HREF + '?thread=kept',platform);
    const campus = actual.children.find(route => route.route === '(campus)')!;
    const assistant = campus.children.find(route => route.route === '(assistant)')!;
    assert.deepEqual(assistant.children.map(route => route.route),['areas/assistant/conversation']);
    assert.equal(assistant.loadRoute().unstable_settings?.anchor,'areas/assistant/conversation');
  }
});


test('canonical Assistant chronology uses the actual SDK prior tab and retains the exact conversation entry', () => {
  const { state,tabs,focused } = fixture();
  const router = TabRouter({ backBehavior: 'fullHistory' });
  type State = Parameters<typeof router.getStateForAction>[0];
  let current = router.getStateForDeclaredRoutes(tabs as State,names);
  for (const name of ['more','(assistant)']) {
    const result = router.getStateForAction(current,{ type: 'JUMP_TO',payload: { name } },{ routeNames: names,routeGetIdList: {} });
    assert.ok(result && typeof result === 'object' && 'state' in result); current = result.state;
  }
  const mounted = replace(state,tabs.key,current as CampusNavigationState);
  const origin = assistantRetainedTabOrigin(mounted); assert.ok(origin);
  assert.equal(origin.tabKey,current.routes.find(route => route.name === 'more')!.key);
  const assistant = current.routes.find(route => route.name === '(assistant)')!;
  const action = { type: 'GO_BACK' as const,target: origin.tabsKey };
  const closed = router.getStateForAction(current,action,{ routeNames: names,routeGetIdList: {} });
  assert.ok(closed && typeof closed === 'object' && 'state' in closed);
  assert.equal(closed.state.routes[closed.state.index]!.key,origin.tabKey);
  assert.equal(closed.state.routes.find(route => route.name === '(assistant)'),assistant,'Close retains the mounted conversation route instead of deleting/recreating it');
  assert.equal(focusedCampusRoute(assistant.state as CampusNavigationState | undefined)?.key,focused.key);
  assert.ok(router.getBrowserHistoryForAction);
  assert.deepEqual(router.getBrowserHistoryForAction(current,closed.state,action),{ type: 'pop',count: 1,target: { navigatorKey: closed.state.key,routeKey: origin.tabKey } },'the SDK emits its own exact browser delta');
});

test('unknown, malformed and revoked availability cannot hide navigation; cached confirmation survives transient reads only', () => {
  for (const value of [undefined,null,{}, { enabled: 'true' },{ enabled: false }]) assert.equal(assistantPresentationPermitted(true,value),false);
  assert.equal(assistantPresentationPermitted(true,{ enabled: true,preview: true }),true);
  for (const status of [401,403,404,410]) assert.equal(assistantPresentationPermitted(true,{ enabled: true,preview: true },status),false);
  for (const status of [408,429,500,503]) assert.equal(assistantPresentationPermitted(true,{ enabled: true,preview: true },status),true);
  assert.equal(assistantPresentationPermitted(true,undefined,503),false,'a cold failure has no confirmed configuration to retain');
  assert.equal(assistantPresentationPermitted(false,{ enabled: true,preview: true }),false,'world/perspective/access changes restore navigation');
});
