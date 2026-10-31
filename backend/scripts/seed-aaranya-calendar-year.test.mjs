import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { coherentContext, publicationRequests, months, AaranyaCalendarClient } from './seed-aaranya-calendar-year.mjs';
import { AARANYA_CALENDAR_YEAR as year } from './aaranya-calendar-year.mjs';
const setup = { school: { id: year.school_id, name: year.institution_name }, campuses: [{ id: '9af3ca14-0096-4b41-b36b-0e7bbfaf4480', code: 'AIT-MAIN' }], classes: Array(52).fill({ id: 'preserved' }), staff: [] };
const planning = { school_id: year.school_id, classes: [{ grade: 'M.Tech Data Eng', section: '2026 · Sem I' }], terms: [
  { id: 'retained-term-one', academic_year: '2026-27', ...year.semester_i, is_active: true },
  { id: 'retained-term-two', academic_year: '2026-27', starts_on: year.semester_ii.starts_on, ends_on: year.semester_ii.ends_on, is_active: false },
] };
const days = { results: ['2026-11-09', '2026-11-10', '2026-11-11'].map(date => ({ date, is_instructional: false })) };
describe('Aaranya annual import coherence', () => {
  it('resolves real period identities and emits only the owning published-date fields', () => {
    const context = coherentContext(setup, planning, days), requests = publicationRequests(context);
    assert.equal(requests.length, 56);
    assert.equal(requests.find(r => r.fixture_key.endsWith('semester-i-opens')).fields.academic_term_id, 'retained-term-one');
    assert.equal(requests.find(r => r.fixture_key.endsWith('semester-ii-opens')).fields.academic_term_id, 'retained-term-two');
    for (const request of requests) {
      assert.deepEqual(Object.keys(request.fields).sort(), ['title', 'description', 'starts_on', 'ends_on', 'category_label', 'academic_term_id', 'provenance'].sort());
      assert.match(request.fields.provenance.source_note, /https:\/\//);
      assert.equal(request.fields.provenance.fixture_key, request.fixture_key);
    }
  });
  it('refuses altered term dates, activation, institution and missing retained teaching overrides', () => {
    assert.throws(() => coherentContext({ ...setup, school: { ...setup.school, id: 'another' } }, planning, days), /exact/);
    assert.throws(() => coherentContext(setup, { ...planning, terms: planning.terms.map(t => ({ ...t, is_active: true })) }, days), /activation/);
    assert.throws(() => coherentContext(setup, { ...planning, terms: [] }, days), /dates/);
    assert.throws(() => coherentContext(setup, planning, { results: [] }), /break/);
    const context = coherentContext(setup, planning, days);
    assert.throws(() => publicationRequests({ ...context, terms: { ...context.terms, semester_i: { ...context.terms.semester_i, starts_on: '2026-09-01' } } }), /contradicts/);
  });
  it('covers exactly twelve bounded months across the year boundary', () => {
    assert.equal(months.length, 12);
    assert.deepEqual(months[0], { from: '2026-07-01', until: '2026-07-31' });
    assert.deepEqual(months[7], { from: '2027-02-01', until: '2027-02-28' });
    assert.deepEqual(months.at(-1), { from: '2027-06-01', until: '2027-06-30' });
  });
  it('never accepts a remote runtime or constructs a second database writer', () => {
    assert.throws(() => new AaranyaCalendarClient('https://campus.example.test'), /local runtime/);
    assert.throws(() => new AaranyaCalendarClient('http://10.0.0.1:8000'), /local runtime/);
    assert.equal(new AaranyaCalendarClient('http://127.0.0.1:8000').api, 'http://127.0.0.1:8000');
  });
});
