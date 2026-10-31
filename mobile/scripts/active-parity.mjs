import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const registrations = {
  app: 'frontend/src/App.tsx',
  more: 'frontend/src/features/more/MoreWorkspaceRoutes.tsx',
  setup: 'frontend/src/features/setup/SetupWorkspaceRoutes.tsx',
};
const parse = (file, text) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function unwrap(node) { while (node && (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression; return node; }
function walk(node, visit) { visit(node); ts.forEachChild(node, child => walk(child, visit)); }
function routeOwner(node, source) {
  const wrappers = new Set(['Route', 'WorkspaceOnly', 'WorkspaceSurfaceOnly', 'AuthenticatedOnly', 'PublicOnly', 'CompanyOnly']);
  const owners = [];
  walk(node, child => { if (ts.isJsxSelfClosingElement(child) || ts.isJsxOpeningElement(child)) { const name = child.tagName.getText(source); if (!wrappers.has(name)) owners.push(name); } });
  return owners.at(-1) ?? null;
}
function enclosingMap(node) {
  for (let current = node.parent; current; current = current.parent) if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression) && current.expression.name.text === 'map') return current;
  return null;
}
function canonicalDefinitions(file, text, name) {
  const source = parse(file, text), definitions = [];
  walk(source, node => {
    if (!ts.isVariableDeclaration(node) || node.name.getText(source) !== name) return;
    const array = unwrap(node.initializer);
    if (!array || !ts.isArrayLiteralExpression(array)) throw new Error(`${name} must remain an inspectable canonical route array.`);
    for (const element of array.elements) {
      if (!ts.isObjectLiteralExpression(element) || element.properties.some(property => !ts.isPropertyAssignment(property))) throw new Error(`${name} has a dynamic route definition requiring review.`);
      const properties = new Map(element.properties.filter(ts.isPropertyAssignment).map(property => [property.name.getText(source), property.initializer]));
      const path = properties.get('path'), component = properties.get('Component');
      if (!path || !ts.isStringLiteral(path) || !component || !ts.isIdentifier(component)) throw new Error(`${name} has an unreviewed dynamic path/component.`);
      definitions.push({ path: path.text, component: component.text, registration: file });
    }
  });
  if (!definitions.length) throw new Error(`No definitions found for ${name}.`);
  return definitions;
}

/** Discovers mounted canonical flows, never all TSX files or persona redirects. */
export function discoverActiveRoutes(sources) {
  const source = parse(registrations.app, sources.app), routes = [], excluded = [], mountedArrays = new Set();
  walk(source, node => {
    if (!(ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) || node.tagName.getText(source) !== 'Route') return;
    const pathAttribute = node.attributes.properties.find(property => ts.isJsxAttribute(property) && property.name.getText(source) === 'path');
    if (!pathAttribute || !ts.isJsxAttribute(pathAttribute)) return;
    const component = routeOwner(node, source), initializer = pathAttribute.initializer;
    if (['RoleLanding', 'Navigate', 'LegacyRouteRedirect', 'LegacyInsightsRedirect'].includes(component)) {
      excluded.push({ path: initializer && ts.isStringLiteral(initializer) ? initializer.text : 'redirect-only mapped aliases', component }); return;
    }
    if (initializer && ts.isStringLiteral(initializer)) { routes.push({ path: initializer.text, component, registration: registrations.app }); return; }
    if (!initializer || !ts.isJsxExpression(initializer) || !initializer.expression) throw new Error('A mounted Route has no inspectable path.');
    const expression = initializer.expression, map = enclosingMap(node), mapSource = map && unwrap(map.expression.expression);
    if (ts.isIdentifier(expression) && expression.text === 'path' && mapSource && ts.isIdentifier(mapSource) && ['canonicalMoreRouteDefinitions', 'canonicalSetupRouteDefinitions'].includes(mapSource.text)) { mountedArrays.add(mapSource.text); return; }
    if (ts.isTemplateExpression(expression) && expression.head.text === '/areas/insights/' && expression.templateSpans.length === 1 && expression.templateSpans[0].expression.getText(source) === 'topic' && mapSource && ts.isArrayLiteralExpression(mapSource)) {
      for (const topic of mapSource.elements) {
        if (!ts.isStringLiteral(topic)) throw new Error('An Insights topic is dynamic; review its owning route.');
        routes.push({ path: `/areas/insights/${topic.text}`, component, registration: registrations.app });
      }
      return;
    }
    throw new Error(`Unreviewed mounted dynamic route: ${initializer.getText(source)}`);
  });
  for (const [key, name] of [['more', 'canonicalMoreRouteDefinitions'], ['setup', 'canonicalSetupRouteDefinitions']]) if (mountedArrays.has(name)) routes.push(...canonicalDefinitions(registrations[key], sources[key], name));
  const paths = new Set();
  for (const route of routes) { if (!route.component || paths.has(route.path)) throw new Error(`Duplicate or unowned canonical route: ${route.path}`); paths.add(route.path); }
  return { routes: routes.sort((a, b) => a.path.localeCompare(b.path)), excluded };
}

