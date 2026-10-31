import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { CampusDateEditor, type CampusDateAction } from './CampusDateEditor';
import { cancelCampusDate, correctCampusDate, publishCampusDate, type PublishedCampusDate } from './campusPublishedDates';

vi.mock('./campusPublishedDates', () => ({ publishCampusDate: vi.fn(), correctCampusDate: vi.fn(), cancelCampusDate: vi.fn() }));
const record: PublishedCampusDate = { id: 'date-one', school_id: 'campus-one', title: 'Research festival', description: 'Poster sessions and demonstrations.',
  starts_on: '2026-10-28', ends_on: '2026-10-30', category_label: 'Academic', state: 'published', revision: 3,
  academic_term_id: 'term-one', provenance: { fixture_key: 'reviewed-fixture', source_note: 'Fictional campus plan.' } };
const current = { ...record, revision: 4 };
function mount({ action = 'publish', initial, canManage = true, refresh = vi.fn().mockResolvedValue(undefined) }: {
  action?: CampusDateAction; initial?: PublishedCampusDate; canManage?: boolean; refresh?: () => Promise<unknown>;
} = {}) {
  const onSaved = vi.fn(), onClose = vi.fn();
  render(<MemoryRouter><CampusDateEditor schoolId="campus-one" date="2026-10-28" action={action} record={initial} canManage={canManage} refresh={refresh} onSaved={onSaved} onClose={onClose} /></MemoryRouter>);
  return { onSaved, onClose, refresh };
}
const title = () => screen.getByRole('textbox', { name: 'Title' });
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
beforeEach(() => { vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.mocked(publishCampusDate).mockReset(); vi.mocked(correctCampusDate).mockReset(); vi.mocked(cancelCampusDate).mockReset(); });

