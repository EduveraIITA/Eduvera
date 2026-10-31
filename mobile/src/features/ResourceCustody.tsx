import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { ResourceLoanDetail } from '../../../packages/contracts/src/wire/features/resources/resourceApi';
import { useSession } from '../auth/SessionProvider';
import { apiFetch } from '../lib/api';
import { useApi } from '../lib/query';
import { parseResourceCustodians, resourceCustodyBody } from '../lib/resource-operations';
import { useOperationContext } from '../lib/use-operation-context';
import { Alert } from '../ui/Alert';
import { ScreenBack, useScreenExitGuard } from '../ui/BackNavigation';
import { ChoiceMenu, ControlButton, Facts } from '../ui/DomainControls';
import { Empty, Field, Loading, Notice, SearchField, Section } from '../ui/components';
import { useTheme } from '../ui/theme';
import type { RecordedWrite } from './ResourcesScreen';

export function ResourceCustodyEditor({ root, loan, write, onClose }: { root: string; loan: ResourceLoanDetail; write: RecordedWrite; onClose(): void }) {
  const [selected, setSelected] = useState(''), [reason, setReason] = useState(''), [search, setSearch] = useState(''), [submitted, setSubmitted] = useState(''), [page, setPage] = useState(1), [revision, setRevision] = useState(loan.revision), [preparing, setPreparing] = useState(false), [error, setError] = useState('');
  const preparingRef = useRef(false), source = `${root}/loans/${encodeURIComponent(loan.id)}`, path = `${source}/custodians?${new URLSearchParams({ search: submitted, page: String(page) })}`;
  const capture = useOperationContext(source), cache = useQueryClient(), { scopeKey } = useSession(), { colors } = useTheme();
  const query = useApi<unknown>(path);
  let options: ReturnType<typeof parseResourceCustodians> | null = null, malformed = '';
  if (query.data && !query.error) { try { options = parseResourceCustodians(query.data, page); } catch (cause) { malformed = cause instanceof Error ? cause.message : 'Choices could not be checked.'; } }
  const changed = revision !== loan.revision, locked = write.locked || preparing || !loan.can_change_custodian || !!query.error || !!malformed;
  const clear = () => { setSelected(''); setReason(''); };
  useScreenExitGuard({ blocked: write.busy || preparing, dirty: !!selected || !!reason.trim(), title: 'Leave responsibility change?', message: 'The unsaved successor and reason will be discarded. Any retained exact save remains available for receipt recovery.', onLeave: clear });
  const cancel = () => { if (!selected && !reason.trim()) onClose(); else Alert.alert('Discard this change?', 'The unsaved successor and reason will be discarded.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => { clear(); onClose(); } }]); };
  const review = async () => { try { setError(''); const assertCurrent = capture(), latest = await apiFetch<ResourceLoanDetail>(source); assertCurrent(); if (latest.id !== loan.id || !latest.can_change_custodian) throw new Error('Your current responsibility no longer permits this change.'); await query.refetch({ throwOnError: true }); assertCurrent(); cache.setQueryData(['campus', scopeKey, source], latest); setRevision(latest.revision); } catch (cause) { setError(cause instanceof Error ? cause.message : 'The current source is unavailable.'); } };
  const save = async () => {
    if (locked || changed || preparingRef.current) return;
    preparingRef.current = true; setPreparing(true); setError('');
    try {
      const assertCurrent = capture(), latest = await apiFetch<ResourceLoanDetail>(source); assertCurrent();
      if (latest.id !== loan.id) throw new Error('The current loan identity changed.');
      const currentOptions = parseResourceCustodians(await apiFetch(path), page); assertCurrent(); cache.setQueryData(['campus', scopeKey, source], latest);
      const body = resourceCustodyBody(latest, currentOptions, { selectedId: selected, reason, revision });
      await write.run({ sourceId: loan.id, path: `${source}/responsibility`, body });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Responsibility could not be reviewed.'); }
    finally { preparingRef.current = false; setPreparing(false); }
  };
  return <Section title={loan.custody_recovery ? 'Restore loan responsibility' : 'Change responsibility'}>
    <ScreenBack title="Back to loan" priority={10} onPress={onClose} />
    <Facts items={[{ label: 'Item', value: loan.title }, { label: 'Current custodian', value: loan.custodian.label }]} />
    <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>{loan.custody_recovery ? 'The named custodian’s current access is unavailable. Select an eligible Resources operator to recover this exact responsibility.' : 'Select an eligible Resources operator to take over handling this loan.'} Physical returns, borrower, due date and accommodation obligations remain separate.</Text>
    <SearchField label="Find a custodian" placeholder="Name or contact" value={search} disabled={locked} onChangeText={setSearch} onSubmit={() => { setSubmitted(search.trim()); setPage(1); setSelected(''); }} onClear={() => { setSearch(''); setSubmitted(''); setPage(1); setSelected(''); }} />
    {query.isPending ? <Loading /> : query.error || malformed ? <Empty title="Custodians could not be loaded" message={query.error?.message || malformed} onRetry={() => void query.refetch()} /> : options ? <><ChoiceMenu label="New custodian" value={selected} options={[{ value: '', label: 'Choose a current custodian' }, ...options.people.map(person => ({ value: person.id, label: person.label }))]} disabled={locked} onChange={setSelected} />{!options.people.length ? <Notice message="No eligible custodian was found. Access must be restored or granted through its owning workflow before this responsibility can be assigned." /> : null}{page > 1 || page * options.pagination.page_size < options.pagination.total ? <View style={{ flexDirection: 'row', gap: 8 }}><ControlButton title="Previous" disabled={locked || page <= 1} onPress={() => { setPage(value => value - 1); setSelected(''); }} /><ControlButton title={`Next · page ${page}`} disabled={locked || page * options.pagination.page_size >= options.pagination.total} onPress={() => { setPage(value => value + 1); setSelected(''); }} /></View> : null}</> : null}
    <Field label="Reason" value={reason} onChangeText={setReason} multiline maxLength={1000} editable={!locked} />
    {changed ? <><Notice tone="warning" message="The loan changed. Your entries are kept; review the latest responsibility and record before saving." /><ControlButton title="Review current loan with these entries" disabled={write.busy || preparing} onPress={() => void review()} /></> : null}
    {!loan.can_change_custodian ? <Notice tone="warning" message="Your current responsibility does not allow this change." /> : null}
    {error ? <Notice tone="warning" message={error} /> : null}
    <ControlButton title="Save responsibility" kind="primary" busy={preparing || write.busy} disabled={locked || changed || !selected || reason.trim().length < 3 || !options} onPress={() => Alert.alert('Change this responsibility?', 'The selected person will handle the loan and its open questions. This records responsibility only; it does not prove a physical return.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Save responsibility', onPress: () => void save() }])} />
    <ControlButton title="Cancel change" disabled={write.busy || preparing} onPress={cancel} />
  </Section>;
}