export const sourceHash = text => createHash('sha256').update(text).digest('hex');
/** Track current local runtime/style dependencies without counting files as flows. */
export function discoverOwnedSources(roots, readSource) {
  const pending = [...roots], found = new Set();
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css', '.json'];
  while (pending.length) {
    const file = pending.pop(); if (found.has(file)) continue;
    const text = readSource(file); if (text === null) throw new Error(`Missing reviewed owner ${file}`);
    found.add(file); if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const source = parse(file, text), imports = [];
    walk(source, node => {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
    });
    for (const specifier of imports) {
      if (!specifier.startsWith('.')) continue;
      const base = posix.normalize(posix.join(posix.dirname(file), specifier));
      if (!/^(frontend\/src\/|mobile\/src\/|mobile\/modules\/|packages\/contracts\/src\/)/.test(base)) continue;
      const candidates = extensions.some(extension => base.endsWith(extension)) ? [base] : [...extensions.map(extension => base + extension), ...['.web', '.native', '.ios', '.android'].flatMap(platform => ['.ts', '.tsx'].map(extension => base + platform + extension)), ...['.ts', '.tsx', '.js'].map(extension => `${base}/index${extension}`)];
      for (const candidate of candidates) if (readSource(candidate) !== null) pending.push(candidate);
    }
  }
  return [...found].sort();
}
export function compareInventory(discovered, inventory, readSource) {
  const errors = [], expected = new Map(discovered.routes.map(route => [route.path, route])), recorded = new Map();
  const groups = new Map(inventory.groups.map(group => [group.id, group]));
  if (inventory.schemaVersion !== 1 || groups.size !== inventory.groups.length) errors.push('Invalid schema or duplicate capability group.');
  if (discovered.reviewedPaths) {
    for (const file of discovered.reviewedPaths) if (!inventory.reviewedSources[file]) errors.push(`New runtime/style dependency needs review: ${file}`);
    for (const file of Object.keys(inventory.reviewedSources)) if (!discovered.reviewedPaths.includes(file)) errors.push(`Review source is no longer reachable from active owners: ${file}`);
  }
  for (const route of inventory.routes) {
    if (recorded.has(route.path)) errors.push(`Duplicate inventory route ${route.path}`); recorded.set(route.path, route);
    const current = expected.get(route.path);
    if (!current) errors.push(`Inventory includes an unmounted/redirect-only route ${route.path}`);
    else if (current.component !== route.component || current.registration !== route.registration) errors.push(`Route owner changed: ${route.path}`);
    if (!groups.has(route.group)) errors.push(`Route has no reviewed capability group: ${route.path}`);
  }
  for (const path of expected.keys()) if (!recorded.has(path)) errors.push(`New active route needs review: ${path}`);
  const statuses = new Set(['unported', 'partial', 'implemented-unverified', 'verified']);
  const complete = group => group.status === 'verified' && group.capabilities.every(capability => capability.status === 'verified') && group.gaps.length === 0 && ['web', 'ios', 'android', 'simulation', 'recovery', 'visual'].every(platform => group.acceptance?.[platform]?.length);
  for (const group of inventory.groups) {
    if (!statuses.has(group.status) || !group.capabilities?.length || !group.sources?.length || !group.gaps?.length && group.status !== 'verified') errors.push(`Incomplete capability review: ${group.id}`);
    if (!inventory.routes.some(route => route.group === group.id)) errors.push(`Capability group has no active route: ${group.id}`);
    for (const capability of group.capabilities ?? []) if (!capability.id || !capability.description || !statuses.has(capability.status) || !capability.source || !group.sources.includes(capability.source)) errors.push(`Incomplete or unowned capability entry in ${group.id}`);
    for (const file of group.sources ?? []) if (!inventory.reviewedSources[file]) errors.push(`Missing reviewed source fingerprint: ${file}`);
    if (group.status === 'verified' && !complete(group)) errors.push(`A route/component mapping cannot verify ${group.id}; close recorded gaps and supply exact all-platform evidence.`);
    if (group.status === 'verified') for (const references of Object.values(group.acceptance ?? {})) for (const reference of references) if (typeof reference !== 'string' || !reference.startsWith('artifacts/') || readSource(reference.split('#')[0]) === null) errors.push(`Missing inspectable acceptance receipt for ${group.id}: ${reference}`);
  }
  for (const [file, fingerprint] of Object.entries(inventory.reviewedSources)) {
    const source = readSource(file);
    if (source === null) errors.push(`Reviewed owner source is missing: ${file}`);
    else if (sourceHash(source) !== fingerprint) errors.push(`Owner changed; review routes, modes, gaps and evidence: ${file}`);
  }
  const blockers = inventory.groups.filter(group => !complete(group)).map(group => ({ id: group.id, status: group.status, paths: inventory.routes.filter(route => route.group === group.id).map(route => route.path), gaps: group.gaps, incompleteCapabilities: group.capabilities.filter(capability => capability.status !== 'verified').map(capability => capability.id) }));
  return { errors, blockers, retirementReady: errors.length === 0 && blockers.length === 0 };
}

