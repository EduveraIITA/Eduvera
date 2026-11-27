import assert from 'node:assert/strict';
import test from 'node:test';
import { copilotIndicator, copilotRect, copilotWait, measureCopilotTarget, type CopilotTargetNode } from '../src/lib/copilot-target';

test('the Assistant pointer uses the host coordinate space and leaves room around real controls', () => {
  const frame = { x: 100, y: 80, width: 300, height: 200 };
  const target = { x: 160, y: 168, width: 64, height: 48 };
  assert.deepEqual(copilotIndicator(target, frame), { x: 74, y: 47, below: false,
    outline: { left: 60, top: 88, width: 64, height: 48 } });
  assert.deepEqual(copilotIndicator({ x: 100, y: 84, width: 20, height: 26 }, frame),
    { x: 6, y: 35, below: true, outline: undefined });
  assert.equal(copilotIndicator({ x: 160, y: 360, width: 64, height: 48 }, frame), undefined);
  assert.equal(copilotRect(20, NaN, 10, 10), undefined);
  assert.equal(copilotRect(20, 30, 0, 10), undefined);
});

test('an interrupted operation cannot publish stale measurement or wait to complete another step', async () => {
  const controller = new AbortController();
  let read!: (x:number, y:number, width:number, height:number) => void;
  const node = { measureInWindow(callback: typeof read) { read = callback; } } as unknown as CopilotTargetNode;
  const measured = measureCopilotTarget(node, controller.signal);
  const wait = copilotWait(2_000, controller.signal);
  controller.abort();
  read(100, 100, 20, 20);
  assert.equal(await measured, undefined);
  await wait;
  assert.equal(await measureCopilotTarget(node, controller.signal), undefined);
});
