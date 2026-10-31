import { apiFetch } from '../../lib/api';
import type { CalendarEntry } from './campusCalendarSources';

export interface PublishedCampusDate {
  id: string; school_id: string; title: string; description: string;
  starts_on: string; ends_on: string; category_label: string;
  state: 'published' | 'cancelled'; revision: number;
  academic_term_id: string | null;
  provenance: { fixture_key?: string; source_note?: string } | null;
  cancellation_reason?: string | null;
}
export interface PublishedCampusDatesPage {
  items: PublishedCampusDate[]; page: number; page_size: number; total: number;
  total_pages: number; from: string; until: string; can_manage: boolean;
}
export type CampusDateFields = Pick<PublishedCampusDate,
  'title' | 'description' | 'starts_on' | 'ends_on' | 'category_label' | 'academic_term_id' | 'provenance'>;

export async function loadPublishedCampusDates(school: string, from: string, until: string, signal?: AbortSignal) {
  const entries: CalendarEntry[] = [], ids = new Set<string>();
  let partial = false, canManage = false;
  for (let page = 1; page <= 10; page++) {
    const response = await apiFetch<PublishedCampusDatesPage>(`/api/v1/schools/${school}/campus-dates?${new URLSearchParams({ from, until, page: String(page) })}`, { signal });
    if (!Array.isArray(response.items) || response.page !== page || !Number.isSafeInteger(response.total_pages) || response.total_pages < 1)
      throw new Error('Published dates returned an incomplete page. Refresh this source.');
    canManage = response.can_manage === true;
    for (const item of response.items) {
      if (ids.has(item.id)) { partial = true; continue; }
      ids.add(item.id);
      entries.push({ id: `milestones:${item.id}`, category: 'milestones', sourceId: item.id,
        title: item.title, startsOn: item.starts_on, endsOn: item.ends_on, allDay: true,
        revision: item.revision, summary: item.description, publication: item,
        status: item.state === 'cancelled' ? 'Cancelled' : undefined,
        categoryLabel: item.category_label,
      });
    }
    if (page >= response.total_pages) return { entries, partial, canManage };
    if (page === 10) partial = true;
  }
  return { entries, partial, canManage };
}

/** The same retained key is reused until a publication outcome is known. */
export function publishCampusDate(school: string, fields: CampusDateFields, key: string) {
  return apiFetch<PublishedCampusDate>(`/api/v1/schools/${school}/campus-dates`, {
    method: 'POST', body: JSON.stringify({ ...fields, idempotency_key: key }),
  });
}
export function correctCampusDate(school: string, record: PublishedCampusDate, fields: CampusDateFields, reason: string, key: string) {
  return apiFetch<PublishedCampusDate>(`/api/v1/schools/${school}/campus-dates/${record.id}/correct`, {
    method: 'POST', body: JSON.stringify({ ...fields, reason, expected_revision: record.revision, idempotency_key: key }),
  });
}
export function cancelCampusDate(school: string, record: PublishedCampusDate, reason: string, key: string) {
  return apiFetch<PublishedCampusDate>(`/api/v1/schools/${school}/campus-dates/${record.id}/cancel`, {
    method: 'POST', body: JSON.stringify({ reason, expected_revision: record.revision, idempotency_key: key }),
  });
}
