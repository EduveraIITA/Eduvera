import type { VisitParticipantList, VisitParticipantView } from '../../../packages/contracts/src/visit-onboarding';

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 500;
const instant = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
function timezone(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 100) throw new Error('The campus timezone could not be confirmed.');
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(0); return value; }
  catch { throw new Error('The campus timezone could not be confirmed.'); }
}
export const participantVisitHref = (id: string) => `/areas/in-out/visits?visit=${encodeURIComponent(id)}&participant=1`;

/** Select only the participant's minimized projection; no manager/organiser fallback. */
export function readVisitParticipant(value: unknown, visitId: string): VisitParticipantView {
  const root = object(value), visit = object(root.visit), registration = object(root.registration), place = object(visit.place), contact = object(visit.contact);
  if (!uuid(visitId) || visit.id !== visitId || !Number.isSafeInteger(visit.revision) || Number(visit.revision) < 1 || !text(visit.title)
    || !['confirmed', 'cancelled'].includes(String(visit.state)) || !instant(visit.starts_at) || !instant(visit.ends_at) || Date.parse(visit.ends_at) <= Date.parse(visit.starts_at)
    || !text(place.label) || typeof place.campus_label !== 'string' || place.campus_label.length > 500 || !text(contact.label)
    || !uuid(registration.id) || registration.evidence !== 'self_registered' || !instant(registration.registered_at) || !text(registration.person_label)
    || !instant(root.available_until) || root.entry_permission !== false || root.presence_confirmed !== false) throw new Error('Your current visit registration could not be confirmed. Refresh this original visit.');
  return {
    timezone: timezone(root.timezone),
    registration: { id: registration.id, registered_at: registration.registered_at, person_label: registration.person_label, evidence: 'self_registered' },
    available_until: root.available_until,
    visit: { id: visitId, revision: Number(visit.revision), title: visit.title, state: visit.state as 'confirmed' | 'cancelled', starts_at: visit.starts_at, ends_at: visit.ends_at,
      place: { label: place.label, campus_label: place.campus_label }, contact: { label: contact.label } },
    entry_permission: false, presence_confirmed: false,
  };
}
export function readVisitParticipantList(value: unknown, requestedPage: number): VisitParticipantList {
  const root = object(value), page = object(root.pagination);
  if (!Array.isArray(root.visits) || root.visits.length > 10 || page.page !== requestedPage || page.page_size !== 10
    || !Number.isSafeInteger(page.total) || Number(page.total) < 0 || page.total_pages !== Math.ceil(Number(page.total) / 10)) throw new Error('Your registered visits could not be confirmed. Refresh this page.');
  const seen = new Set<string>();
  const visits = root.visits.map(raw => {
    const row = object(raw);
    if (!uuid(row.id) || seen.has(row.id) || !text(row.title) || !['confirmed', 'cancelled'].includes(String(row.state))
      || !instant(row.starts_at) || !instant(row.ends_at) || Date.parse(row.ends_at) <= Date.parse(row.starts_at) || row.href !== participantVisitHref(row.id)) throw new Error('A registered visit did not match its own destination. Refresh this page.');
    seen.add(row.id);
    return { id: row.id, title: row.title, state: row.state as 'confirmed' | 'cancelled', starts_at: row.starts_at, ends_at: row.ends_at, href: row.href as string };
  });
  return { timezone: timezone(root.timezone), visits, pagination: { page: requestedPage, page_size: 10, total: Number(page.total), total_pages: Number(page.total_pages) } };
}
