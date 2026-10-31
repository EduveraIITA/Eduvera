import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AARANYA_CALENDAR_ARRANGEMENTS as arrangements,
  AARANYA_CALENDAR_PROVENANCE as provenance,
  AARANYA_CALENDAR_REFERENCES as references,
  AARANYA_CALENDAR_YEAR as year,
  AARANYA_EXISTING_CALENDAR_OVERRIDES as retainedOverrides,
  AARANYA_OPTIONAL_ASSESSMENT_CANDIDATES as assessments,
  AARANYA_OPTIONAL_EVENT_CANDIDATES as events,
} from './aaranya-calendar-year.mjs';

const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

await test('the authored year preserves exact existing term dates without activating the future term', () => {
  assert.equal(year.starts_on, '2026-07-01');
  assert.equal(year.ends_on, '2027-06-30');
  assert.deepEqual(year.semester_i, { starts_on: '2026-08-11', ends_on: '2026-12-31' });
  assert.deepEqual(year.semester_ii, { starts_on: '2027-01-04', ends_on: '2027-06-30', remains_inactive: true });
  assert.equal(arrangements.find(row => row.fixture_key.endsWith('semester-i-opens')).starts_on, year.semester_i.starts_on);
  assert.equal(arrangements.find(row => row.fixture_key.endsWith('semester-i-boundary')).ends_on, year.semester_i.ends_on);
  assert.equal(arrangements.find(row => row.fixture_key.endsWith('semester-ii-opens')).starts_on, year.semester_ii.starts_on);
  assert.ok(!arrangements.some(row => row.starts_on < year.semester_i.starts_on && /teaching begins|classes begin/i.test(row.title)));
});

await test('all twelve months have authored information, with a realistic busy November', () => {
  assert.equal(arrangements.length, 56);
  const counts = new Map();
  for (const row of arrangements) counts.set(row.starts_on.slice(0, 7), (counts.get(row.starts_on.slice(0, 7)) ?? 0) + 1);
  assert.deepEqual([...counts.keys()], [
    '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12',
    '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06',
  ]);
  for (const [month, count] of counts) {
    if (month === '2026-11') assert.ok(count > 8, 'November must exercise finite list pagination');
    else assert.ok(count >= 4 && count <= 6, `${month} has an unrealistic fixture density`);
  }
});

await test('all notices have stable unique keys, valid ordered ranges and bounded public categories', () => {
  const keys = new Set();
  for (const row of arrangements) {
    assert.match(row.fixture_key, /^aaranya-2026-27-[a-z0-9-]+$/);
    assert.ok(!keys.has(row.fixture_key), `duplicate key ${row.fixture_key}`);
    keys.add(row.fixture_key);
    assert.ok(validDate(row.starts_on) && validDate(row.ends_on), row.fixture_key);
    assert.ok(row.starts_on <= row.ends_on, row.fixture_key);
    assert.ok(row.starts_on >= year.starts_on && row.starts_on <= year.ends_on, row.fixture_key);
    assert.ok(row.ends_on <= year.boundary_notice_ends_on, row.fixture_key);
    assert.ok(row.title.length >= 8 && row.title.length <= 200, row.fixture_key);
    assert.ok(['Academic', 'Campus life', 'Service notice'].includes(row.category));
    assert.ok(row.category.length <= 60);
  }
  assert.equal(keys.size, arrangements.length);
});

