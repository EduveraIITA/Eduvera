/** Browser-owned entry identity. These values come from the Navigation API,
 * never an inferred URL, Expo route key, or copied navigation stack. */
export interface CampusBrowserTraversalEntry {
  readonly key: string;
  readonly index: number;
}

export interface CampusBrowserTraversal {
  readonly source: CampusBrowserTraversalEntry;
  readonly target: CampusBrowserTraversalEntry;
}

function validEntry(entry: CampusBrowserTraversalEntry): boolean {
  return typeof entry.key === 'string' && entry.key.length > 0 && Number.isSafeInteger(entry.index) && entry.index >= 0;
}

function sameEntry(a: CampusBrowserTraversalEntry, b: CampusBrowserTraversalEntry): boolean {
  return a.key === b.key && a.index === b.index;
}

function copyTraversal(value: CampusBrowserTraversal): CampusBrowserTraversal {
  return Object.freeze({ source: Object.freeze({ key: value.source.key,index: value.source.index }), target: Object.freeze({ key: value.target.key,index: value.target.index }) });
}

/** Tracks only the current real traversal attempt. SDK 58 may immediately undo
 * that attempt while a removal guard asks for confirmation. Preserve the
 * original pair through its exact inverse so approval can re-traverse the
 * browser's original target. The owner clears this after cancellation/replay. */
export function createCampusBrowserTraversal(): {
  changed(type: string | null, from: CampusBrowserTraversalEntry, to: CampusBrowserTraversalEntry): void;
  capture(): CampusBrowserTraversal | null;
  clear(): void;
} {
  let pending: CampusBrowserTraversal | null = null;
  return {
    changed(type, from, to) {
      if (type !== 'traverse' || !validEntry(from) || !validEntry(to) || from.key === to.key || from.index === to.index) {
        pending = null;
        return;
      }
      if (pending && sameEntry(from, pending.target) && sameEntry(to, pending.source)) return;
      pending = copyTraversal({ source: from, target: to });
    },
    capture() { return pending ? copyTraversal(pending) : null; },
    clear() { pending = null; },
  };
}

export interface CampusBrowserRollbackAdapter {
  currentKey(): string | null;
  onChange(listener: () => void): () => void;
  hasKey(key: string): boolean;
}

/** Waits for the SDK's actual browser rollback before replay. It neither moves
 * history nor repeats the SDK's synthetic RESET. The caller must retain its
 * context assertion and recheck immediately before traverseTo(target.key). */
export function waitForBrowserRollback(
  traversal: CampusBrowserTraversal,
  adapter: CampusBrowserRollbackAdapter,
  assertCurrent: () => void,
  timeoutMs = 1500,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      const stop = unsubscribe; unsubscribe = undefined;
      try { stop?.(); } catch { /* Listener cleanup cannot change a completed result. */ }
    };
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true; cleanup();
      if (error !== undefined) reject(error); else resolve();
    };
    const check = () => {
      if (settled) return;
      try {
        assertCurrent();
        if (!adapter.hasKey(traversal.source.key) || !adapter.hasKey(traversal.target.key)) throw new Error('The original browser history entry is no longer available.');
        const current = adapter.currentKey();
        if (current === traversal.source.key) finish();
        else if (current !== traversal.target.key) throw new Error('Browser navigation changed before the original entry was restored.');
      } catch (error) { finish(error); }
    };
    try {
      if (!validEntry(traversal.source) || !validEntry(traversal.target) || traversal.source.key === traversal.target.key || traversal.source.index === traversal.target.index) throw new Error('A real browser traversal is required.');
      if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new RangeError('The browser rollback timeout must be finite and non-negative.');
      // Subscribe first: browser restoration may occur during registration.
      unsubscribe = adapter.onChange(check);
      if (settled) { cleanup(); return; }
      check();
      if (!settled) timer = setTimeout(() => {
        check();
        if (!settled) finish(new Error('The browser did not restore the original entry in time.'));
      }, timeoutMs);
    } catch (error) { finish(error); }
  });
}