describe('Source-owned informational campus dates', () => {
  it('requires server management eligibility and never publishes from a read-only context', () => {
    mount({ canManage: false });
    expect(title()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Publish date' })).toBeDisabled();
    fireEvent.submit(title().closest('form')!);
    expect(publishCampusDate).not.toHaveBeenCalled();
  });

  it('publishes date-only fields with a neutral default category, no invented period or provenance, and no optimistic success', async () => {
    let accept!: (value: PublishedCampusDate) => void;
    vi.mocked(publishCampusDate).mockReturnValue(new Promise(resolve => { accept = resolve; }));
    const { onSaved, refresh } = mount();
    expect(screen.getByText('Visible to campus members. This does not cancel teaching, book a room or create a payment/result.')).toBeVisible();
    await userEvent.type(title(), 'Research festival');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Publish date' }));
    expect(publishCampusDate).toHaveBeenCalledOnce();
    expect(publishCampusDate).toHaveBeenCalledWith('campus-one', { title: 'Research festival', description: '', starts_on: '2026-10-28', ends_on: '2026-10-28', category_label: 'Campus date', academic_term_id: null, provenance: null }, expect.any(String));
    expect(onSaved).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    accept(current);
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledExactlyOnceWith(current));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('corrects the exact source revision while preserving period linkage and provenance', async () => {
    vi.mocked(correctCampusDate).mockResolvedValue(current);
    const { onSaved } = mount({ action: 'correct', initial: record });
    await userEvent.clear(title()); await userEvent.type(title(), 'Research festival and project fair');
    await userEvent.type(screen.getByRole('textbox', { name: 'Correction reason' }), 'Include the project fair in the published title.');
    await userEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    expect(correctCampusDate).toHaveBeenCalledWith('campus-one', record, { title: 'Research festival and project fair', description: record.description,
      starts_on: record.starts_on, ends_on: record.ends_on, category_label: 'Academic', academic_term_id: record.academic_term_id, provenance: record.provenance },
    'Include the project fair in the published title.', expect.any(String));
    expect(record.revision).toBe(3);
    expect(publishCampusDate).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(current);
  });

  it('confirms cancellation with a required reason and does not offer a correction of an already cancelled source', async () => {
    vi.mocked(cancelCampusDate).mockResolvedValue({ ...current, state: 'cancelled' });
    mount({ action: 'cancel', initial: record });
    expect(screen.getByRole('dialog', { name: 'Cancel date' })).toHaveTextContent(record.title);
    expect(screen.getByText(/stays in the calendar marked Cancelled/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
    expect(cancelCampusDate).not.toHaveBeenCalled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Cancellation reason' }), 'The programme has been withdrawn.');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
    expect(cancelCampusDate).toHaveBeenCalledWith('campus-one', record, 'The programme has been withdrawn.', expect.any(String));
    expect(correctCampusDate).not.toHaveBeenCalled();
  });

  it('locks payload and closing after an ambiguous outcome, then reuses the exact request and key even after a later conflict', async () => {
    vi.mocked(publishCampusDate).mockRejectedValueOnce(new TypeError('Connection interrupted')).mockRejectedValueOnce(new ApiError('Revision changed', 409)).mockResolvedValueOnce(current);
    const { onClose, onSaved } = mount();
    await userEvent.type(title(), 'Research festival');
    await userEvent.click(screen.getByRole('button', { name: 'Publish date' }));
    const first = vi.mocked(publishCampusDate).mock.calls[0]!;
    expect(screen.getByRole('alert')).toHaveTextContent('The result is not confirmed');
    expect(title()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Retry same action' }));
    expect(vi.mocked(publishCampusDate).mock.calls[1]).toEqual(first);
    expect(title()).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Reload current date' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry same action' }));
    expect(vi.mocked(publishCampusDate).mock.calls[2]).toEqual(first);
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(current);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('distinguishes a confirmed save from a refresh failure and never sends the write again', async () => {
    vi.mocked(publishCampusDate).mockResolvedValue(current);
    const refresh = vi.fn().mockRejectedValueOnce(new Error('Read interrupted')).mockResolvedValue(undefined);
    const { onSaved } = mount({ refresh });
    await userEvent.type(title(), 'Research festival');
    await userEvent.click(screen.getByRole('button', { name: 'Publish date' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Saved. The updated calendar could not be loaded.');
    expect(onSaved).not.toHaveBeenCalled();
    for (const close of screen.getAllByRole('button', { name: 'Close', exact: true })) expect(close).not.toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh calendar' }));
    expect(publishCampusDate).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(current);
  });

  it('does not call a malformed or cross-campus response saved', async () => {
    vi.mocked(publishCampusDate).mockResolvedValue({ ...current, school_id: 'another-campus' });
    const { onSaved, refresh } = mount();
    await userEvent.type(title(), 'Research festival');
    await userEvent.click(screen.getByRole('button', { name: 'Publish date' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The result is not confirmed');
    expect(onSaved).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(title()).toBeDisabled();
  });

  it('treats a first explicit stale refusal as not saved and provides a current-source reload instead of an endless retry lock', async () => {
    vi.mocked(correctCampusDate).mockRejectedValue(new ApiError('The date changed. Review its current revision.', 409));
    const { onClose, onSaved, refresh } = mount({ action: 'correct', initial: record });
    await userEvent.type(screen.getByRole('textbox', { name: 'Correction reason' }), 'Correct the published dates.');
    await userEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    expect(screen.getByRole('button', { name: 'Close' })).not.toBeDisabled();
    expect(onSaved).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Reload current date' }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(correctCampusDate).toHaveBeenCalledOnce();
  });

  it('does not permit edits of a cancelled or foreign source', () => {
    mount({ action: 'correct', initial: { ...record, state: 'cancelled' } });
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeDisabled();
    cleanup();
    mount({ action: 'correct', initial: { ...record, school_id: 'another-campus' } });
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeDisabled();
    expect(correctCampusDate).not.toHaveBeenCalled();
  });
});
