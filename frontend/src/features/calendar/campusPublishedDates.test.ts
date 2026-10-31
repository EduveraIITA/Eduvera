import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/api';
import { cancelCampusDate, correctCampusDate, loadPublishedCampusDates, publishCampusDate, type PublishedCampusDate } from './campusPublishedDates';
vi.mock('../../lib/api', () => ({ apiFetch: vi.fn() }));
const item: PublishedCampusDate = { id: 'date-one', school_id: 'campus', title: 'Winter teaching break information', description: 'Services may continue.',
  starts_on: '2026-12-05', ends_on: '2027-01-03', category_label: 'Academic', academic_term_id: 'term-one', provenance: { fixture_key: 'reviewed-year' }, state: 'published', revision: 3 };
const fields = { title: item.title, description: item.description, starts_on: item.starts_on, ends_on: item.ends_on,
  category_label: item.category_label, academic_term_id: item.academic_term_id, provenance: item.provenance };
const page = (items: PublishedCampusDate[], number = 1, pages = 1) => ({ items, page: number, total_pages: pages, page_size: 100, total: items.length, can_manage: false });
afterEach(() => vi.resetAllMocks());
describe('source-owned public campus-date adapter', () => {
  it('retains inclusive cross-year dates, term identity and provenance without timezone conversion or operational effects', async () => {
    vi.mocked(apiFetch).mockResolvedValue(page([item]));
    const result = await loadPublishedCampusDates('campus', '2027-01-01', '2027-01-31');
    expect(result).toMatchObject({ canManage: false, partial: false, entries: [{ id: 'milestones:date-one', category: 'milestones', startsOn: '2026-12-05', endsOn: '2027-01-03', allDay: true, categoryLabel: 'Academic', publication: item }] });
    expect(result.entries[0]?.href).toBeUndefined();
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/schools/campus/campus-dates?from=2027-01-01&until=2027-01-31&page=1', expect.any(Object));
  });
  it('reads finite pages and retains cancelled current revisions', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(page([item], 1, 2)).mockResolvedValueOnce({ ...page([{ ...item, id: 'date-two', state: 'cancelled', cancellation_reason: 'Revised programme' }], 2, 2), can_manage: true });
    const result = await loadPublishedCampusDates('campus', '2026-12-01', '2026-12-31');
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(result.partial).toBe(false);
    expect(result.canManage).toBe(true);
    expect(result.entries[1]).toMatchObject({ status: 'Cancelled', publication: { cancellation_reason: 'Revised programme' } });
  });
  it('labels repeated or bounded pages incomplete and refuses malformed pagination', async () => {
    vi.mocked(apiFetch).mockImplementation(path => Promise.resolve(page([item], Number(new URL(path, 'https://campus.invalid').searchParams.get('page')), 11)));
    expect(await loadPublishedCampusDates('campus', '2026-12-01', '2026-12-31')).toMatchObject({ partial: true, entries: [{ sourceId: item.id }] });
    expect(apiFetch).toHaveBeenCalledTimes(10);
    vi.mocked(apiFetch).mockResolvedValue({ items: [] });
    await expect(loadPublishedCampusDates('campus', '2026-12-01', '2026-12-31')).rejects.toThrow('incomplete page');
  });
  it('uses only owning revisioned mutation endpoints and retains supplied keys and source relationships', async () => {
    vi.mocked(apiFetch).mockResolvedValue(item);
    await publishCampusDate('campus', fields, 'retained-publish-key');
    await correctCampusDate('campus', item, fields, 'Correct published date', 'retained-correct-key');
    await cancelCampusDate('campus', item, 'Programme cancelled', 'retained-cancel-key');
    const calls = vi.mocked(apiFetch).mock.calls;
    expect(calls.map(([path]) => path)).toEqual(['/api/v1/schools/campus/campus-dates', '/api/v1/schools/campus/campus-dates/date-one/correct', '/api/v1/schools/campus/campus-dates/date-one/cancel']);
    expect(JSON.parse(calls[1]![1]!.body as string)).toEqual({ ...fields, expected_revision: 3, reason: 'Correct published date', idempotency_key: 'retained-correct-key' });
    expect(JSON.parse(calls[2]![1]!.body as string)).toEqual({ expected_revision: 3, reason: 'Programme cancelled', idempotency_key: 'retained-cancel-key' });
  });
});
