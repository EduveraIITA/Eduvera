import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAlertQueue } from '../src/ui/alert-queue';

test('queued alerts invoke only the explicitly chosen current action, once', () => {
  const queue = createAlertQueue(), effects: string[] = [];
  queue.alert('First', 'Review', [{ text: 'Cancel', style: 'cancel', onPress: () => effects.push('cancel') }, { text: 'Save', onPress: () => { effects.push('save'); queue.alert('Saved'); } }]);
  const first = queue.current()!.id; queue.alert('Second', undefined, [{ text: 'Delete', style: 'destructive', onPress: () => effects.push('delete') }]);
  queue.choose(first + 1, 0); queue.choose(first, -1); queue.choose(first, 9); assert.deepEqual(effects, []);
  queue.choose(first, 1); queue.choose(first, 1); assert.deepEqual(effects, ['save']);
  assert.equal(queue.current()!.title, 'Second'); queue.choose(queue.current()!.id, 0); assert.deepEqual(effects, ['save', 'delete']); assert.equal(queue.current()!.title, 'Saved');
});
test('dismissal invokes cancel and dismissal, never a positive/destructive action', () => {
  const queue = createAlertQueue(), effects: string[] = [];
  queue.alert('Keep?', undefined, [{ text: 'Keep', style: 'cancel', onPress: () => effects.push('keep') }, { text: 'Delete', style: 'destructive', onPress: () => effects.push('delete') }], { onDismiss: () => effects.push('dismissed') });
  queue.dismiss(queue.current()!.id); assert.equal(queue.current(), null); assert.deepEqual(effects, ['keep', 'dismissed']);
});
test('a blocked dismissal and a changed actor/campus/world cannot activate old callbacks', () => {
  const queue = createAlertQueue(); let effects = 0;
  queue.setScope('actor:campus:live'); queue.alert('Confirm', undefined, [{ onPress: () => effects++ }], { cancelable: false });
  const id = queue.current()!.id; queue.dismiss(id); assert.equal(queue.current()!.id, id);
  queue.setScope('actor:campus:simulation'); assert.equal(queue.current(), null); queue.choose(id, 0); assert.equal(effects, 0);
  queue.alert('Current'); const current = queue.current(); queue.setScope('actor:campus:simulation'); assert.equal(queue.current(), current);
});
