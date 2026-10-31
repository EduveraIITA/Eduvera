import type { VisitOnboardingJoinResult, VisitOnboardingPreview } from '../../../packages/contracts/src/visit-onboarding';
import { visitJoinReturnTarget, visitJoinToken, visitJoinUuid } from './visit-join-policy';

export interface VisitJoinIntent {
  readonly id: string; readonly origin: string; readonly token: string; readonly createdAt: number;
  readonly preview?: VisitOnboardingPreview;
  readonly accountStatus?: 'dispatched' | 'complete';
  readonly command?: { actorId: string; id: string; dispatched: boolean };
  readonly accepted?: { actorId: string; result: VisitOnboardingJoinResult };
  readonly completion?: 'refresh' | 'refreshing' | 'select' | 'selecting' | 'ready' | 'error';
}
/** Memory only: no storage, credentials, email, password, proof code or session.
 * An old/cold nonce is never sufficient to reconstruct an invitation token. */
export function createVisitJoinContinuations(now: () => number = Date.now) {
  const entries = new Map<string, VisitJoinIntent>(), listeners = new Set<() => void>(); let revision = 0;
  const changed = () => { revision++; for (const listener of listeners) listener(); };
  const current = (id: string, origin: string) => {
    const value = entries.get(id);
    return value?.origin === origin && now() - value.createdAt >= 0 && now() - value.createdAt < 30 * 60_000 ? value : null;
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    revision: () => revision,
    read: current,
    retain(token: string, origin: string, randomId: () => string) {
      let server: URL; try { server = new URL(origin); } catch { throw new Error('This visit link is unavailable.'); }
      if (!visitJoinToken(token) || !['https:','http:'].includes(server.protocol) || server.origin !== origin || server.username || server.password) throw new Error('This visit link is unavailable.');
      const id = randomId(); if (!visitJoinUuid.test(id) || entries.has(id)) throw new Error('The visit continuation could not be prepared.');
      for (const [key,value] of entries) if (!current(key,value.origin)) entries.delete(key);
      if (entries.size >= 4) { const available = [...entries.values()].find(value => !value.command?.dispatched && !value.accepted); if (!available) throw new Error('Finish an earlier visit request before opening another link.'); entries.delete(available.id); }
      entries.set(id,{ id,token,origin,createdAt: now() }); changed(); return `/visit-join?continue=${id}`;
    },
    resolve(href: unknown, origin: string) { const path = visitJoinReturnTarget(href); return path ? current(path.slice('/visit-join?continue='.length),origin) : null; },
    update(id: string, origin: string, update: (entry: VisitJoinIntent) => VisitJoinIntent) {
      const value = current(id,origin); if (!value) throw new Error('Open the original visit link again.');
      const next = update(value);
      if (next.id !== value.id || next.origin !== value.origin || next.token !== value.token || next.createdAt !== value.createdAt) throw new Error('The visit continuation changed.');
      entries.set(id,next); changed(); return next;
    },
    remove(id: string) { if (entries.delete(id)) changed(); },
  };
}
export const visitJoinContinuations = createVisitJoinContinuations();
