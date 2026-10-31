import { useEffect, useRef, useState } from 'react';
import { createChunkedNativePendingStorage, type NativePendingStorage } from './native-pending-action';
import { validateRetainedPeopleReview, validatePeopleReview, type PeopleReviewKind, type PeopleReviewValue, type RetainedPeopleReview } from './people-lifecycle';

/** The owning server review is retained before any operative commit is offered. */
export function usePeopleReview<T extends PeopleReviewValue>({ scopeKey, kind, schoolId, personId, studentId }: { scopeKey: string; kind: PeopleReviewKind; schoolId: string; personId: string; studentId?: string }) {
  const [ready, setReady] = useState(false), [blocked, setBlocked] = useState(false), [saved, setSaved] = useState<RetainedPeopleReview<T> | null>(null), [error, setError] = useState('');
  const alive = useRef(true), storage = useRef<NativePendingStorage | null>(null);
  useEffect(() => {
    let cancelled = false; alive.current = true;
    void (async () => {
      try {
        const [Crypto, SecureStore] = await Promise.all([import('expo-crypto'), import('./device-storage')]);
        const digest = (text: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);
        const prefix = `thatcampus.people-review.${await digest(JSON.stringify([scopeKey, kind, personId, studentId ?? null]))}`;
        const secure = createChunkedNativePendingStorage({ get: SecureStore.getItemAsync, set: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }), remove: SecureStore.deleteItemAsync, randomId: Crypto.randomUUID, digest }, prefix);
        const raw = await secure.read(); if (cancelled) return; storage.current = secure;
        if (raw) { const value: unknown = JSON.parse(raw); if (!validateRetainedPeopleReview(value, scopeKey, kind, schoolId, personId, studentId) || await digest(JSON.stringify(value.review)) !== value.fingerprint) throw new Error('The retained review could not be verified. It was kept; new commits are blocked.'); if (!cancelled) setSaved(value as RetainedPeopleReview<T>); }
      } catch (cause) { if (!cancelled) { setBlocked(true); setError(cause instanceof Error ? cause.message : 'Secure review storage is unavailable.'); } }
      finally { if (!cancelled) setReady(true); }
    })();
    // A confirmed commit can update the parent profile and unmount its form
    // before the awaited handler removes this exact scope's reviewed draft.
    return () => { cancelled = true; alive.current = false; };
  }, [scopeKey, kind, schoolId, personId, studentId]);
  return { ready, blocked, saved, error,
    async retain(value: T) {
      const { captureApiContext } = await import('./api'); const context = captureApiContext();
      if (!alive.current || !ready || blocked || !storage.current) throw new Error('Secure review storage is not ready. Nothing was committed.');
      if (!validatePeopleReview(value, kind, schoolId, personId, studentId)) throw new Error('The review did not match this exact campus person and record.');
      const Crypto = await import('expo-crypto'); context.assertCurrent();
      const record: RetainedPeopleReview<T> = { version: 1, scopeKey, kind, personId, review: value, fingerprint: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(value)) };
      context.assertCurrent(); if (!alive.current || !storage.current) throw new Error('The review screen changed. Nothing was committed.');
      await storage.current.write(JSON.stringify(record)); context.assertCurrent();
      if (alive.current) { setSaved(record); setError(''); }
    },
    async clear(assertOriginalContext?: () => void) { assertOriginalContext?.(); const secure = storage.current; if ((!alive.current && !assertOriginalContext) || !secure) throw new Error('The review screen changed.'); const { captureApiContext } = await import('./api'); assertOriginalContext?.(); const context = captureApiContext(); await secure.clear(); context.assertCurrent(); assertOriginalContext?.(); if (alive.current) setSaved(null); },
  };
}