function main() {
  const read = file => {
    if (typeof file !== 'string' || file.startsWith('/') || file.includes('\\') || file.split('/').some(part => part === '..' || part === '.')) throw new Error('Inventory sources must stay inside the active project.');
    const target = resolve(projectRoot, file); return existsSync(target) ? readFileSync(target, 'utf8') : null;
  };
  const discovered = discoverActiveRoutes(Object.fromEntries(Object.entries(registrations).map(([key, file]) => [key, read(file)])));
  if (process.argv.includes('--discover')) { process.stdout.write(`${JSON.stringify(discovered, null, 2)}\n`); return; }
  const inventory = JSON.parse(read('mobile/parity/active-web.json'));
  const nativeRoutes = [];
  function appFiles(folder) { for (const entry of readdirSync(resolve(projectRoot, folder), { withFileTypes: true })) { const file = `${folder}/${entry.name}`; if (entry.isDirectory()) appFiles(file); else if (/\.[jt]sx?$/.test(file)) nativeRoutes.push(file); } }
  appFiles('mobile/app');
  discovered.reviewedPaths = discoverOwnedSources([...inventory.reviewRoots, ...nativeRoutes], read);
  if (process.argv.includes('--review-hashes')) { process.stdout.write(`${JSON.stringify(Object.fromEntries(discovered.reviewedPaths.map(file => [file, sourceHash(read(file))])), null, 2)}\n`); return; }
  const result = compareInventory(discovered, inventory, read);
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify({ activeRoutes: discovered.routes.length, capabilityGroups: inventory.groups.length, ...result }, null, 2)}\n`);
  else {
    for (const error of result.errors) process.stderr.write(`DRIFT: ${error}\n`);
    process.stdout.write(`${result.errors.length ? 'Inventory drift detected' : 'Active-route inventory is in sync'}: ${discovered.routes.length} active paths, ${inventory.groups.length} capability groups.\n`);
    process.stdout.write(`Web retirement ${result.retirementReady ? 'READY' : 'BLOCKED'}: ${result.blockers.length} unfinished capability groups. A mapped component or passing drift check is not parity.\n`);
    for (const blocker of result.blockers) process.stdout.write(`- ${blocker.id} [${blocker.status}]: ${blocker.paths.join(', ')}\n  ${blocker.gaps.join(' ')}\n`);
  }
  if (result.errors.length || process.argv.includes('--retirement') && !result.retirementReady) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