await test('fictionality and source patterns are explicit on every announcement and optional example', () => {
  const sourceKeys = new Set(references.map(reference => reference.key));
  assert.equal(sourceKeys.size, references.length);
  for (const row of [...arrangements, ...events, ...assessments]) {
    assert.ok(row.description.startsWith(provenance), row.fixture_key);
    if ('source_pattern' in row) assert.ok(sourceKeys.has(row.source_pattern), row.fixture_key);
    else {
      const source = row.description.match(/Source pattern: ([a-z-]+);/);
      assert.ok(source && sourceKeys.has(source[1]), row.fixture_key);
    }
    assert.ok(!/official Aaranya schedule|verified institutional schedule|confirmed payment/i.test(row.description), row.fixture_key);
  }
  assert.ok(references.every(reference => /^https:\/\/[^/]*\.(?:ac\.in|iitgn\.ac\.in)\//.test(reference.url)));
});

await test('announcements cannot accidentally carry operating commands, closure flags or personal evidence', () => {
  const allowed = ['category', 'description', 'ends_on', 'fixture_key', 'source_pattern', 'starts_on', 'title'];
  for (const row of arrangements) {
    assert.deepEqual(Object.keys(row).sort(), [...allowed, ...('academic_term_key' in row ? ['academic_term_key'] : [])].sort(), row.fixture_key);
    assert.ok(!/scholarship|grade submission|faculty deadline|staff-only/i.test(row.title), row.fixture_key);
    assert.ok(!('is_instructional' in row) && !('status' in row) && !('marks' in row) && !('amount' in row));
  }
  assert.deepEqual(retainedOverrides.map(row => [row.starts_on, row.ends_on]), [['2026-11-09', '2026-11-11']]);
  assert.ok(!arrangements.some(row => row.starts_on === '2026-11-09' || /mid-semester break/i.test(row.title)));
  // Operating state belongs to native owning-domain sources, never these prose
  // announcements. Keep this invariant in tests, not as repeated user warnings.
  assert.equal(Object.hasOwn(arrangements.find(row => row.fixture_key.endsWith('winter-teaching-break-guidance')), 'is_instructional'), false);
});

await test('cross-month, year-boundary and long-title examples are present without invented future activations', () => {
  for (const [start, end] of [
    ['2026-12-05', '2027-01-03'], ['2027-02-28', '2027-03-01'],
    ['2027-04-26', '2027-05-05'], ['2027-06-30', '2027-07-02'],
  ]) assert.ok(arrangements.some(row => row.starts_on === start && row.ends_on === end), `${start} through ${end}`);
  assert.ok(arrangements.some(row => row.title.length > 100));
  assert.ok(year.semester_ii.remains_inactive);
  assert.ok(arrangements.find(row => row.fixture_key.endsWith('semester-ii-opens')).description.includes('planned to begin'));
  assert.ok(arrangements.filter(row => /results information/.test(row.title)).every(row => /Planned point/.test(row.description)));
  assert.ok(arrangements.filter(row => /results information/.test(row.title)).every(row => /see Reports when results are released/i.test(row.description)));
});

await test('term-linked information stays inside the retained matching term without implying future enrolment', () => {
  const linked = arrangements.filter(row => row.academic_term_key);
  assert.ok(linked.some(row => row.academic_term_key === 'semester_i'));
  assert.ok(linked.some(row => row.academic_term_key === 'semester_ii'));
  for (const row of linked) {
    const term = year[row.academic_term_key];
    assert.ok(term, row.fixture_key);
    assert.ok(row.starts_on >= term.starts_on && row.ends_on <= term.ends_on, row.fixture_key);
  }
  const teachingEnd = arrangements.find(row => row.fixture_key.endsWith('semester-i-teaching-phase-ends'));
  assert.equal(teachingEnd.starts_on, '2026-11-20');
  assert.match(teachingEnd.description, /continues through 31 December 2026/);
  assert.equal(arrangements.find(row => row.fixture_key.endsWith('research-innovation-week')).academic_term_key, undefined);
  assert.match(arrangements.find(row => row.fixture_key.endsWith('research-innovation-week')).description, /28 October digital-twins colloquium/);
});

await test('annual descriptions give concise reader guidance without implementation or validation prose', () => {
  for (const row of arrangements) {
    assert.ok(row.description.length <= 400, row.fixture_key);
    assert.doesNotMatch(row.description, /responsive-layout|owning.domain|this (?:notice|announcement|record) (?:does not|creates no)|retained |inactive|fixture|Source pattern:|command|evidence|is asserted|is inferred/i, row.fixture_key);
  }
});

await test('optional source candidates stay separate, current-term, nonphysical and unexecuted', () => {
  const allKeys = [...arrangements, ...events, ...assessments].map(row => row.fixture_key);
  assert.equal(new Set(allKeys).size, allKeys.length);
  assert.equal(events.length, 4);
  assert.equal(assessments.length, 2);
  for (const row of [...events, ...assessments]) {
    assert.ok(validDate(row.date) && row.date >= '2026-11-01' && row.date <= '2026-12-31');
    assert.match(row.starts_at_local, /^\d{2}:\d{2}$/);
    assert.equal(row.time_zone, year.time_zone);
    assert.ok(!('status' in row) && !('attendance' in row) && !('marks' in row));
  }
  for (const row of events) assert.ok(row.starts_at_local < row.ends_at_local);
  for (const row of assessments) {
    assert.equal(row.delivery_hint, 'online');
    assert.equal(row.duration_minutes, 60);
    assert.match(row.description, /candidate/);
    assert.ok(!('class_section_id' in row) && !('subject_id' in row) && !('student_id' in row));
  }
});

await test('fixture exports are immutable authored data rather than a mutable seed execution state', () => {
  for (const value of [year, year.semester_i, year.semester_ii, arrangements, retainedOverrides, references, events, assessments]) assert.ok(Object.isFrozen(value));
  for (const row of [...arrangements, ...retainedOverrides, ...references, ...events, ...assessments]) assert.ok(Object.isFrozen(row));
});
