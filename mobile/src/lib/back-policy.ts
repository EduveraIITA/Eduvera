import { canonicalNativeHref } from './navigation';
import { nativeInsightsBackParent } from './native-insights';
import { ASSISTANT_TAB_HREF, campusTabForName, campusTabForRoot, campusTabs, type CampusTabRoot } from './campus-tabs';
export type { CampusTabRoot } from './campus-tabs';
import { BaseRouter } from 'expo-router/build/react-navigation/routers/BaseRouter';

export interface CampusNavigationRoute { readonly key: string; readonly name: string; readonly state?: CampusNavigationState; readonly params?: object; readonly path?: string }
export interface CampusNavigationState { readonly key: string; readonly index: number; readonly type?: string; readonly stale?: boolean; readonly routeNames?: readonly string[]; readonly routeKeySeq?: number; readonly routes: readonly CampusNavigationRoute[]; readonly history?: readonly { readonly type: string; readonly key?: string }[] }
export interface CampusRouteOrigin { readonly scopeKey: string; readonly destinationKey: string; readonly originKey: string }
type Step = { state: CampusNavigationState; index: number };
function paths(state: CampusNavigationState, wanted: string, prefix: Step[] = []): Step[] | null {
  for (let index = 0; index < state.routes.length; index++) {
    const route = state.routes[index]!, next = [...prefix, { state, index }];
    if (route.key === wanted) return next;
    const child = route.state && paths(route.state, wanted, next); if (child) return child;
  }
  return null;
}
export function focusedCampusRoute(state: CampusNavigationState | undefined): CampusNavigationRoute | null {
  let current = state; const seen = new Set<string>();
  while (current) { if (seen.has(current.key)) return null; seen.add(current.key); const route = current.routes[current.index]; if (!route) return null; if (!route.state) return route; current = route.state; }
  return null;
}
/** SDK58 cold-link seeds can have complete keys/routeNames before reducers
 * stamp navigator types. Identify only the declared campus tab catalogue; do
 * not hydrate, rewrite or invent navigator state to discover that owner. */
export function campusWorkspaceTabState(state: CampusNavigationState | undefined): CampusNavigationState | undefined {
  const roots = ['today','work','areas','more'], tabNames: readonly string[] = campusTabs.map(tab => tab.name), seen = new Set<string>();
  let current = state;
  while (current && !seen.has(current.key)) {
    seen.add(current.key);
    const names = current.routeNames, selected = current.routes[current.index];
    const typed = current.type === 'tab' && names?.some(name => tabNames.includes(name));
    const seeded = current.type === undefined && roots.every(name => names?.includes(name)) && !!selected && tabNames.includes(selected.name);
    if (typed || seeded) return current;
    current = selected?.state;
  }
  return undefined;
}
export function previousCampusStackRoute(state: CampusNavigationState | undefined): CampusNavigationRoute | null {
  let current = state, previous: CampusNavigationRoute | null = null;
  while (current) { if (current.type === 'stack') { const route = current.index > 0 ? current.routes[current.index - 1] : undefined; previous = route ? route.state ? focusedCampusRoute(route.state) : route : null; } current = current.routes[current.index]?.state; }
  return previous;
}
/** Expo can copy a deep link's catch-all segments onto its generated index
 * anchor. They are not query context for an index and must not serialize there. */
function campusIndexRoute(route: CampusNavigationRoute): CampusNavigationRoute {
  if (route.name !== 'index' || !route.params || !Object.hasOwn(route.params,'path')) return route;
  const { path: _segments,...params } = route.params as Record<string,unknown>;
  return { ...route,params: Object.keys(params).length ? params : undefined };
}
function complete(state: CampusNavigationState, keys = new Set<string>()): boolean {
  if (!state.key || keys.has(state.key) || state.stale !== false || !Number.isSafeInteger(state.routeKeySeq) || state.routeKeySeq! < 0 || !state.routeNames || !Number.isSafeInteger(state.index) || (state.routes.length ? state.index < 0 || state.index >= state.routes.length : state.index !== -1)) return false;
  keys.add(state.key);
  for (const route of state.routes) { if (!route.key || keys.has(route.key) || !state.routeNames.includes(route.name)) return false; keys.add(route.key); if (route.state && !complete(route.state, keys)) return false; }
  return true;
}
/** Projects ONLY a currently focused target and an existing retained origin.
 * Full SDK58 state fields, all unrelated route keys/params and preloads survive.
 * No route, href, authority or parallel history is invented. */
