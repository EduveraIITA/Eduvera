import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCampusBrowserTraversal,
  waitForBrowserRollback,
  type CampusBrowserRollbackAdapter,
  type CampusBrowserTraversal,
  type CampusBrowserTraversalEntry,
} from '../src/lib/back-browser-traversal';

const entry = (key: string, index: number): CampusBrowserTraversalEntry => ({ key, index });

for (const [name, source, target] of [
  ['Back', entry('B', 1), entry('A', 0)],
  ['Forward', entry('A', 0), entry('B', 1)],
  ['multi-step Back', entry('D', 3), entry('A', 0)],
  ['multi-step Forward', entry('A', 0), entry('D', 3)],
] as const) {
  test(`${name} preserves its original browser entries through the SDK inverse rollback`, () => {
    const tracker = createCampusBrowserTraversal();
    tracker.changed('traverse', source, target);
    assert.deepEqual(tracker.capture(), { source, target });
    tracker.changed('traverse', target, source);
    assert.deepEqual(tracker.capture(), { source, target });
    tracker.clear();
    assert.equal(tracker.capture(), null);
  });
}

test('capture returns fresh deeply immutable entry snapshots and never exposes caller objects', () => {
  const tracker = createCampusBrowserTraversal();
  const source = { key: 'B', index: 1 }, target = { key: 'A', index: 0 };
  tracker.changed('traverse', source, target);
  source.key = 'changed'; target.index = 90;
  const first = tracker.capture()!, second = tracker.capture()!;
  assert.deepEqual(first, { source: entry('B', 1), target: entry('A', 0) });
  assert.notEqual(first, second);
  assert.notEqual(first.source, second.source);
  assert.notEqual(first.target, second.target);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.source), true);
  assert.equal(Object.isFrozen(first.target), true);
  assert.equal(Reflect.set(first.source,'key','changed'),false);
  assert.equal(first.source.key,'B');
});

test('a newer unrelated real traversal supersedes the previous pending pair', () => {
  const tracker = createCampusBrowserTraversal();
  tracker.changed('traverse', entry('D', 3), entry('A', 0));
  tracker.changed('traverse', entry('A', 0), entry('D', 3));
  tracker.changed('traverse', entry('D', 3), entry('C', 2));
  assert.deepEqual(tracker.capture(), { source: entry('D', 3), target: entry('C', 2) });
});

for (const type of ['push', 'replace', 'reload', null, 'unknown']) {
  test(`${String(type)} clears the pending traversal`, () => {
    const tracker = createCampusBrowserTraversal();
    tracker.changed('traverse', entry('B', 1), entry('A', 0));
    tracker.changed(type, entry('A', 0), entry('C', 2));
    assert.equal(tracker.capture(), null);
  });
}

test('invalid, missing and unchanged real-entry identities cannot become replay plans', () => {
  for (const [source, target] of [
    [entry('', 1), entry('A', 0)], [entry('B', -1), entry('A', 0)],
    [entry('B', Number.NaN), entry('A', 0)], [entry('B', 1.5), entry('A', 0)],
    [entry('B', 1), entry('B', 1)], [entry('B', 1), entry('A', 1)],
  ]) {
    const tracker = createCampusBrowserTraversal();
    tracker.changed('traverse', entry('B', 1), entry('A', 0));
    tracker.changed('traverse', source!, target!);
    assert.equal(tracker.capture(), null);
  }
});

function fakeBrowser(initial = 'A') {
  let current = initial;
  const keys = new Set(['A', 'B', 'C']);
  const listeners = new Set<() => void>();
  let stops = 0;
  const adapter: CampusBrowserRollbackAdapter = {
    currentKey: () => current,
    hasKey: key => keys.has(key),
    onChange(listener) { listeners.add(listener); return () => { listeners.delete(listener); stops++; }; },
  };
  return {
    adapter, keys,
    move(key: string) { current = key; for (const listener of [...listeners]) listener(); },
    emit() { for (const listener of [...listeners]) listener(); },
    get listening() { return listeners.size; },
    get stops() { return stops; },
  };
}
const backward: CampusBrowserTraversal = { source: entry('B', 1), target: entry('A', 0) };

test('rollback wait remains pending at target and resolves only when the actual source is restored', async () => {
  const browser = fakeBrowser('A'); let assertions = 0, resolved = false;
  const waiting = waitForBrowserRollback(backward, browser.adapter, () => { assertions++; }, 100);
  void waiting.then(() => { resolved = true; });
  await Promise.resolve();
  assert.equal(resolved, false);
  assert.equal(browser.listening, 1);
  browser.move('A');
  await Promise.resolve();
  assert.equal(resolved, false);
  browser.move('B');
  await waiting;
  assert.equal(resolved, true);
  assert.ok(assertions >= 3);
  assert.equal(browser.listening, 0);
  assert.equal(browser.stops, 1);
});

