import { useEffect, useRef, useState, type FormEvent } from 'react';
import { TemporalInput } from '../../components/forms/TemporalInput';
import { ApiError } from '../../lib/api';
import { useUnsavedChangesGuard } from '../navigation/useUnsavedChangesGuard';
import { PlannerDialog } from '../planner/PlannerLessonSheet';
import { cancelCampusDate, correctCampusDate, publishCampusDate, type CampusDateFields, type PublishedCampusDate } from './campusPublishedDates';

export type CampusDateAction = 'publish' | 'correct' | 'cancel';
interface Attempt { key: string; action: CampusDateAction; fields: CampusDateFields; record?: PublishedCampusDate; reason: string }
const boundary = 'Visible to campus members. This does not cancel teaching, book a room or create a payment/result.';
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01' && value <= '2200-12-31'
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

/** Publishes only informational campus dates, never facts owned by another source. */
export function CampusDateEditor({ schoolId, date, action = 'publish', record, canManage, refresh, onClose, onSaved }: {
  schoolId: string; date: string; action?: CampusDateAction; record?: PublishedCampusDate; canManage: boolean;
  refresh: () => Promise<unknown>; onClose: () => void; onSaved: (record: PublishedCampusDate) => void;
}) {
  const [title, setTitle] = useState(record?.title ?? ''), [description, setDescription] = useState(record?.description ?? '');
  const [start, setStart] = useState(record?.starts_on ?? date), [end, setEnd] = useState(record && record.ends_on !== record.starts_on ? record.ends_on : '');
  const [category, setCategory] = useState(record?.category_label ?? ''), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [recovery, setRecovery] = useState<'unknown' | 'saved' | null>(null), [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const active = useRef(true), pending = useRef(false), retained = useRef<Attempt | null>(null), accepted = useRef<PublishedCampusDate | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const eligible = canManage && (action === 'publish' || record?.school_id === schoolId && record.state === 'published');
  const locked = busy || Boolean(recovery);
  const dirty = title !== (record?.title ?? '') || description !== (record?.description ?? '') || start !== (record?.starts_on ?? date)
    || end !== (record && record.ends_on !== record.starts_on ? record.ends_on : '') || category !== (record?.category_label ?? '') || Boolean(reason);
  const guard = useUnsavedChangesGuard(busy || recovery === 'unknown' || dirty && recovery !== 'saved',
    recovery === 'unknown' ? 'This action is not confirmed. Stay here to retry the same action.' : 'Discard this unsent important date?');
  const close = () => { if (!pending.current && recovery !== 'unknown' && guard()) onClose(); };
  const perform = async () => {
    const attempt = retained.current;
    if (pending.current || !attempt || !active.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      if (!accepted.current) {
        const result = attempt.action === 'cancel' ? await cancelCampusDate(schoolId, attempt.record!, attempt.reason, attempt.key)
          : attempt.action === 'correct' ? await correctCampusDate(schoolId, attempt.record!, attempt.fields, attempt.reason, attempt.key)
            : await publishCampusDate(schoolId, attempt.fields, attempt.key);
        if (!result || typeof result.id !== 'string' || result.school_id !== schoolId || !Number.isInteger(result.revision)
          || result.revision < 1 || result.state !== (attempt.action === 'cancel' ? 'cancelled' : 'published')
          || attempt.record && result.id !== attempt.record.id) throw new Error('The publication result could not be confirmed.');
        accepted.current = result;
      }
      if (!active.current) return;
      setRecovery('saved');
      await refresh();
      if (active.current) onSaved(accepted.current);
    } catch (cause) {
      if (!active.current) return;
      if (accepted.current) { setRecovery('saved'); setError('Saved. The updated calendar could not be loaded. Refresh the calendar; do not publish again.'); }
      else {
        const unknown = recovery === 'unknown' || !(cause instanceof ApiError) || cause.status >= 500 || cause.status < 400;
        setRecovery(unknown ? 'unknown' : null);
        setError(unknown ? 'The result is not confirmed. Your details are locked. Retry the same action to check its result.' : cause.message);
        if (!unknown) { retained.current = null; setStale(cause instanceof ApiError && cause.status === 409); }
      }
    } finally { pending.current = false; if (active.current) setBusy(false); }
  };
  const reload = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await refresh(); if (active.current) onClose(); }
    catch { if (active.current) setError('The current date could not be loaded. Try reloading again before making a correction.'); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending.current || retained.current || !eligible || stale) return;
    const until = end || start;
    if (action !== 'cancel' && (title.trim().length < 2 || !validDate(start) || !validDate(until) || until < start || Date.parse(until) - Date.parse(start) > 366 * 86_400_000)) {
      setError('Add a title and an inclusive date range of up to 367 days.'); return;
    }
    if (action !== 'publish' && reason.trim().length < 3) { setError('Explain the reason for this change.'); return; }
    const fields: CampusDateFields = { title: title.trim(), description: description.trim(), starts_on: start, ends_on: until,
      category_label: category.trim() || 'Campus date', academic_term_id: record?.academic_term_id ?? null,
      provenance: record?.provenance ? { ...record.provenance } : null };
    retained.current = { key: crypto.randomUUID(), action, fields, record, reason: reason.trim() };
    void perform();
  };
  const heading = action === 'publish' ? 'Add important date' : action === 'correct' ? 'Correct date' : 'Cancel date';
  return <PlannerDialog title={heading} subtitle={action === 'cancel' ? record?.title : undefined} busy={busy || recovery === 'unknown'} onClose={close}>
    <form className="planner-lesson-form campus-date-form" onSubmit={submit} aria-busy={busy}>
      <p>{boundary}</p>
      {!eligible ? <p role="alert">Publishing access is no longer available. Open the current calendar before making a new change.</p> : null}
      <fieldset disabled={locked || !eligible || stale}>
        {action === 'cancel' ? <p>This date stays in the calendar marked Cancelled. Explain the cancellation before confirming.</p> : <>
          <label>Title<input autoFocus required minLength={2} maxLength={160} value={title} onChange={event => setTitle(event.target.value)} /></label>
          <div className="planner-form-pair"><label>Starts on<TemporalInput type="date" required min="1900-01-01" max="2200-12-31" value={start} onChange={event => setStart(event.target.value)} /></label>
            <label>Ends on (optional)<TemporalInput type="date" min={start} max="2200-12-31" value={end} onChange={event => setEnd(event.target.value)} /></label></div>
          <label>Description (optional)<textarea rows={3} maxLength={4000} value={description} onChange={event => setDescription(event.target.value)} /></label>
          <details><summary>Category{category ? ` · ${category}` : ' (optional)'}</summary><label>Category label<input minLength={2} maxLength={80} value={category} placeholder="Campus date" onChange={event => setCategory(event.target.value)} /></label></details>
        </>}
        {action !== 'publish' ? <label>{action === 'cancel' ? 'Cancellation reason' : 'Correction reason'}<textarea autoFocus={action === 'cancel'} required minLength={3} maxLength={1000} rows={2} value={reason} onChange={event => setReason(event.target.value)} /></label> : null}
      </fieldset>
      {error ? <p role="alert" className="planner-form-error">{error}</p> : null}
      <footer><button type="button" className="is-secondary" disabled={busy || recovery === 'unknown'} onClick={close}>{recovery === 'saved' ? 'Close' : 'Cancel'}</button>
        {recovery ? <button type="button" disabled={busy} onClick={() => void perform()}>{busy ? 'Checking…' : recovery === 'saved' ? 'Refresh calendar' : 'Retry same action'}</button>
          : stale ? <button type="button" disabled={busy} onClick={() => void reload()}>{busy ? 'Loading…' : 'Reload current date'}</button>
            : <button type="submit" disabled={busy || !eligible}>{busy ? 'Saving…' : action === 'publish' ? 'Publish date' : action === 'correct' ? 'Save correction' : 'Confirm cancellation'}</button>}</footer>
    </form>
  </PlannerDialog>;
}