export function projectCampusOriginReturn<T extends CampusNavigationState>(state: T, origin: CampusRouteOrigin, scopeKey: string): T | null {
  if (origin.scopeKey !== scopeKey || origin.destinationKey === origin.originKey || !complete(state) || focusedCampusRoute(state)?.key !== origin.destinationKey) return null;
  const from = paths(state, origin.destinationKey), to = paths(state, origin.originKey);
  if (!from || !to || to.at(-1)!.state.routes[to.at(-1)!.index]!.state) return null;
  const remove = from.at(-1)!;
  if (remove.state.type !== 'stack' || remove.index !== remove.state.index || remove.index < 1) return null;
  // A different active route above the original editor must never be discarded.
  if (to.some(step => step.state.type === 'stack' && step.index !== step.state.index && !(step.state.key === remove.state.key && step.index === remove.index - 1))) return null;
  const target = new Map(to.map(step => [step.state.key, step.index]));
  let invalid = false;
  function visit(current: CampusNavigationState): CampusNavigationState {
    let routes = current.routes.map(route => { const child = route.state && visit(route.state); return child && child !== route.state ? { ...route, state: child } : route; });
    let index = current.index, history = current.history;
    if (current.key === remove.state.key) { routes = routes.filter(route => route.key !== origin.destinationKey); index--; routes[index] = campusIndexRoute(routes[index]!); }
    const selected = target.get(current.key);
    if (selected !== undefined) {
      const desired = current.routes[selected]!.key, adjusted = routes.findIndex(route => route.key === desired);
      if (adjusted < 0) { invalid = true; return current; }
      index = adjusted; routes[index] = campusIndexRoute(routes[index]!);
      if (current.type === 'tab' && index !== current.index && history) {
        const last = history.findLastIndex(entry => entry.type === 'route' && entry.key === desired);
        // initialRoute/firstRoute tab policies may omit an actual retained
        // source. Focus its real key without retaining the target as Back.
        history = last < 0
          ? [...history.filter(entry => entry.type !== 'route' || entry.key !== current.routes[current.index]!.key), { type: 'route', key: desired }]
          : history.slice(0, last + 1);
      }
    }
    return routes.every((route, i) => route === current.routes[i]) && routes.length === current.routes.length && index === current.index && history === current.history ? current : { ...current, routes, index, ...(history ? { history } : {}) };
  }
  const next = visit(state); return invalid || focusedCampusRoute(next)?.key !== origin.originKey || paths(next, origin.destinationKey) ? null : next as T;
}
const identityByArea: Record<string, readonly string[]> = {
  attendance: ['register_id','occurrence_id','session_id','class_section_id','review_case','case_id','leave_id','request','view:apply','tab:apply','attendance_record_id','authority_change_id'],
  messages: ['conversation','conversation_id','compose','notice_id','assignment','learner','item','diary_id','diary_item','practice','group_setup','group_manage','group_add_people','report','section','edit','create'],
  people: ['person_id','group_id','student','guardian','edit','profile_view','create','import'],
  resources: ['loan_id','action','view:setup'], facilities: ['repair_id','action'],
  accommodation: ['stay_id','room_id','offer','repair_id'], dining: ['service_id','session_id','issue_id','plan_id','series_id','action'],
  assessments: ['assessment','assessment_id','publication_id','report_batch_id','create','arrangements','evidence_result'], results: ['assessment','assessment_id','publication_id','report_batch_id','create','arrangements','evidence_result'],
  reports: ['batch','scheme','create','policy','assessment_id','publication_id','report_batch_id'], care: ['case','create:concern','section'],
  fees: ['invoice','invoice_id','receipt'], responsibilities: ['request','coverage','assignment','create'],
  'in-out': ['visitor','visit','shared'], departure: ['request_id','trip_id','plan_id','swap'],
  timetable: ['period_id','occurrence_id','session_id','assignment','learner','item','diary_id','practice'],
  calendar: ['entry'], 'campus-view': ['place_id','place','edit:1','map_full:1'], assistant: ['thread'], feedback: ['campaign'],
};
function parsed(href: string) { return new URL(canonicalNativeHref(href), 'https://thatcampus.invalid'); }
function semanticKeys(url: URL): readonly string[] {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'onboarding') return ['step'];
  if (parts[0] === 'work') return ['item','request','request_id','invoice','invoice_id','visit','leave_id'];
  if (parts[0] === 'more') return parts[1] === 'virtual-campus' ? ['edit:1','map_full:1'] : parts[1] === 'simulation' ? ['run','view','step','compare'] : parts[1] === 'policies' ? ['policy'] : ['edit','create','item','policy','rule','academic_edit'];
  return identityByArea[parts[1] ?? ''] ?? ['id','item','edit','create','action'];
}
function identities(url: URL) { return semanticKeys(url).flatMap(rule => { const [key, expected] = rule.split(':'); return url.searchParams.has(key!) && (!expected || url.searchParams.get(key!) === expected) ? [[key!, url.searchParams.getAll(key!).join('\u0000')]] : []; }); }
export function sameCampusHref(a: string, b: string) { try { const normal = (href: string) => { const url = parsed(href); url.searchParams.sort(); return url.pathname.replace(/\/$/, '') + url.search + url.hash; }; return normal(a) === normal(b); } catch { return false; } }
export type CampusTransitionKind = 'none' | 'open' | 'update' | 'return';
export function campusTransitionKind(fromHref: string, toHref: string): CampusTransitionKind {
  if (sameCampusHref(fromHref, toHref)) return 'none';
  const from = parsed(fromHref), to = parsed(toHref);
  if (from.pathname !== to.pathname) return from.pathname.startsWith(to.pathname.replace(/\/$/, '') + '/') ? 'return' : 'open';
  const before = identities(from), after = identities(to);
  if (JSON.stringify(before) === JSON.stringify(after)) return 'update';
  if (before.length && after.length < before.length && after.every(([key, value]) => before.some(([oldKey, oldValue]) => oldKey === key && oldValue === value))) return 'return';
  return 'open';
}
/** Cold links have an explicit owning destination; origin history always wins. */
export function campusBackFallback(href: string): { href: string; title: string } | null {
  const url = parsed(href), parts = url.pathname.split('/').filter(Boolean), root = parts[0];
  if (url.pathname === '/onboarding/start') { if (!url.searchParams.has('step')) return null; url.searchParams.delete('step'); return { href: url.pathname + url.search, title: 'Starting points' }; }
  if (root === 'company') return parts.length === 1 ? null : { href: '/company', title: 'Institutions' };
  if (!['today','work','areas','more'].includes(root ?? '')) return { href: '/today', title: 'Today' };
  const insightsParent = nativeInsightsBackParent(url.pathname + url.search);
  if (insightsParent) return insightsParent;
  const selected = identities(url);
  if (selected.length) {
    const [key] = selected.at(-1)!; url.searchParams.delete(key!);
    for (const key of [...url.searchParams.keys()]) if (key === 'attention_notification_id' || key.endsWith('_revision')) url.searchParams.delete(key);
    return { href: url.pathname + url.search, title: campusOwnerTitle(url.pathname) };
  }
  if (parts.length === 1 || url.pathname === ASSISTANT_TAB_HREF) return null;
  const pathParent = parts.length > 2 ? `/${parts.slice(0,-1).join('/')}` : `/${root}`;
  const query = new URLSearchParams();
  for (const key of ['scope','student_id','date','view','search','q','page','updates_page']) for (const value of url.searchParams.getAll(key)) query.append(key,value);
  return { href: pathParent + (query.size && parts.length > 2 ? `?${query}` : ''), title: campusOwnerTitle(pathParent) };
}