test('an already restored source resolves immediately after checking context and both keys', async () => {
  const browser = fakeBrowser('B'); let assertions = 0;
  await waitForBrowserRollback(backward, browser.adapter, () => { assertions++; }, 100);
  assert.equal(assertions, 1);
  assert.equal(browser.listening, 0);
  assert.equal(browser.stops, 1);
});

test('Forward waits for its original earlier source rather than the lower-index target', async () => {
  const browser = fakeBrowser('B');
  const waiting = waitForBrowserRollback({ source: entry('A', 0), target: entry('B', 1) }, browser.adapter, () => {}, 100);
  assert.equal(browser.listening, 1);
  browser.move('A');
  await waiting;
  assert.equal(browser.listening, 0);
});

test('restoration during listener registration cannot be missed or leak the subscription', async () => {
  let current = 'A', stopped = false;
  await waitForBrowserRollback(backward, {
    currentKey: () => current,
    hasKey: () => true,
    onChange(listener) { current = 'B'; listener(); return () => { stopped = true; }; },
  }, () => {}, 100);
  assert.equal(stopped, true);
});

test('an unrelated browser navigation rejects rather than replaying against another current entry', async () => {
  const browser = fakeBrowser('A');
  const waiting = waitForBrowserRollback(backward, browser.adapter, () => {}, 100);
  browser.move('C');
  await assert.rejects(waiting, /navigation changed/);
  assert.equal(browser.listening, 0);
});

test('disposing either browser-owned entry rejects even if the source is already current', async () => {
  for (const missing of ['A', 'B']) {
    const browser = fakeBrowser('B'); browser.keys.delete(missing);
    await assert.rejects(waitForBrowserRollback(backward, browser.adapter, () => {}, 100), /no longer available/);
    assert.equal(browser.listening, 0);
  }
});

test('disposal during rollback waiting rejects and releases its listener', async () => {
  const browser = fakeBrowser('A');
  const waiting = waitForBrowserRollback(backward, browser.adapter, () => {}, 100);
  browser.keys.delete('A'); browser.emit();
  await assert.rejects(waiting, /no longer available/);
  assert.equal(browser.listening, 0);
});

test('a changed account/institution/world assertion rejects before replay becomes available', async () => {
  const browser = fakeBrowser('A'); let current = true;
  const error = new Error('The selected campus world changed.');
  const waiting = waitForBrowserRollback(backward, browser.adapter, () => { if (!current) throw error; }, 100);
  current = false; browser.move('B');
  await assert.rejects(waiting, actual => actual === error);
  assert.equal(browser.listening, 0);
});

test('initial context refusal does not leave a subscribed listener', async () => {
  const browser = fakeBrowser('B'); const error = new Error('Context expired.');
  await assert.rejects(waitForBrowserRollback(backward, browser.adapter, () => { throw error; }, 100), actual => actual === error);
  assert.equal(browser.listening, 0);
});

test('a browser that never restores the source times out and releases its listener', async () => {
  const browser = fakeBrowser('A');
  await assert.rejects(waitForBrowserRollback(backward, browser.adapter, () => {}, 5), /did not restore/);
  assert.equal(browser.listening, 0);
  assert.equal(browser.stops, 1);
});

test('context is rechecked when a wait times out without any browser event', async () => {
  const browser = fakeBrowser('A'); let current = true;
  const waiting = waitForBrowserRollback(backward, browser.adapter, () => { if (!current) throw new Error('Context expired.'); }, 5);
  current = false;
  await assert.rejects(waiting, /Context expired/);
  assert.equal(browser.listening, 0);
});

test('invalid traversal and timeout input never subscribe to browser events', async () => {
  const browser = fakeBrowser('B');
  await assert.rejects(waitForBrowserRollback({ source: entry('B', 1), target: entry('B', 1) }, browser.adapter, () => {}, 5), /real browser traversal/);
  await assert.rejects(waitForBrowserRollback(backward, browser.adapter, () => {}, Number.POSITIVE_INFINITY), RangeError);
  assert.equal(browser.listening, 0);
  assert.equal(browser.stops, 0);
});

test('browser platform entry prototype getters are copied explicitly, never lost by object spread', () => {
  class BrowserEntry { constructor(private readonly identity: string,private readonly ordinal: number) {} get key() { return this.identity; } get index() { return this.ordinal; } }
  const tracker = createCampusBrowserTraversal(); tracker.changed('traverse',new BrowserEntry('source',4),new BrowserEntry('target',1));
  assert.deepEqual(tracker.capture(),{ source: { key: 'source',index: 4 },target: { key: 'target',index: 1 } });
});
