import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceManifest, WorkspaceMoreItem } from '../../packages/contracts/src/workspace';
import { resolveMoreToolItem } from '../src/lib/more-tool-access';
const child = { key: 'institution', label: 'Campus setup', href: '/more/setup/institution' };
const launcher = { key: 'setup', label: 'Campus setup', href: '/more/setup' };
const manifest = (setup: WorkspaceMoreItem[], items = [launcher]) => ({ more: { groups: [{ key: 'setup', label: 'Campus setup', items }], setup, other: [] } }) as unknown as WorkspaceManifest;
test('setup children resolve only from the exact current setup contribution without changing menu contents', () => {
  const source = manifest([child]), before = JSON.stringify(source);
  assert.equal(resolveMoreToolItem(source, 'institution'), child);
  assert.equal(resolveMoreToolItem(source, 'organization'), null);
  assert.equal(JSON.stringify(source), before);
  assert.equal(source.more.groups![0]!.items.length, 1);
});
test('modern empty/revoked launchers and missing, conflicting or outside setup children deny access', () => {
  for (const source of [manifest([child], []), manifest([child], [{ ...launcher, href: '/more/setup/another' }]),
    manifest([child], [launcher, launcher]), manifest([]), manifest([child, { ...child, href: '/more/setup/other' }]),
    manifest([{ ...child, href: '/more/policies' }]), manifest([{ ...child, href: 'https://outside.example/setup' }]),
    { more: { groups: [], setup: [child] } } as unknown as WorkspaceManifest]) assert.equal(resolveMoreToolItem(source, 'institution'), null);
});
test('ordinary canonical groups take precedence and pre-grouped manifests retain explicit legacy tools', () => {
  const item = { key: 'policies', label: 'Policy', href: '/more/policies' }, source = manifest([child], [item]);
  assert.equal(resolveMoreToolItem(source, 'policies'), item);
  assert.equal(resolveMoreToolItem(source, 'institution'), null);
  const legacy = { more: { setup: [child], other: [item] } } as unknown as WorkspaceManifest;
  assert.equal(resolveMoreToolItem(legacy, 'institution'), child); assert.equal(resolveMoreToolItem(legacy, 'policies'), item);
});