const ownerTitles: Record<string, string> = { today: 'Today', work: 'Work', areas: 'Areas', more: 'More', insights: 'Insights', attendance: 'Attendance', messages: 'Messages', updates: 'Updates', conversations: 'Messages', people: 'People', participants: 'People', resources: 'Resources', facilities: 'Repairs', accommodation: 'Accommodation', dining: 'Dining', assessments: 'Assessments', results: 'Results & progress', fees: 'Fees & receipts', responsibilities: 'Responsibilities', 'staff-leave': 'Staff leave', 'in-out': 'In & Out', departure: 'Departure', calendar: 'Calendar', timetable: 'Timetable', session: 'Teaching sessions', 'campus-view': 'Campus', assistant: 'Assistant', feedback: 'Teaching feedback', events: 'Events & activities', reports: 'Reports', progress: 'Progress reports', remarks: 'Report remarks', policies: 'Policies', simulation: 'Simulation', notifications: 'Notifications', account: 'Account', security: 'Account security' };
export function campusOwnerTitle(href: string): string {
  const parts = parsed(href).pathname.split('/').filter(Boolean);
  for (const part of parts.toReversed()) if (ownerTitles[part]) return ownerTitles[part]!;
  return 'Back';
}
export function isCampusWorkspaceRoot(href: string): boolean { const url = parsed(href); return !!campusTabForRoot(url.pathname.replace(/\/$/,'')) && identities(url).length === 0; }
export function isFocusedCampusAncestor(state: CampusNavigationState | undefined, key: string): boolean {
  let current = state; while (current) { const route = current.routes[current.index]; if (!route) return false; if (route.key === key) return true; current = route.state; } return false;
}
/** Derives a leaf's internal href from its REAL Expo route params, including cold anchors. */
export function campusHrefForRoute(state: CampusNavigationState, key: string): string | null {
  const chain = paths(state, key); if (!chain) return null;
  const routes = chain.map(step => step.state.routes[step.index]!);
  const owner = routes.map(route => campusTabForName(route.name)).find(Boolean);
  const section = owner?.name === '(assistant)' ? null : owner?.name;
  if (!owner) return null;
  const leaf = routes.at(-1)!; const params = leaf.params as Record<string, unknown> | undefined;
  if (owner.name === '(assistant)' && leaf.name !== owner.baseRouteName) return null;
  const path = params?.path; const pieces = leaf.name === 'index' || leaf.name === section ? [] : Array.isArray(path) ? path : typeof path === 'string' ? [path] : leaf.name.startsWith('[') ? null : [leaf.name];
  if (owner.name !== '(assistant)' && (!pieces || pieces.some(part => typeof part !== 'string'))) return null;
  const query = new URLSearchParams();
  for (const [name,value] of Object.entries(params ?? {})) { if (['path','screen','params','initial','state'].includes(name)) continue; for (const item of Array.isArray(value) ? value : [value]) if (typeof item === 'string') query.append(name,item); }
  const pathname = owner.name === '(assistant)' ? owner.href : `/${section}${pieces!.length ? '/' + pieces!.map(part => encodeURIComponent(part)).join('/') : ''}`;
  return pathname + (query.size ? '?' + query : '');
}
/** Only chooses a prior entry in the focused stack; never another retained editor. */
export function campusExistingBackTarget(state: CampusNavigationState | undefined, href: string): CampusNavigationRoute | null {
  if (!state) return null; let current: CampusNavigationState | undefined = state; let found: CampusNavigationRoute | null = null;
  while (current) {
    if (current.type === 'stack') for (let index = 0; index < current.index; index++) { const route = current.routes[index]!; const leaf = route.state ? focusedCampusRoute(route.state) : route; const value = leaf && campusHrefForRoute(state,leaf.key); if (value && sameCampusHref(value,href)) found = leaf; }
    current = current.routes[current.index]?.state;
  }
  return found;
}
/** A bounded semantic-parent pop, preserving preloads and all unrelated navigators. */
export function projectCampusExistingBack<T extends CampusNavigationState>(state: T, destinationKey: string, parentKey: string): T | null {
  if (!complete(state) || focusedCampusRoute(state)?.key !== destinationKey) return null;
  const from = paths(state,destinationKey)?.at(-1), to = paths(state,parentKey)?.at(-1);
  if (!from || !to || from.state.key !== to.state.key || from.state.type !== 'stack' || to.index >= from.index || from.index !== from.state.index) return null;
  function visit(current: CampusNavigationState): CampusNavigationState {
    if (current.key === from!.state.key) {
      const routes = [...current.routes.slice(0,to!.index+1),...current.routes.slice(current.index+1)];
      routes[to!.index] = campusIndexRoute(routes[to!.index]!);
      return { ...current,index: to!.index,routes };
    }
    const routes = current.routes.map(route => { const child = route.state && visit(route.state); return child && child !== route.state ? { ...route,state: child } : route; });
    return routes.some((route,index) => route !== current.routes[index]) ? { ...current,routes } : current;
  }
  return visit(state) as T;
}

