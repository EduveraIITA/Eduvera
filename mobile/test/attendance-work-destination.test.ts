import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceAreaSurface, WorkspaceManifest } from '../../packages/contracts/src/workspace';
import { attendanceWorkDestination } from '../src/lib/attendance-work-destination';

const section = '00000000-0000-4000-8000-000000000001', session = '00000000-0000-4000-8000-000000000002', learner = '00000000-0000-4000-8000-000000000003';
const daily = `/areas/attendance/coordination?class_section_id=${section}&date=2026-10-27&student_id=${learner}`;
const scheduled = `/areas/attendance/coordination?date=2026-10-27&session_id=${session}`;
const surface = (key: string): WorkspaceAreaSurface => ({ key, label: key, href: `/areas/attendance/${key}`, capabilities: ['attendance.view'], scopes: [] });
function workspace(href: string, keys = ['registers']): WorkspaceManifest {
  return { work: { items: [{ id: 'current-work', href }] }, areas: [{ key: 'attendance', surfaces: keys.map(surface) }] } as unknown as WorkspaceManifest;
}

test('a current academic Work contribution resolves into the recipient’s existing Registers entry', () => {
  assert.equal(attendanceWorkDestination(workspace(daily), daily), `/areas/attendance/registers?class_section_id=${section}&date=2026-10-27&student_id=${learner}`);
  assert.equal(attendanceWorkDestination(workspace(scheduled), scheduled), `/areas/attendance/registers?session_id=${session}&date=2026-10-27`);
});
test('direct, altered, removed and unrelated source links cannot acquire Work routing access', () => {
  const current = workspace(scheduled);
  assert.equal(attendanceWorkDestination(current, daily), daily);
  assert.equal(attendanceWorkDestination(workspace(daily), daily.replace(section, session)), daily.replace(section, session));
  const removed = { ...current, work: { ...current.work, items: [] } };
  assert.equal(attendanceWorkDestination(removed, scheduled), scheduled);
  const generic = '/areas/attendance/registers?register_id=current';
  assert.equal(attendanceWorkDestination(workspace(generic), generic), generic);
});
test('no Registers contribution or a genuine Coordination contribution keeps the original source', () => {
  assert.equal(attendanceWorkDestination(workspace(daily, []), daily), daily);
  assert.equal(attendanceWorkDestination(workspace(daily, ['coordination']), daily), daily);
  assert.equal(attendanceWorkDestination(workspace(daily, ['registers', 'coordination']), daily), daily);
});
test('ambiguous, invalid and mixed academic selectors never redirect to another workflow', () => {
  for (const suffix of [
    '', '?date=2026-10-27', '?class_section_id=invalid&date=2026-10-27',
    `?session_id=${session}&session_id=${section}`, `?class_section_id=${section}&date=2026-02-30`,
    `?class_section_id=${section}&session_id=${session}&date=2026-10-27`,
    `?session_id=${session}&register_id=${section}`, `?session_id=${session}&occurrence_id=${section}`,
    `?session_id=${session}&review_case=${section}`, `?session_id=${session}&source=continuity`,
    `?session_id=${session}&scope=other`,
  ]) {
    const href = `/areas/attendance/coordination${suffix}`;
    assert.equal(attendanceWorkDestination(workspace(href), href), href, suffix);
  }
});
