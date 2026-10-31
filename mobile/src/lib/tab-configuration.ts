import type { CampusNavigationState } from './back-policy';

export interface TabConfigurationGuard {
  id: string; key: string; scope: string; dirty?: boolean; blocked?: boolean;
  message?: string; onLeave?: () => void; assistant?: boolean; draftSignature?: string;
}
export interface TabConfigurationSnapshot {
  scope: string; focusedKey: string; href: string; state: CampusNavigationState;
  guards: readonly TabConfigurationGuard[];
  /** UIKit host catalogue changes remount retained screen bodies. */
  resetsCampusHost?: boolean;
}
export interface TabConfigurationPermit { assertCurrent(next: TabConfigurationSnapshot): void }

function configurationKeys(state: CampusNavigationState) {
  const campus = new Set<string>(), assistant = new Set<string>();
  function visit(current: CampusNavigationState, inCampus = false, inAssistant = false) {
    for (const route of current.routes) {
      const ownsCampus = inCampus || route.name === '(campus)';
      const ownsAssistant = ownsCampus && (inAssistant || route.name === '(assistant)');
      if (ownsCampus) campus.add(route.key);
      if (ownsAssistant) assistant.add(route.key);
      if (route.state) visit(route.state,ownsCampus,ownsAssistant);
    }
  }
  visit(state); return { campus,assistant };
}
/** JS workspace routes remain mounted across Assistant visibility changes.
 * UIKit catalogue changes additionally use resetsCampusHost to guard every editor. */
export function tabConfigurationKeys(state: CampusNavigationState, enabled: boolean): string[] {
  return enabled ? [] : [...configurationKeys(state).assistant];
}
export function tabConfigurationGuards(snapshot: TabConfigurationSnapshot, enabled: boolean) {
  if (enabled && !snapshot.resetsCampusHost) return [];
  const keys = configurationKeys(snapshot.state);
  return snapshot.guards.filter(guard => guard.scope === snapshot.scope &&
    (snapshot.resetsCampusHost ? keys.campus.has(guard.key) : keys.assistant.has(guard.key) || guard.assistant === true && keys.campus.has(guard.key)));
}
function signature(guards: readonly TabConfigurationGuard[]) {
  return guards.map(guard => JSON.stringify([guard.id,guard.key,!!guard.dirty,!!guard.blocked,guard.draftSignature ?? null])).sort().join('|');
}
type PermitRecord = {
  phase: 'available' | 'claimed' | 'retired';
  complete(next: TabConfigurationSnapshot): void;
};
const permits = new WeakMap<TabConfigurationPermit,PermitRecord>();
const changed = () => new Error('Your campus or Assistant draft changed. Review this choice again.');

/** Approval captures the exact caller and affected drafts, never unrelated
 * retained editors. API/focus lifetime belongs to the supplied active lease. */
export function createTabConfigurationPermit(snapshot: TabConfigurationSnapshot, enabled: boolean, assertActive: () => void): TabConfigurationPermit {
  assertActive();
  const scope = snapshot.scope, focusedKey = snapshot.focusedKey, href = snapshot.href, state = snapshot.state;
  const guards = tabConfigurationGuards(snapshot,enabled).map(guard => ({ ...guard }));
  if (guards.some(guard => guard.blocked)) throw new Error('Finish the current action before changing Assistant navigation.');
  const record: PermitRecord = {
    phase: 'available',
    complete(next) {
      const current = check(next,true);
      // Consume before callbacks: a throwing callback cannot leave reusable
      // approval, and only reviewed, still-mounted affected drafts clear.
      record.phase = 'retired';
      for (const guard of current.filter(item => item.dirty)) guard.onLeave?.();
    },
  };
  function check(next: TabConfigurationSnapshot, allowRemoved = false) {
    assertActive();
    if (record.phase === 'retired' || next.scope !== scope || next.focusedKey !== focusedKey || next.href !== href || next.state !== state || next.resetsCampusHost !== snapshot.resetsCampusHost) throw changed();
    const current = tabConfigurationGuards(next,enabled);
    // Accepted revocation can remove its Assistant owner before command.run
    // finishes. Newly mounted and changed guards still need fresh approval.
    const expected = allowRemoved ? guards.filter(guard => current.some(item => item.id === guard.id)) : guards;
    if (current.some(guard => guard.blocked) || signature(current) !== signature(expected)) throw changed();
    return current;
  }
  const permit = { assertCurrent(next: TabConfigurationSnapshot) { check(next); } };
  permits.set(permit,record); return permit;
}

/** Confirm before POST. Refusal and stale confirmation never clear a draft. */
export async function prepareTabConfigurationChange(options: {
  read(): TabConfigurationSnapshot | null; enabled: boolean; assertActive(): void;
  confirm(guards: readonly TabConfigurationGuard[]): Promise<boolean>;
  dispatch(permit: TabConfigurationPermit): void;
}): Promise<boolean> {
  const snapshot = options.read(); if (!snapshot) return false;
  try {
    const permit = createTabConfigurationPermit(snapshot,options.enabled,options.assertActive);
    const dirty = tabConfigurationGuards(snapshot,options.enabled).filter(guard => guard.dirty);
    if (dirty.length && !await options.confirm(dirty)) return false;
    const current = options.read(); if (!current) return false;
    permit.assertCurrent(current); options.dispatch(permit); return true;
  } catch { return false; }
}

/** One preference attempt owns one approval. Acknowledgement alone cannot clear
 * a draft; successful command completion consumes it immediately, then unlocks.
 * There is no later tab-host commit or reusable visibility-change approval. */
export function createTabConfigurationCommand(options: {
  permit: TabConfigurationPermit; read(): TabConfigurationSnapshot | null;
  assertActive(): void; onRetire(): void;
}) {
  const record = permits.get(options.permit);
  if (!record || record.phase !== 'available') throw changed();
  record.phase = 'claimed';
  let retired = false, acknowledged = false;
  const retire = () => {
    if (retired) return;
    retired = true; record.phase = 'retired'; options.onRetire();
  };
  return {
    get frozen() { return !retired; },
    acknowledge() {
      if (retired) return;
      try { options.assertActive(); acknowledged = true; } catch { retire(); }
    },
    finish(confirmed: boolean) {
      if (retired) return;
      try {
        if (!confirmed || !acknowledged) return;
        options.assertActive();
        const next = options.read(); if (!next) return;
        record.complete(next);
      } catch {
        // A stale or unknown attempt releases its lock without clearing drafts.
      } finally { retire(); }
    },
    retire,
  };
}