/** A deliberate active-tab reselect resets only that tab. The SDK mints the
 * fresh base entry so local search/scroll/forms reset as well as the URL.
 * Other retained tabs and the real tab/browser chronology remain untouched. */
export function projectCampusTabReset<T extends CampusNavigationState>(state: T, request: { root: string; focusedKey: string; scopeKey: string }, scopeKey: string): { state: T; removedKeys: readonly string[]; root: CampusTabRoot } | null {
  const owner = campusTabForRoot(request.root);
  if (!owner || request.scopeKey !== scopeKey || !complete(state) || focusedCampusRoute(state)?.key !== request.focusedKey) return null;
  const tabs = campusWorkspaceTabState(state), tab = tabs?.routes[tabs.index], child = tab?.state;
  // Every campus tab owns its declared domain Stack. Accept its SDK cold seed,
  // while an explicitly different navigator type still fails closed.
  if (!tabs?.routeNames?.includes(owner.name) || tab?.name !== owner.name || !child
    || (child.type !== 'stack' && child.type !== undefined) || !child.routeNames?.includes(owner.baseRouteName)) return null;
  const router = BaseRouter({});
  type RouterState = Parameters<typeof router.getStateForAction>[0];
  const result = router.getStateForAction(child as RouterState, { type: 'RESET', payload: { ...child, index: 0, routes: [{ name: owner.baseRouteName }] } as unknown as RouterState }, { routeNames: [...child.routeNames], routeGetIdList: {} });
  if (!result || typeof result !== 'object' || !('state' in result)) return null;
  const replacement = result.state as CampusNavigationState, removedKeys: string[] = [];
  function collect(current: CampusNavigationState) { for (const route of current.routes) { removedKeys.push(route.key); if (route.state) collect(route.state); } }
  collect(child);
  function visit(current: CampusNavigationState): CampusNavigationState {
    if (current.key === child!.key) return replacement;
    const routes = current.routes.map(route => { const next = route.state && visit(route.state); return next && next !== route.state ? { ...route, state: next } : route; });
    return routes.some((route, index) => route !== current.routes[index]) ? { ...current, routes } : current;
  }
  const projected = visit(state) as T, leaf = focusedCampusRoute(projected);
  if (!complete(projected) || !leaf || removedKeys.includes(leaf.key) || campusHrefForRoute(projected, leaf.key) !== request.root) return null;
  return { state: projected, removedKeys, root: request.root as CampusTabRoot };
}

/** Reset confirms every mounted editor that will actually be removed, including
 * a retained editor underneath a detail. A normal tab switch removes none. */
export function campusRemovedGuards<T extends { key: string; scope: string; dirty?: boolean; blocked?: boolean }>(guards: Iterable<T>, removedKeys: readonly string[], scopeKey: string): { blocked: boolean; dirty: T[] } {
  const removed = new Set(removedKeys), selected = [...guards].filter(guard => guard.scope === scopeKey && removed.has(guard.key));
  return { blocked: selected.some(guard => guard.blocked), dirty: selected.filter(guard => guard.dirty) };
}
