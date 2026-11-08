import type { WorkspaceManifest, WorkspaceMoreItem } from '../../../packages/contracts/src/workspace';
import { isInternalHref } from './api-policy';

/** Resolve a current contribution, never authority inferred from a role label.
 * Grouped More contains the setup launcher; its explicit children live in the
 * same manifest's setup catalogue, which the setup overview also renders. */
export function resolveMoreToolItem(manifest: WorkspaceManifest, key: string): WorkspaceMoreItem | null {
  const groups = manifest.more.groups;
  const items = groups === undefined ? [...manifest.more.setup, ...(manifest.more.other ?? [])] : groups.flatMap(group => group.items);
  const direct = items.filter(item => item.key === key);
  if (direct.length) return direct.length === 1 ? direct[0]! : null;
  const launchers = groups?.filter(group => group.key === 'setup').flatMap(group => group.items)
    .filter(item => item.key === 'setup' && item.href === '/more/setup') ?? [];
  if (launchers.length !== 1) return null;
  const children = manifest.more.setup.filter(item => item.key === key);
  return children.length === 1 && children[0]!.href.startsWith('/more/setup/') && isInternalHref(children[0]!.href) ? children[0]! : null;
}
