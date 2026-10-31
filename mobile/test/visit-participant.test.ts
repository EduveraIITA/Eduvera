import assert from 'node:assert/strict';
import test from 'node:test';
import { participantVisitHref, readVisitParticipant, readVisitParticipantList } from '../src/lib/visit-participant';

const visitId = '11111111-1111-4111-8111-111111111111', registrationId = '22222222-2222-4222-8222-222222222222';
const starts = '2026-11-01T04:30:00.000Z', ends = '2026-11-01T06:30:00.000Z';
const detail = () => ({ timezone: 'Asia/Kolkata', available_until: ends,
  registration: { id: registrationId, registered_at: '2026-10-30T04:00:00.000Z', person_label: 'Synthetic visitor', evidence: 'self_registered' },
  visit: { id: visitId, revision: 2, title: 'Synthetic visit', state: 'confirmed', starts_at: starts, ends_at: ends,
    place: { label: 'Guest house', campus_label: 'Synthetic campus' }, contact: { label: 'Campus contact' } },
  entry_permission: false, presence_confirmed: false });

test('participant detail selects its own minimized registration without promoting it to entry evidence', () => {
  const input = { ...detail(), private_thread: 'Must not leave this projection', roster: ['Private person'] };
  const result = readVisitParticipant(input, visitId);
  assert.deepEqual(result, detail());
  assert.equal('private_thread' in result, false);
  assert.equal(result.entry_permission, false);
  assert.equal(result.presence_confirmed, false);
});
test('participant detail rejects foreign identity, invented entry, missing self evidence and invalid campus time', () => {
  const mutations = [
    (value: any) => { value.visit.id = registrationId; },
    (value: any) => { value.entry_permission = true; },
    (value: any) => { value.presence_confirmed = true; },
    (value: any) => { value.registration.evidence = 'arrival'; },
    (value: any) => { value.registration.id = ''; },
    (value: any) => { value.timezone = ''; },
    (value: any) => { value.timezone = 'Not/AZone'; },
    (value: any) => { value.visit.starts_at = '2026-11-01T10:00:00'; },
    (value: any) => { value.visit.ends_at = value.visit.starts_at; },
  ];
  for (const mutate of mutations) { const value = detail(); mutate(value); assert.throws(() => readVisitParticipant(value, visitId)); }
});
test('cancelled planned visits remain truthful and do not invent observed movement', () => {
  const value = detail(); value.visit.state = 'cancelled';
  const result = readVisitParticipant(value, visitId);
  assert.equal(result.visit.state, 'cancelled');
  assert.equal('last_movement' in result.visit, false);
});
const list = () => ({ timezone: 'Asia/Kolkata', visits: [{ id: visitId, title: 'Synthetic visit', state: 'confirmed', starts_at: starts, ends_at: ends, href: participantVisitHref(visitId) }], pagination: { page: 1, page_size: 10, total: 1, total_pages: 1 } });
test('registered list requires the exact participant destination and bounded owning page', () => {
  assert.deepEqual(readVisitParticipantList(list(), 1), list());
  const corruptions = [
    (value: any) => { value.visits[0].href = `/areas/in-out/visits?visit=${visitId}&shared=1`; },
    (value: any) => { value.visits[0].href += '&participant=0'; },
    (value: any) => { value.visits.push(value.visits[0]); },
    (value: any) => { value.pagination.page = 2; },
    (value: any) => { value.pagination.total_pages = 2; },
    (value: any) => { value.pagination.page_size = 100; },
  ];
  for (const corrupt of corruptions) { const value = list(); corrupt(value); assert.throws(() => readVisitParticipantList(value, 1)); }
});
