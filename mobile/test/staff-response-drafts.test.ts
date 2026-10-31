import assert from 'node:assert/strict';
import test from 'node:test';
import { clearStaffResponseDraft, editStaffResponseDraft, hasStaffResponseDrafts, type StaffResponseDrafts } from '../src/lib/staff-response-drafts';

test('a retained note keeps its reviewed source revision across refresh and list changes', () => {
  let drafts: StaffResponseDrafts = editStaffResponseDraft({}, 'leave:a', 7, 'Please explain coverage');
  const saved = drafts;
  // The visible record can move to another page or leave the pending filter.
  assert.equal(drafts['leave:a'].note, 'Please explain coverage');
  drafts = editStaffResponseDraft(drafts, 'leave:a', 8, 'Please explain current coverage');
  assert.deepEqual(drafts['leave:a'], { note: 'Please explain current coverage', revision: 7 });
  assert.deepEqual(saved['leave:a'], { note: 'Please explain coverage', revision: 7 });
  assert.equal(hasStaffResponseDrafts(drafts), true);
});

test('response records and response kinds retain independent drafts', () => {
  let drafts: StaffResponseDrafts = {};
  for (const id of ['assignment:a', 'coverage:a', 'leave:a', 'leave:b']) drafts = editStaffResponseDraft(drafts, id, 3, id);
  drafts = clearStaffResponseDraft(drafts, 'leave:a');
  assert.deepEqual(Object.keys(drafts).sort(), ['assignment:a', 'coverage:a', 'leave:b']);
  assert.equal(drafts['leave:b'].note, 'leave:b');
});

test('an accepted earlier response cannot erase a later edit or rebased draft', () => {
  const submitted = { note: 'Reviewed note', revision: 4 };
  let drafts: StaffResponseDrafts = editStaffResponseDraft({}, 'coverage:a', 4, submitted.note);
  assert.deepEqual(clearStaffResponseDraft(drafts, 'coverage:a', submitted), {});
  drafts = editStaffResponseDraft(drafts, 'coverage:a', 4, 'Changed while waiting');
  assert.equal(clearStaffResponseDraft(drafts, 'coverage:a', submitted), drafts);
  drafts = editStaffResponseDraft(clearStaffResponseDraft(drafts, 'coverage:a'), 'coverage:a', 5, submitted.note);
  assert.equal(clearStaffResponseDraft(drafts, 'coverage:a', submitted), drafts);
});

test('clearing a note permits a new reviewed revision and whitespace alone is not dirty', () => {
  let drafts = editStaffResponseDraft({}, 'assignment:a', 1, 'Old note');
  drafts = editStaffResponseDraft(drafts, 'assignment:a', 2, '');
  assert.deepEqual(drafts, {});
  drafts = editStaffResponseDraft(drafts, 'assignment:a', 2, '  ');
  assert.equal(hasStaffResponseDrafts(drafts), false);
  drafts = editStaffResponseDraft(drafts, 'assignment:a', 2, 'New note');
  assert.deepEqual(drafts['assignment:a'], { note: 'New note', revision: 2 });
});
