import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverActiveRoutes, discoverOwnedSources, compareInventory, sourceHash } from './active-parity.mjs';

const more = 'export const canonicalMoreRouteDefinitions = [{path:"/more/account", Component:Account}] as const; const legacyMoreRedirectDefinitions=[{from:"/principal/profile",to:"/more/account"}];';
const setup = 'export const canonicalSetupRouteDefinitions = [{path:"/more/setup", Component:Setup}] as const;';
const app = `function App(){return <Routes>
  <Route path="/today" element={<AuthenticatedOnly><Today /></AuthenticatedOnly>}/>
  {canonicalMoreRouteDefinitions.map(({path,Component})=><Route path={path} element={<WorkspaceOnly><Component /></WorkspaceOnly>}/>)}
  {canonicalSetupRouteDefinitions.map(({path,Component})=><Route path={path} element={<WorkspaceOnly><Component /></WorkspaceOnly>}/>)}
  {(["attendance","review"] as const).map(topic=><Route path={\`/areas/insights/\${topic}\`} element={<WorkspaceOnly><Insights topic={topic}/></WorkspaceOnly>}/>)}
  <Route path="/areas/insights/review/:studentId" element={<Insights/>}/>
  <Route path="/parent" element={<Navigate to="/today"/>}/>
  {legacyRedirectRoutes.map(({from,to})=><Route path={from} element={<LegacyRouteRedirect to={to}/>}/>)}
  <Route path="*" element={<RoleLanding/>}/>
</Routes>}`;
const discovered = () => discoverActiveRoutes({ app, more, setup });
function inventory() {
  const routes = discovered().routes.map(route => ({ ...route, group: 'reviewed' }));
  return { schemaVersion: 1, routes, reviewedSources: { 'frontend/owner.tsx': sourceHash('current owner') }, groups: [{ id: 'reviewed', status: 'partial', sources: ['frontend/owner.tsx'], capabilities: [{ id: 'flow', description: 'Source writer and correction flow', status: 'partial', source: 'frontend/owner.tsx' }], gaps: ['Writer is incomplete'], acceptance: {} }] };
}
const read = path => path === 'frontend/owner.tsx' ? 'current owner' : null;

test('discovers only mounted literal/canonical routes and expands the mapped Insights topics', () => {
  const result = discovered();
  assert.deepEqual(result.routes.map(route => route.path), ['/areas/insights/attendance', '/areas/insights/review', '/areas/insights/review/:studentId', '/more/account', '/more/setup', '/today']);
  assert.equal(result.routes.find(route => route.path === '/more/account').component, 'Account');
  assert.ok(!result.routes.some(route => route.path.startsWith('/parent') || route.path === '*'));
});
test('unmounted canonical arrays and arbitrary abandoned source are not an active-route denominator', () => {
  const result = discoverActiveRoutes({ app: 'function App(){return <Route path="/today" element={<Today/>}/>}', more, setup });
  assert.deepEqual(result.routes.map(route => route.path), ['/today']);
});
test('new unknown dynamic routes fail closed instead of disappearing from the inventory', () => {
  assert.throws(() => discoverActiveRoutes({ app: 'function App(){return <Route path={dynamicPath} element={<NewFlow/>}/>}', more, setup }), /Unreviewed mounted dynamic route/);
});
test('a non-self-closing Route is still inventoried and spread definitions require review', () => {
  const result = discoverActiveRoutes({ app: 'function App(){return <Route path="/new" element={<Current/>}></Route>}', more, setup });
  assert.equal(result.routes[0].path, '/new');
  assert.throws(() => discoverActiveRoutes({ app, more: 'export const canonicalMoreRouteDefinitions=[{path:"/more/account",Component:Account,...unknownOverrides}];', setup }), /dynamic route definition/);
});
test('route insertion, removal and owning-component changes all require explicit review', () => {
  const base = inventory();
  const added = { routes: [...discovered().routes, { path: '/new', component: 'New', registration: 'frontend/src/App.tsx' }] };
  assert.match(compareInventory(added, base, read).errors.join(' '), /New active route/);
  const removed = { routes: discovered().routes.filter(route => route.path !== '/today') };
  assert.match(compareInventory(removed, base, read).errors.join(' '), /unmounted\/redirect-only/);
  const changed = { routes: discovered().routes.map(route => route.path === '/today' ? { ...route, component: 'Other' } : route) };
  assert.match(compareInventory(changed, base, read).errors.join(' '), /Route owner changed/);
});
test('owner edits invalidate the flow/mode review even when the pathname stays unchanged', () => {
  const result = compareInventory(discovered(), inventory(), () => 'new flow mode');
  assert.match(result.errors.join(' '), /Owner changed/);
});
test('owner fingerprints follow runtime/style dependencies and platform variants, not unused or type-only pages', () => {
  const files = new Map([
    ['mobile/src/Owner.tsx', 'import {View} from "react-native"; import {Control} from "./Control"; import type {Old} from "./Abandoned"; import "./theme.css";'],
    ['mobile/src/Control.tsx', 'export const Control=1;'], ['mobile/src/Control.web.tsx', 'export const Control=2;'],
    ['mobile/src/Abandoned.tsx', 'export type Old=string;'], ['mobile/src/Unused.tsx', 'export const Old=1;'], ['mobile/src/theme.css', 'body{}'],
  ]);
  assert.deepEqual(discoverOwnedSources(['mobile/src/Owner.tsx'], file => files.get(file) ?? null), ['mobile/src/Control.tsx', 'mobile/src/Control.web.tsx', 'mobile/src/Owner.tsx', 'mobile/src/theme.css']);
  const base = inventory(), result = compareInventory({ ...discovered(), reviewedPaths: ['frontend/owner.tsx', 'frontend/new.tsx'] }, base, read);
  assert.match(result.errors.join(' '), /New runtime\/style dependency/);
});
test('an in-sync inventory still blocks retirement for partial or unported capabilities', () => {
  const result = compareInventory(discovered(), inventory(), read);
  assert.deepEqual(result.errors, []); assert.equal(result.retirementReady, false); assert.equal(result.blockers.length, 1);
});
test('verified route labels without exact platform/Simulation/recovery/visual evidence cannot turn green', () => {
  const base = inventory(); base.groups[0].status = 'verified'; base.groups[0].capabilities[0].status = 'verified';
  const result = compareInventory(discovered(), base, read);
  assert.equal(result.retirementReady, false); assert.match(result.errors.join(' '), /all-platform evidence/);
});
test('missing evidence receipts and a partial child capability keep the retirement gate closed', () => {
  const base = inventory(); base.groups[0].status = 'verified'; base.groups[0].capabilities[0].status = 'partial';
  base.groups[0].acceptance = Object.fromEntries(['web','ios','android','simulation','recovery','visual'].map(key => [key, ['artifacts/missing.json']]));
  const result = compareInventory(discovered(), base, read);
  assert.equal(result.retirementReady, false); assert.match(result.errors.join(' '), /Missing inspectable acceptance receipt/);
  base.groups[0].capabilities[0].status = 'verified';
  const recordedGap = compareInventory(discovered(), base, path => path.startsWith('artifacts/') ? 'receipt' : read(path));
  assert.equal(recordedGap.retirementReady, false); assert.match(recordedGap.errors.join(' '), /close recorded gaps/);
});
