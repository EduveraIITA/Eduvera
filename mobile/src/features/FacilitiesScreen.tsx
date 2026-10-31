import { ScreenBack, useCampusNavigation, useScreenExitGuard } from '../ui/BackNavigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Linking, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import { pickPrivateFile, readPrivateFile, removePrivateFile } from '../lib/private-file';
import { PrivateFilePreview } from '../ui/PrivateFilePreview';
import { useQueryClient } from '@tanstack/react-query';
import type { FacilitiesOptions, FacilitiesPage, FacilitiesSettings, RepairAction, RepairDetail, RepairWait } from '../../../packages/contracts/src/wire/features/facilities/facilitiesApi';
import { useSession } from '../auth/SessionProvider';
import { useApi } from '../lib/query';
import { apiFetch, captureApiContext, downloadCampusFile, getApiOrigin } from '../lib/api';
import { useRecordedCommand } from '../lib/recorded-command';
import type { RecordedCommand } from '../lib/recorded-command';
import { facilitiesAssignmentBody, facilitiesOrdinaryReceipt, facilitiesPeople, facilitiesReportBody, type FacilitiesChoice } from '../lib/facilities-operations';
import { facilitiesReportContextKey, facilitiesReportContextWarning, facilitiesReportOptionsPath, facilitiesReportPrefill, facilitiesReportRequested, facilitiesReportTarget, type FacilitiesReportPrefill } from '../lib/facilities-report-context';
import { useOperationContext } from '../lib/use-operation-context';
import { useOperationClock } from '../lib/use-operation-clock';
import { FacilitiesExternalAccess } from './FacilitiesExternal';
import { useNativePendingAction, type NativePendingFile } from '../lib/native-pending-action';
import { createInitialRepairPhotoAttempt, facilitiesAcceptedReadPath, facilitiesActionObsolete, facilitiesCanAddPhoto, facilitiesConfirmationPath, facilitiesCurrentReadMatches, facilitiesPhotoFingerprint, facilitiesPhotoMetadata, facilitiesPhotoPath, facilitiesReceiptMatches, facilitiesSettingsBody, facilitiesSettingsFingerprint } from '../lib/facilities-native';
import { Button, Empty, Field, ListGroup, Loading, Notice, Page, Row, SearchField, Section } from '../ui/components';
import { ChoiceMenu, ControlButton, Disclosure, Facts, SegmentedControl } from '../ui/DomainControls';
import { CommandFeedback, DomainPages, DomainText, LabeledSwitch, NativeTimeField, domainDate, domainHref, domainParams, type DomainScreenProps, type RecordedWrite } from './ResourcesScreen';

const stateLabel: Record<string, string> = { reported: 'Reported', accepted: 'Accepted', in_progress: 'In progress', waiting: 'Waiting', awaiting_verification: 'Ready to check', closed: 'Closed' };
const clearReportContext = { report: undefined, holding_id: undefined, space_id: undefined };
type SelectedRepairPhoto = { file: NativePendingFile; repair: RepairDetail; requiresReview?: boolean };
export function FacilitiesScreen(props: DomainScreenProps) {
  const { schoolId, scopeKey } = useSession();
  return schoolId ? <FacilitiesWorkspace key={scopeKey} {...props} schoolId={schoolId} /> : <Page title="Repairs & maintenance"><Empty title="Choose a campus" /></Page>;
}
function FacilitiesWorkspace({ href, onNavigate, schoolId }: DomainScreenProps & { schoolId: string }) {
  const { scopeKey, user, environment } = useSession(), client = useQueryClient(), params = domainParams(href), focused = useIsFocused();
  const root = `/api/v1/schools/${encodeURIComponent(schoolId)}/facilities`, id = params.get('repair_id'), reporting = facilitiesReportRequested(params), configuring = params.get('action') === 'settings';
  const [photo, setPhoto] = useState<{ file: NativePendingFile; repair: RepairDetail | null; requiresReview?: boolean } | null>(null), [notice, setNotice] = useState(''), [photoError, setPhotoError] = useState(''), [preparing, setPreparing] = useState(false);
  const [completedHref, setCompletedHref] = useState(''), [lastAccepted, setLastAccepted] = useState<RecordedCommand | null>(null), [transferred, setTransferred] = useState('');
  const { complete } = useCampusNavigation(href);
  const selectedPhoto = useRef(photo), mounted = useRef(true), focus = useRef(focused), uploading = useRef(false), initialPhoto = useRef(createInitialRepairPhotoAttempt());
  selectedPhoto.current = photo; focus.current = focused;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => () => deleteRepairPhoto(photo?.file ?? null), [photo?.file.uri]);
  const change = (values: Record<string, string | undefined>) => onNavigate(domainHref('/areas/facilities', params, values));
  const ordinaryWrite = useRecordedCommand({ captureOperation: useOperationContext(JSON.stringify([href, root])), scopeKey, root, domain: 'facilities', onAccepted: async command => {
    const context = captureApiContext();
    if (!command.confirmationPath) throw new Error('The exact repair confirmation route is unavailable.');
    const proof = facilitiesOrdinaryReceipt(await apiFetch(command.confirmationPath), command); context.assertCurrent();
    if (command.path === `${root}/repairs`) {
      setNotice('Your report was saved.');
      if (selectedPhoto.current && !selectedPhoto.current.repair) initialPhoto.current.queue(command.key, command.sourceId);
    }
    if (proof.transferred) {
      setTransferred(command.sourceId); client.removeQueries({ queryKey: ['campus', scopeKey], predicate: query => typeof query.queryKey[2] === 'string' && query.queryKey[2].startsWith(`${root}/repairs/${command.sourceId}`) });
      const queue = await apiFetch<FacilitiesPage>(`${root}/workspace?view=mine&state=open&search=&page=1`); context.assertCurrent(); if (!Array.isArray(queue.repairs)) throw new Error('Responsibility was saved. The current repair queue could not refresh.');
      await client.invalidateQueries({ queryKey: ['campus', scopeKey], refetchType: 'none' }); context.assertCurrent(); setLastAccepted(command); setCompletedHref(domainHref('/areas/facilities', params, { ...clearReportContext, repair_id: undefined, action: undefined, history_page: undefined })); return;
    }
    const path = `${root}/repairs/${encodeURIComponent(command.sourceId)}`, current = await apiFetch<RepairDetail>(`${path}?history_page=${historyPage}`); context.assertCurrent();
    if (current.id !== command.sourceId || current.revision < proof.revision) throw new Error('The saved repair is not reflected in the current source yet.');
    await client.invalidateQueries({ queryKey: ['campus', scopeKey], refetchType: 'none' }); context.assertCurrent(); client.setQueryData(['campus', scopeKey, `${path}?history_page=${historyPage}`], current); setLastAccepted(command); if(proof.action!=='external_ready')setCompletedHref(domainHref('/areas/facilities', params, { ...clearReportContext, repair_id: command.sourceId, action: undefined }));
  } });
  const historyPage = Math.max(1, Number(params.get('history_page')) || 1);
  const detail = useApi<RepairDetail>(id && id !== transferred && !reporting && !configuring ? `${root}/repairs/${encodeURIComponent(id)}?history_page=${historyPage}` : null);
  const settings = useApi<FacilitiesSettings>(reporting || configuring ? `${root}/settings` : null);
  const privateWrite = useNativePendingAction<unknown>({captureOperation: useOperationContext(JSON.stringify([href, configuring || !id ? `${root}/settings` : `${root}/repairs/${encodeURIComponent(id)}`])),  scope: { actorId: user!.id, schoolId, mode: environment.mode, namespaceId: environment.namespace_id ?? null, origin: getApiOrigin() }, domain: 'facilities', ownerHref: href,
    refreshPath: configuring || !id ? `${root}/settings` : `${root}/repairs/${encodeURIComponent(id)}`, resolveRefreshPath: facilitiesAcceptedReadPath, obsolete: facilitiesActionObsolete,
    accepted: async (latest, assertActive, action) => {
      const context = captureApiContext(); assertActive();
      if (!facilitiesCurrentReadMatches(latest, action)) throw new Error('The current saved repair source could not be verified. Its action was kept.');
      const receipt = await apiFetch(facilitiesConfirmationPath(action)); context.assertCurrent(); assertActive();
      if (!facilitiesReceiptMatches(receipt, action)) throw new Error('The exact repair command receipt is not confirmed yet. Its saved request was kept.');
      client.setQueryData(['campus', scopeKey, action.refreshPath], latest);
      await client.invalidateQueries({ queryKey: ['campus', scopeKey], refetchType: 'none' }); context.assertCurrent(); assertActive();
      if (action.source?.kind === 'facilities_photo') {
        if (selectedPhoto.current?.file.hash === (action.payload.kind === 'multipart' ? action.payload.file.hash : '')) setPhoto(null);
        setNotice('The private repair photo was saved.');
        if (id === action.source.sourceId) { await detail.refetch(); context.assertCurrent(); assertActive(); }
      } else { setNotice('Repair setup saved. Existing repair responsibilities stay as recorded.'); await settings.refetch(); context.assertCurrent(); assertActive(); }
    } });
  const write = { ...ordinaryWrite, locked: ordinaryWrite.locked || privateWrite.locked || preparing,
    run: (input: Parameters<RecordedWrite['run']>[0]) => privateWrite.locked || preparing ? Promise.resolve() : ordinaryWrite.run(input) };
  const feedbackWrite = { ...ordinaryWrite, busy: ordinaryWrite.busy || privateWrite.busy || preparing,
    check: () => privateWrite.busy || preparing ? Promise.resolve() : ordinaryWrite.check(),
    retry: () => privateWrite.busy || preparing ? Promise.resolve() : ordinaryWrite.retry() };
  useEffect(() => { if (completedHref && !ordinaryWrite.busy && !ordinaryWrite.pending && !privateWrite.busy && !preparing) { setCompletedHref(''); complete(completedHref); } }, [completedHref, ordinaryWrite.busy, ordinaryWrite.pending, privateWrite.busy, preparing, complete]);
  useScreenExitGuard({ blocked: ordinaryWrite.busy || privateWrite.busy || preparing });
  const uploadPhoto = async (chosen: SelectedRepairPhoto) => {
    if (ordinaryWrite.locked || privateWrite.locked || uploading.current || !focused || chosen.requiresReview) return;
    const context = captureApiContext(); uploading.current = true; setPreparing(true); setPhotoError('');
    try {
      const current = await apiFetch<RepairDetail>(`${root}/repairs/${encodeURIComponent(chosen.repair.id)}`); context.assertCurrent();
      if (!mounted.current || !focus.current || AppState.currentState !== 'active') throw new Error('Return to the repair before uploading the selected photo.');
      if (!facilitiesCanAddPhoto(current) || facilitiesPhotoFingerprint(current) !== facilitiesPhotoFingerprint(chosen.repair)) throw new Error('This repair changed. Your photo is still selected. Review the current repair before uploading.');
      setPreparing(false);
      await privateWrite.run({ endpoint: `${root}/repairs/${encodeURIComponent(chosen.repair.id)}/photos`, multipart: { fields: { expected_revision: chosen.repair.revision }, file: chosen.file }, source: { kind: 'facilities_photo', sourceId: chosen.repair.id, revision: chosen.repair.revision, fingerprint: facilitiesPhotoFingerprint(chosen.repair) } }); context.assertCurrent();
    } catch (error) { try { context.assertCurrent(); if (mounted.current) setPhotoError(repairError(error)); } catch {} }
    finally { uploading.current = false; if (mounted.current) setPreparing(false); }
  };
  useEffect(() => {
    if (!photo || photo.repair || !detail.data || detail.isError || detail.data.id !== id || write.locked || !focused) return;
    const attempt = initialPhoto.current.claim(detail.data); if (!attempt) return;
    const selected = { file: photo.file, repair: detail.data, requiresReview: attempt !== 'upload' }; setPhoto(selected);
    if (attempt === 'blocked') { setPhotoError('Your report was saved. A photo cannot currently be added to this repair.'); return; }
    if (attempt === 'review') { setPhotoError('Your report was saved. This repair changed before the photo could upload. Review the current repair to continue.'); return; }
    void uploadPhoto(selected);
  }, [id, detail.data, detail.isError, photo, write.locked, focused]);
  return <Page title={configuring ? 'Repair setup' : reporting ? 'Report a problem' : id ? detail.data?.title ?? 'Repair' : 'Repairs & maintenance'} subtitle={configuring ? 'Choose who receives new reports and who checks completed work.' : reporting ? 'Tell the responsible person what needs attention.' : id ? 'Follow its owner, progress and the final check.' : 'Report a problem and follow the repair.'} refreshing={detail.isRefetching} onRefresh={id && !configuring ? () => { void detail.refetch(); } : undefined}>
    <CommandFeedback write={feedbackWrite} />
    <FacilitiesRetainedAction write={privateWrite} onNavigate={onNavigate} otherPending={ordinaryWrite.locked || preparing} onReview={async () => { const context = captureApiContext(); const result = configuring ? await settings.refetch() : await detail.refetch(); context.assertCurrent(); if (result.error) return; privateWrite.reviewed(); }} />
    {notice ? <Notice message={notice} tone="success" /> : null}{photoError ? <Notice message={photoError} tone="warning" /> : null}
    {reporting || configuring || id ? <ScreenBack title="Back to repairs" disabled={write.locked} fallbackHref={domainHref('/areas/facilities', params, { ...clearReportContext, repair_id: undefined, action: undefined, history_page: undefined })} /> : null}
    {configuring ? settings.isPending ? <Loading /> : settings.error || !settings.data ? <Empty title="Repair setup could not be loaded" message={settings.error?.message} onRetry={() => { void settings.refetch(); }} /> : <RepairSettings root={root} settings={settings.data} write={write} privateWrite={privateWrite} onBusy={setPreparing} onReview={async () => { const context = captureApiContext(); const result = await settings.refetch(); context.assertCurrent(); if (result.error || !result.data) throw result.error ?? new Error('Repair setup could not be refreshed.'); return result.data; }} />
      : reporting ? settings.isPending ? <Loading /> : settings.error || !settings.data ? <Empty title="The reporting route could not be loaded" message={settings.error?.message} onRetry={() => { void settings.refetch(); }} /> : <ReportRepairContext key={facilitiesReportContextKey(scopeKey, params)} href={href} root={root} settings={settings.data} write={write} photo={photo?.repair ? null : photo?.file ?? null} onPhoto={file => setPhoto(file ? { file, repair: null } : null)} />
      : id ? id === transferred ? <Notice message="Responsibility was transferred. Current access controls private repair details; the retained exact receipt remains available if the queue could not refresh." /> : detail.isPending ? <Loading /> : detail.error || !detail.data || detail.data.id !== id ? <Empty title="This repair could not be loaded" message={detail.error?.message ?? 'The server must confirm this exact repair.'} onRetry={() => { void detail.refetch(); }} />
          : <RepairContent key={id} root={root} repair={detail.data} write={write} lastAccepted={lastAccepted} href={href} onNavigate={onNavigate} historyPage={historyPage} onHistoryPage={page => change({ history_page: String(page) })} photos={<RepairPhotos schoolId={schoolId} repair={detail.data} disabled={write.locked} selected={photo?.repair?.id === id ? { file: photo.file, repair: photo.repair, requiresReview: photo.requiresReview } : null} onSelected={setPhoto} onUpload={uploadPhoto} onReview={async () => { const context = captureApiContext(); const result = await detail.refetch(); context.assertCurrent(); if (result.error || !result.data) throw result.error ?? new Error('The repair could not be refreshed.'); return result.data; }} />} />
        : <RepairsList root={root} params={params} change={change} write={write} />}
  </Page>;
}
const repairError = (error: unknown) => error instanceof Error ? error.message : 'This repair action could not be confirmed.';
type FacilitiesPrivateWrite = ReturnType<typeof useNativePendingAction<unknown>>;
function deleteRepairPhoto(file: NativePendingFile | null) { if (file) void removePrivateFile(file.uri).catch(() => {}); }
async function prepareRepairPhoto(uri: string, name: string, type: string) {
  const context = captureApiContext();
  let normalized = uri;
  try {
    const file = await readPrivateFile(uri, 5 * 1024 * 1024); normalized = file.uri;
    const size = file.size, bytes = file.bytes; context.assertCurrent();
    const metadata = facilitiesPhotoMetadata(name, type, size, bytes);
    const hash = Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)), value => value.toString(16).padStart(2, '0')).join(''); context.assertCurrent();
    return { uri: file.uri, ...metadata, hash } satisfies NativePendingFile;
  } catch (error) { await removePrivateFile(normalized).catch(() => {}); throw error; }
}
function FacilitiesRetainedAction({ write, onNavigate, otherPending, onReview }: { write: FacilitiesPrivateWrite; onNavigate: DomainScreenProps['onNavigate']; otherPending: boolean; onReview: () => Promise<void> }) {
  const [error, setError] = useState('');
  const review = async () => { const context = captureApiContext(); setError(''); try { await onReview(); context.assertCurrent(); } catch (cause) { try { context.assertCurrent(); setError(repairError(cause)); } catch {} } };
  return <>{!write.ready ? <Loading /> : null}{write.error ? <Notice tone="warning" message={write.error} /> : null}{error ? <Notice tone="warning" message={error} /> : null}
    {write.resumeHref ? <Button title="Return to retained repair action" kind="secondary" disabled={otherPending || write.busy} onPress={() => onNavigate(write.resumeHref!)} /> : write.action ? <>
      {write.action.payload.kind === 'multipart' ? <Row title={write.action.payload.file.name} detail={`${Math.ceil(write.action.payload.file.size / 1024)} KB · original private repair photo retained`} /> : <Row title="Original repair setup choices retained" detail="Recovery uses the setup choices saved with this request." />}
      <Notice tone="warning" message={write.action.phase === 'accepted' ? 'This action was saved. Refresh checks its exact receipt and current record without sending it again.' : 'The result is unconfirmed. Retry uses the original command, reviewed revision and exact photo bytes. New repair actions remain blocked.'} />
      <Button title={write.action.phase === 'accepted' ? 'Refresh saved repair action' : 'Retry identical repair action'} disabled={otherPending} busy={write.busy} onPress={() => { void write.recover(); }} />
    </> : write.obsolete ? <Button title="Review current saved record" kind="secondary" disabled={otherPending} onPress={() => void review()} /> : null}
  </>;
}
function RepairSettings({ root, settings, write, privateWrite, onReview, onBusy }: { root: string; settings: FacilitiesSettings; write: RecordedWrite; privateWrite: FacilitiesPrivateWrite; onReview: () => Promise<FacilitiesSettings>; onBusy: (busy: boolean) => void }) {
  const { schoolId } = useSession(), focused = useIsFocused(), active = useRef(focused), [reviewed, setReviewed] = useState(settings), [handler, setHandler] = useState(settings.handler ?? null), [verifier, setVerifier] = useState(settings.verifier ?? null);
  active.current = focused;
  useEffect(() => { active.current = focused; return () => { active.current = false; }; }, [focused]);
  const [mode, setMode] = useState(settings.verifier_mode), [contact, setContact] = useState(settings.emergency_contact), [choosing, setChoosing] = useState<'handler' | 'verifier' | null>(null), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const changed = facilitiesSettingsFingerprint(settings) !== facilitiesSettingsFingerprint(reviewed), locked = write.locked || saving;
  const review = async () => { const context = captureApiContext(); setError(''); setSaving(true); onBusy(true); try { const latest = await onReview(); context.assertCurrent(); if (!latest.can_manage) throw new Error('You no longer have permission to change repair setup.'); setReviewed(latest); } catch (cause) { try { context.assertCurrent(); setError(repairError(cause)); } catch {} } finally { setSaving(false); onBusy(false); } };
  const save = async () => {
    if (locked || changed || !settings.can_manage) return;
    const context = captureApiContext(); setError(''); setSaving(true); onBusy(true);
    try {
      const body = facilitiesSettingsBody(reviewed, { handler_person_id: handler?.id ?? null, verifier_mode: mode, verifier_person_id: verifier?.id ?? null, emergency_contact: contact });
      const current = await apiFetch<FacilitiesSettings>(`${root}/settings`); context.assertCurrent();
      if (!active.current || AppState.currentState !== 'active') throw new Error('Return to repair setup before saving these choices.');
      if (facilitiesSettingsFingerprint(current) !== facilitiesSettingsFingerprint(reviewed)) throw new Error('Repair setup changed. Your choices are kept. Review the current setup before saving.');
      await privateWrite.run({ endpoint: `${root}/settings`, body, serverKey: 'command_id', source: { kind: 'facilities_settings', sourceId: schoolId!, revision: reviewed.revision, fingerprint: facilitiesSettingsFingerprint(reviewed) } }); context.assertCurrent();
    } catch (cause) { try { context.assertCurrent(); setError(repairError(cause)); } catch {} } finally { setSaving(false); onBusy(false); }
  };
  if (!settings.can_manage) return <Empty title="Repair setup is managed by the campus" message="Your current access does not allow changes to the reporting route." />;
  return <>
    <Notice message="These choices apply to new reports. Each existing repair keeps its named responsibilities." />
    {changed ? <Notice tone="warning" message="The saved setup changed while you were choosing. Your choices are kept. Review the current saved setup before saving." /> : null}
    <Row title="Current saved setup" detail={`Receives reports · ${settings.handler?.label ?? 'Not configured'}\nChecks work · ${settings.verifier_mode === 'reporter' ? 'The reporter' : settings.verifier_mode === 'handler' ? 'The handler' : settings.verifier?.label ?? 'Named person'}${settings.emergency_contact ? `\nEmergency contact · ${settings.emergency_contact}` : ''}`} />
    <Button title="Review current setup · keep my choices" kind="secondary" disabled={locked} onPress={() => void review()} />
    <Section title="Who receives new repair reports?"><Button title={handler?.label ?? 'Choose a handler'} kind="secondary" disabled={locked} onPress={() => setChoosing('handler')} /></Section>
    <Section title="Who checks completed work?"><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{([['reporter', 'The reporter'], ['handler', 'The handler'], ['named', 'A named person']] as const).map(([value, label]) => <Button key={value} title={label} kind={mode === value ? 'primary' : 'secondary'} disabled={locked} onPress={() => setMode(value)} />)}</View>
      {mode === 'named' ? <Button title={verifier?.label ?? 'Choose a verifier'} kind="secondary" disabled={locked} onPress={() => setChoosing('verifier')} /> : null}
    </Section>
    {choosing ? <FacilitiesChoices root={root} kind="people" appAccessOnly write={write} onSelected={person => { if (choosing === 'handler') setHandler(person); else setVerifier(person); setChoosing(null); }} onClose={() => setChoosing(null)} /> : null}
    <Field label="Emergency contact · optional" value={contact} onChangeText={setContact} editable={!locked} maxLength={300} placeholder="Campus security number or instructions" />
    {error ? <Notice tone="warning" message={error} /> : null}
    <Button title={settings.configured ? 'Save repair setup' : 'Start handling repair reports'} busy={saving || privateWrite.busy} disabled={locked || changed || !handler || mode === 'named' && !verifier} onPress={() => void save()} />
  </>;
}
function RepairPhotoChooser({ file, disabled, onSelected, onBusy }: { file: NativePendingFile | null; disabled: boolean; onSelected: (file: NativePendingFile | null) => void; onBusy?: (busy: boolean) => void }) {
  const focused = useIsFocused(), focus = useRef(focused), [permission, requestPermission] = useCameraPermissions(), camera = useRef<CameraView>(null), alive = useRef(true), cameraActive = useRef(false), picking = useRef(false), selectedCallback = useRef(onSelected);
  focus.current = focused;
  const [showCamera, setShowCamera] = useState(false), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const closeCamera = () => { cameraActive.current = false; setShowCamera(false); setReady(false); };
  useEffect(() => { alive.current = true; return () => { alive.current = false; cameraActive.current = false; }; }, []);
  useEffect(() => { onBusy?.(busy || showCamera); return () => onBusy?.(false); }, [busy, showCamera, onBusy]);
  useEffect(() => { if (!focused || disabled) closeCamera(); }, [focused, disabled]);
  useEffect(() => { const listener = AppState.addEventListener('change', state => { if (state !== 'active') closeCamera(); }); return () => listener.remove(); }, []);
  const choose = async () => {
    if (disabled || picking.current || !focused) return;
    const context = captureApiContext(), selected = onSelected; picking.current = true; setBusy(true); setError(''); closeCamera();
    let resultFile: NativePendingFile | null = null;
    try {
      const asset = await pickPrivateFile(['image/jpeg', 'image/png'], 5 * 1024 * 1024);
      if (!asset) { context.assertCurrent(); return; }
      try { context.assertCurrent(); } catch (cause) { await removePrivateFile(asset.uri).catch(() => {}); throw cause; }
      resultFile = await prepareRepairPhoto(asset.uri, asset.name, asset.type); context.assertCurrent();
      if (!alive.current || !focus.current) { deleteRepairPhoto(resultFile); return; }
      selected(resultFile); resultFile = null;
    } catch (cause) { deleteRepairPhoto(resultFile); try { context.assertCurrent(); if (alive.current) setError(repairError(cause)); } catch {} }
    finally { picking.current = false; if (alive.current) setBusy(false); }
  };
  const openCamera = async () => {
    if (disabled || picking.current || !focused) return;
    const context = captureApiContext(); selectedCallback.current = onSelected; picking.current = true; setBusy(true); setError('');
    try { const current = permission?.granted ? permission : await requestPermission(); context.assertCurrent(); if (!alive.current || !focus.current) return; if (!current.granted) { setError(current.canAskAgain ? 'Camera access is needed to take a repair photo. You can also choose a file.' : 'Camera access is disabled. Enable it in system settings or choose a file.'); return; } if (AppState.currentState === 'active') { cameraActive.current = true; setReady(false); setShowCamera(true); } }
    catch (cause) { try { context.assertCurrent(); if (alive.current) setError(repairError(cause)); } catch {} }
    finally { picking.current = false; if (alive.current) setBusy(false); }
  };
  const takePhoto = async () => {
    if (!ready || disabled || picking.current || !camera.current || !cameraActive.current || !focused) return;
    const context = captureApiContext(); picking.current = true; setBusy(true); setError(''); let capturedUri = '', resultFile: NativePendingFile | null = null;
    try {
      const result = await camera.current.takePictureAsync({ quality: 0.8, base64: false, exif: false }); capturedUri = result.uri; context.assertCurrent();
      resultFile = await prepareRepairPhoto(result.uri, 'repair-photo.jpg', 'image/jpeg'); context.assertCurrent();
      if (!alive.current || !cameraActive.current || AppState.currentState !== 'active') { deleteRepairPhoto(resultFile); return; }
      selectedCallback.current(resultFile); resultFile = null; capturedUri = ''; closeCamera();
    } catch (cause) { if (capturedUri) { await removePrivateFile(capturedUri).catch(() => {}) } deleteRepairPhoto(resultFile); try { context.assertCurrent(); if (alive.current) setError(repairError(cause)); } catch {} }
    finally { picking.current = false; if (alive.current) setBusy(false); }
  };
  return <>
    <DomainText>Private JPEG or PNG · up to 5 MiB. Check that the photo contains only what this repair needs.</DomainText>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button title={file ? 'Replace from Files' : 'Choose photo from Files'} kind="secondary" disabled={disabled || busy} onPress={() => void choose()} /><Button title="Take a photo" kind="secondary" disabled={disabled || busy} onPress={() => void openCamera()} /></View>
    {showCamera && focused && permission?.granted ? <><View style={{ height: 320, borderRadius: 24, overflow: 'hidden' }}><CameraView ref={camera} facing="back" style={{ flex: 1 }} onCameraReady={() => setReady(true)} onMountError={event => { setError(event.message); closeCamera(); }} accessibilityLabel="Repair photo camera" /></View><Button title="Capture repair photo" disabled={disabled || !ready} busy={busy} onPress={() => void takePhoto()} /><Button title="Close camera" kind="secondary" disabled={busy} onPress={closeCamera} /></> : null}
    {file ? <><PrivateFilePreview uri={file.uri} label="Selected repair photo preview" /><Row title={file.name} detail={`${Math.ceil(file.size / 1024)} KB · selected on this device`} /><Button title="Remove selected photo" kind="secondary" disabled={disabled || busy} onPress={() => onSelected(null)} /></> : null}
    {busy && !showCamera ? <Loading /> : null}{error ? <Notice tone="warning" message={error} /> : null}
    {permission && !permission.granted && !permission.canAskAgain ? <Button title="Open camera permission settings" kind="secondary" disabled={disabled || busy} onPress={() => { void Linking.openSettings().catch(cause => setError(repairError(cause))); }} /> : null}
  </>;
}
function RepairPhotos({ schoolId, repair, disabled, selected, onSelected, onUpload, onReview }: { schoolId: string; repair: RepairDetail; disabled: boolean; selected: SelectedRepairPhoto | null; onSelected: (value: SelectedRepairPhoto | null) => void; onUpload: (value: SelectedRepairPhoto) => Promise<void>; onReview: () => Promise<RepairDetail> }) {
  const [opening, setOpening] = useState(''), [reviewing, setReviewing] = useState(false), [choosing, setChoosing] = useState(false), [error, setError] = useState(''), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const changed = !!selected && (selected.requiresReview || facilitiesPhotoFingerprint(selected.repair) !== facilitiesPhotoFingerprint(repair)), canAdd = facilitiesCanAddPhoto(repair), locked = disabled || !!opening || reviewing || choosing;
  const open = async (photo: RepairDetail['photos'][number]) => { if (opening) return; const context = captureApiContext(); setOpening(photo.id); setError(''); try { await downloadCampusFile(facilitiesPhotoPath(schoolId, repair, photo), photo.file_name); context.assertCurrent(); } catch (cause) { try { context.assertCurrent(); if (alive.current) setError(repairError(cause)); } catch {} } finally { if (alive.current) setOpening(''); } };
  const review = async () => { if (!selected) return; const context = captureApiContext(); setReviewing(true); setError(''); try { const current = await onReview(); context.assertCurrent(); if (!facilitiesCanAddPhoto(current) || current.id !== selected.repair.id) throw new Error('A photo cannot currently be added to this repair.'); if (alive.current) onSelected({ file: selected.file, repair: current }); } catch (cause) { try { context.assertCurrent(); if (alive.current) setError(repairError(cause)); } catch {} } finally { if (alive.current) setReviewing(false); } };
  if (repair.recovery_only || repair.access_transferred) return null;
  return <Section title="Private repair photos">
    {repair.external_view ? <DomainText>Only photos shared for your current repair assignment and your own uploaded photos appear here.</DomainText> : null}
    {repair.photos.map(photo => <View key={photo.id}><Row title={photo.file_name} detail={`${Math.ceil(photo.size / 1024)} KB · ${domainDate(photo.created_at)}`} /><Button title={`Open / share ${photo.file_name}`} kind="secondary" busy={opening === photo.id} disabled={!!opening} onPress={() => void open(photo)} /></View>)}
    {!repair.photos.length ? <DomainText>No photos have been added.</DomainText> : null}
    {canAdd ? <><RepairPhotoChooser file={selected?.file ?? null} disabled={disabled || !!opening || reviewing} onBusy={setChoosing} onSelected={file => onSelected(file ? { file, repair } : null)} />
      {changed ? <Notice tone="warning" message="This repair changed after you selected the photo. Review its current responsibility and progress before uploading." /> : null}
      {selected ? <><Button title="Review current repair · keep selected photo" kind="secondary" disabled={locked} onPress={() => void review()} /><Button title="Upload private repair photo" disabled={locked || changed} onPress={() => { void onUpload(selected); }} /></> : null}
    </> : selected ? <Notice tone="warning" message="Your selected photo has not been uploaded. The repair no longer allows adding photos." /> : repair.photos.length >= 20 ? <DomainText>This repair has reached its limit of 20 photos.</DomainText> : null}
    {error ? <Notice tone="warning" message={error} /> : null}
  </Section>;
}
function RepairsList({ root, params, change, write }: { root: string; params: URLSearchParams; change: (values: Record<string, string | undefined>) => void; write: RecordedWrite }) {
  const view = params.get('view') === 'all' ? 'all' : 'mine', state = ['closed', 'all'].includes(params.get('state') ?? '') ? params.get('state')! : 'open';
  const search = params.get('search') ?? '', page = Math.max(1, Number(params.get('page')) || 1), [draft, setDraft] = useState(search);
  const query = useApi<FacilitiesPage>(`${root}/workspace?${new URLSearchParams({ view, state, search, page: String(page) })}`);
  if (query.isPending) return <Loading />;
  if (query.error || !query.data) return <Empty title="Repairs could not be loaded" message={query.error?.message} onRetry={() => { void query.refetch(); }} />;
  const data = query.data;
  return <>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <View style={{ flex: 1, minWidth: 160 }}><DomainText>{data.totals.open} open{data.totals.awaiting_verification ? ` · ${data.totals.awaiting_verification} ready to check` : ''}</DomainText></View>
      {data.can_report ? <ControlButton title="Report problem" kind="primary" disabled={write.locked} onPress={() => change({ action: 'report' })} /> : null}
    </View>
    {data.can_manage ? <SegmentedControl label="Repair views" value={data.view} options={[{ value: 'mine', label: 'My repairs' }, { value: 'all', label: 'All repairs' }]} onChange={value => change({ view: value, page: undefined })} /> : null}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <View style={{ flex: 1, minWidth: 180 }}><SearchField label="Find a repair" placeholder="Problem, place or person" value={draft} onChangeText={setDraft} onSubmit={() => change({ search: draft.trim(), page: undefined })} onClear={() => { setDraft(''); change({ search: undefined, page: undefined }); }} /></View>
      <ChoiceMenu label="Repair status" value={state} options={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }, { value: 'all', label: 'All' }]} onChange={value => change({ state: value, page: undefined })} />
    </View>
    {data.repairs.length ? <ListGroup><View style={{ paddingHorizontal: 16 }}>{data.repairs.map((repair, index) => <Row key={repair.id} variant="plain" separator={index > 0} title={repair.title} detail={`${repair.place?.label ?? repair.item?.label ?? repair.location_note}\nResponsible · ${repair.handler.label}`} status={stateLabel[repair.state] ?? repair.state} icon="facilities" onPress={() => change({ repair_id: repair.id })} />)}</View></ListGroup> : <Empty title={search ? 'No matching repairs' : 'No repairs in this view'} message="Reports and their progress will appear here." />}
    <DomainPages page={data.pagination.page} hasMore={data.pagination.page * data.pagination.page_size < data.pagination.total} onChange={page => change({ page: String(page) })} />
    {data.can_manage && data.settings.can_manage ? <Disclosure title="Repair settings" defaultOpen={!data.settings.configured}><ControlButton title={data.settings.configured ? 'Repair setup' : 'Start handling repair reports'} kind="secondary" disabled={write.locked} onPress={() => change({ action: 'settings', repair_id: undefined })} /></Disclosure> : null}
  </>;
}
type ReportRepairProps = { root: string; settings: FacilitiesSettings; write: RecordedWrite; photo: NativePendingFile | null; onPhoto: (file: NativePendingFile | null) => void };
function ReportRepairContext({ href, ...props }: ReportRepairProps & { href: string }) {
  const target = facilitiesReportTarget(domainParams(href));
  const query = useApi<FacilitiesOptions>(facilitiesReportOptionsPath(props.root, target), { staleTime: 0, refetchInterval: false });
  if (target.kind === 'requested' && query.isPending) return <Loading />;
  const prefill = target.kind === 'requested' && !query.error ? facilitiesReportPrefill(target, query.data) : null;
  return <ReportRepair {...props} href={href} prefill={prefill} contextWarning={target.kind !== 'none' && !prefill ? facilitiesReportContextWarning : ''} />;
}
function ReportRepair({ root, settings, write, photo, onPhoto, href, prefill: resolvedPrefill, contextWarning: resolvedWarning }: ReportRepairProps & { href: string; prefill: FacilitiesReportPrefill | null; contextWarning: string }) {
  // A later background read must not replace someone's editable report draft.
  const [{ prefill, contextWarning }] = useState(() => ({ prefill: resolvedPrefill, contextWarning: resolvedWarning }));
  const [location, setLocation] = useState(''), [problem, setProblem] = useState(''), [urgent, setUrgent] = useState(false);
  const [choosingPhoto, setChoosingPhoto] = useState(false);
  const [choose, setChoose] = useState<'places' | 'holdings' | 'people' | null>(null), [selected, setSelected] = useState<({ kind: 'places' | 'holdings' } & FacilitiesChoice) | null>(() => prefill?.holding ? { ...prefill.holding, kind: 'holdings' } : prefill?.place ? { ...prefill.place, kind: 'places' } : null), [linkedPlace, setLinkedPlace] = useState<FacilitiesChoice | null>(() => prefill?.holding ? prefill.place : null), [reporter, setReporter] = useState<FacilitiesChoice | null>(null), [sending, setSending] = useState(false);
  const [impact, setImpact] = useState<'not_working' | 'degraded' | null>(null), [error, setError] = useState('');
  const capture = useOperationContext(JSON.stringify([root, href])), pending = useRef(false), cache = useQueryClient(), { scopeKey } = useSession();
  const selectionChanged = selected?.id !== (prefill?.holding?.id ?? prefill?.place?.id) || linkedPlace?.id !== (prefill?.holding ? prefill.place?.id : undefined);
  useScreenExitGuard({ dirty: !choose && !write.pending && (!!location.trim() || !!problem.trim() || selectionChanged || !!reporter || urgent || !!photo || !!impact), blocked: write.busy || choosingPhoto || sending, title: 'Leave this report?', message: 'Your unsaved problem description and selected photo will be lost.', onLeave: () => { setLocation(''); setProblem(''); setSelected(null); setLinkedPlace(null); setReporter(null); setUrgent(false); onPhoto(null); } });
  const send = async () => {
    if (write.locked || choosingPhoto || !settings.configured || pending.current) return;
    pending.current = true; setSending(true); setError('');
    try { const assertCurrent = capture(), current = await apiFetch<FacilitiesSettings>(`${root}/settings`); assertCurrent(); cache.setQueryData(['campus', scopeKey, `${root}/settings`], current); if (facilitiesSettingsFingerprint(current) !== facilitiesSettingsFingerprint(settings)) throw new Error('The reporting route changed. Your entries are kept; review the current recipient before sending.'); const body = facilitiesReportBody(current, { problem, location, urgent, selected, place: linkedPlace, reporter, impact: selected?.mapStatus ? impact : null }); await write.run({ path: `${root}/repairs`, body }); }
    catch (cause) { setError(repairError(cause)); } finally { pending.current = false; setSending(false); }
  };
  return <>
    {!settings.configured ? <Notice tone="warning" message="The campus needs to choose who receives repair reports before a report can be sent." /> : null}
    {contextWarning ? <Notice tone="warning" message={contextWarning} /> : null}
    {settings.handler?.label ? <Notice message={`Reports go to ${settings.handler.label}.`} /> : null}
    <Field label="Where?" value={location} onChangeText={setLocation} editable={!write.locked} placeholder="Building, room or nearby landmark" maxLength={300} />
    {selected ? <Row title={selected.label} detail={linkedPlace?.label} status="Linked to this report" /> : null}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button title="Choose a place" kind="secondary" disabled={write.locked} onPress={() => setChoose('places')} /><Button title="Link an item" kind="secondary" disabled={write.locked} onPress={() => setChoose('holdings')} />{selected ? <Button title="Clear selection" kind="secondary" disabled={write.locked} onPress={() => { setSelected(null); setLinkedPlace(null); setImpact(null); }} /> : null}</View>
    {choose ? <FacilitiesChoices root={root} kind={choose} write={write} onSelected={item => { if (choose === 'people') setReporter(item); else { setSelected({ ...item, kind: choose }); setLinkedPlace(null); setImpact(null); } setChoose(null); }} onClose={() => setChoose(null)} /> : null}
    {selected?.mapStatus ? <Section title="Shared asset status"><DomainText>Only this status is shared on the campus map; your description stays private.</DomainText><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{[[null, 'No shared status'], ['not_working', 'Not working'], ['degraded', 'Reduced service']].map(([value, label]) => <Button key={String(value)} title={label!} kind={impact === value ? 'primary' : 'secondary'} disabled={write.locked} onPress={() => setImpact(value as typeof impact)} />)}</View></Section> : null}
    <Field label="What’s wrong?" value={problem} onChangeText={setProblem} editable={!write.locked} placeholder="Tell us what needs attention" multiline maxLength={2000} />
    <Section title="Photo · optional"><RepairPhotoChooser file={photo} disabled={write.locked} onBusy={setChoosingPhoto} onSelected={onPhoto} /><DomainText>The report is saved first. Your selected photo is then uploaded privately; its result appears separately.</DomainText></Section>
    <LabeledSwitch label="Urgent safety concern" value={urgent} onChange={setUrgent} disabled={write.locked} />
    {urgent ? <Notice tone="danger" message={`For immediate danger, contact ${settings.emergency_contact || 'campus security or local emergency services'} now. A report does not guarantee an immediate response.`} /> : null}
    {settings.can_manage ? <Disclosure title="Recording for someone else"><ControlButton title={reporter?.label ?? 'Choose the person reporting'} disabled={write.locked || sending} onPress={() => setChoose('people')} />{reporter ? <ControlButton title="Report as myself instead" disabled={write.locked || sending} onPress={() => setReporter(null)} /> : null}<DomainText>The affected reporter stays separate from your authenticated recorder identity.</DomainText></Disclosure> : reporter ? <Notice tone="warning" message="Assisted reporting access changed. Review the current reporting route before saving." /> : null}
    <DomainText>Submitting a report does not grant permission to enter a room. Arrange access with the handler.</DomainText>
    {error ? <Notice message={error} tone="danger" /> : null}
    <Button title="Send report" busy={write.busy || sending} disabled={write.locked || choosingPhoto || sending || !settings.configured || problem.trim().length < 3 || !selected && location.trim().length < 3} onPress={() => void send()} />
  </>;
}
function FacilitiesChoices({ root, kind, repairId, appAccessOnly = false, write, onSelected, onClose }: { root: string; kind: 'places' | 'holdings' | 'people'; repairId?: string; appAccessOnly?: boolean; write: RecordedWrite; onSelected: (item: FacilitiesChoice) => void; onClose: () => void }) {
  const [search, setSearch] = useState(''), [submitted, setSubmitted] = useState(''), [page, setPage] = useState(1);
  const query = useApi<FacilitiesOptions>(`${root}/options?${new URLSearchParams({ search: submitted, page: String(page), ...(repairId ? { repair_id: repairId } : {}) })}`);
  let malformed = '', people: ReturnType<typeof facilitiesPeople> = [];
  if (kind === 'people' && query.data) { try { people = facilitiesPeople(query.data); } catch (cause) { malformed = repairError(cause); } }
  const choices = (kind === 'people' ? people : query.data?.[kind] ?? []).filter(item => !appAccessOnly || 'has_app_access' in item && item.has_app_access === true);
  return <Section title={kind === 'places' ? 'Choose a place' : kind === 'holdings' ? 'Choose an item' : 'Choose a responsible person'}>
    <Field label="Search choices" value={search} onChangeText={setSearch} editable={!write.locked} maxLength={80} onSubmitEditing={() => { setSubmitted(search.trim()); setPage(1); }} returnKeyType="search" />
    <Button title="Search" kind="secondary" disabled={write.locked} onPress={() => { setSubmitted(search.trim()); setPage(1); }} />
    <ScreenBack title="Back to repair" priority={20} onPress={onClose} />
    {query.isPending ? <Loading /> : query.error || !query.data || malformed ? <Empty title="Choices could not be loaded" message={query.error?.message || malformed} onRetry={() => { void query.refetch(); }} /> : <>
      {choices.map(item => <Button key={item.id} title={item.label} kind="secondary" disabled={write.locked} onPress={() => onSelected({ id: item.id, label: item.label, mapStatus: 'map_status_supported' in item && item.map_status_supported === true, ...('revision' in item && typeof item.revision === 'number' ? { revision: item.revision } : {}), ...('has_app_access' in item ? { hasAppAccess: item.has_app_access === true } : {}) })} />)}
      {!choices.length ? <Empty title="No matching choices on this page" message={appAccessOnly ? 'The handler and verifier need current app access. Search or check the next page.' : undefined} /> : null}
      <DomainPages page={page} hasMore={kind === 'places' ? query.data.pagination.places_has_more : kind === 'holdings' ? query.data.pagination.holdings_has_more : query.data.pagination.people_has_more} disabled={write.locked} onChange={setPage} />
    </>}
    <Button title="Close choices" kind="secondary" disabled={write.locked} onPress={onClose} />
  </Section>;
}
function RepairContent({ root, repair, write, lastAccepted, href, onNavigate, historyPage, onHistoryPage, photos }: { root: string; repair: RepairDetail; write: RecordedWrite; lastAccepted: RecordedCommand | null; href: string; onNavigate: DomainScreenProps['onNavigate']; historyPage: number; onHistoryPage: (page: number) => void; photos: ReactNode }) {
  const { scopeKey } = useSession(), cache = useQueryClient(), source = `${root}/repairs/${repair.id}`, capture = useOperationContext(source), clock = useOperationClock(source);
  const [action, setAction] = useState<RepairAction | null>(null), [note, setNote] = useState(''), [status, setStatus] = useState<'in_progress' | 'waiting'>('in_progress');
  const [wait, setWait] = useState<RepairWait>('parts'), [finishAt, setFinishAt] = useState(repair.expected_finish_at ?? ''), [estimate, setEstimate] = useState(Boolean(repair.expected_finish_at));
  const [assignee, setAssignee] = useState<FacilitiesChoice | null>(null), [assigning, setAssigning] = useState(false), [assignTarget, setAssignTarget] = useState<'handler' | 'verifier' | 'coordinator'>('handler');
  const [verified, setVerified] = useState(false), [amendment, setAmendment] = useState(false), [externalEditing, setExternalEditing] = useState(false);
  const [reviewedRevision, setReviewedRevision] = useState(repair.revision), [preparingAction, setPreparingAction] = useState(false), [error, setError] = useState(''), preparingRef = useRef(false), acceptedKey = useRef(lastAccepted?.key);
  const changed = !!action && reviewedRevision !== repair.revision;
  useEffect(() => { if (lastAccepted?.sourceId === repair.id && acceptedKey.current !== lastAccepted.key) { acceptedKey.current = lastAccepted.key; setAction(null); setVerified(false); setNote(''); setAssignee(null); setReviewedRevision(repair.revision); } }, [lastAccepted?.key, repair.id, repair.revision]);
  useScreenExitGuard({ blocked: write.busy || preparingAction, dirty: !assigning && !!action && (!!note.trim() || !!assignee || verified || amendment || estimate && finishAt !== (repair.expected_finish_at ?? '')), onLeave: () => { setAction(null); setNote(''); setAssignee(null); setVerified(false); } });
  const titles: Record<RepairAction, string> = { accept: 'Accept responsibility', assign: 'Change responsibility', update: 'Update progress', complete: 'Ready for checking', verify: 'Confirm repair', reopen: 'Reopen repair' };
  const select = (next: RepairAction, target: typeof assignTarget = 'handler') => { setAction(next); setAssignTarget(target); setNote(''); setVerified(false); setAssignee(null); setReviewedRevision(repair.revision); setError(''); };
  const permitted = action ? action === 'assign' && assignTarget !== 'handler' ? repair.allowed_actions[assignTarget === 'verifier' ? 'assign_verifier' : 'assign_coordinator'] : repair.allowed_actions[action] : false;
  const review = async () => { try { const assertCurrent = capture(), latest = await apiFetch<RepairDetail>(`${source}?history_page=${historyPage}`); assertCurrent(); if (latest.id !== repair.id) throw new Error('The current repair identity changed.'); cache.setQueryData(['campus', scopeKey, `${source}?history_page=${historyPage}`], latest); setReviewedRevision(latest.revision); setVerified(false); setError(''); } catch (cause) { setError(repairError(cause)); } };
  const submit = async () => {
    if (write.locked || preparingRef.current || changed || !action || !permitted || action === 'verify' && !verified || ['assign', 'update', 'complete', 'reopen'].includes(action) && note.trim().length < 3) return;
    preparingRef.current = true; setPreparingAction(true); setError('');
    try {
      const assertCurrent = capture(), latest = await apiFetch<RepairDetail>(`${source}?history_page=${historyPage}`); assertCurrent(); if (latest.id !== repair.id) throw new Error('The current repair identity changed.'); cache.setQueryData(['campus', scopeKey, `${source}?history_page=${historyPage}`], latest);
      if (latest.revision !== reviewedRevision || (action === 'assign' && assignTarget !== 'handler' ? latest.allowed_actions[assignTarget === 'verifier' ? 'assign_verifier' : 'assign_coordinator'] : latest.allowed_actions[action]) !== true) throw new Error('The repair or current responsibility changed. Your entries are kept; review the latest source.');
      let body: Record<string, unknown> = { expected_revision: reviewedRevision, action, note: note.trim() };
      if (action === 'update') { if (estimate && !Number.isFinite(Date.parse(finishAt))) throw new Error('Choose a valid expected finish estimate.'); Object.assign(body, { status, wait_reason: status === 'waiting' ? wait : null, expected_finish_at: estimate ? finishAt : null }); }
      if (action === 'assign') { if (!assignee) return; const options = await apiFetch(`${root}/options?${new URLSearchParams({ repair_id: repair.id, person_id: assignee.id })}`); assertCurrent(); body = facilitiesAssignmentBody(latest, assignTarget, assignee, note, reviewedRevision, options); }
      if (action === 'reopen' && latest.asset_impact) body.reopen_kind = amendment ? 'record_amendment' : 'further_work';
      await write.run({ sourceId: repair.id, path: `${source}/actions`, body });
    } catch (cause) { setError(repairError(cause)); } finally { preparingRef.current = false; setPreparingAction(false); }
  };
  return <>
    {repair.urgent ? <Notice tone="danger" message={`Urgent safety concern. For immediate danger, contact ${repair.emergency_contact || 'campus security or local emergency services'}.`} /> : null}
    {repair.route_unavailable || repair.verification_route_unavailable || repair.coordinator_unavailable ? <Notice tone="warning" message="A responsibility route needs review. Available actions below reflect the current server authority." /> : null}
    <Row title={repair.recovery_only ? 'Repair responsibility needs review' : repair.external_view ? repair.external_access?.instructions ?? repair.title : repair.problem} detail={repair.recovery_only ? undefined : repair.place?.label ?? repair.item?.label ?? repair.location_note} status={stateLabel[repair.state] ?? repair.state} icon="facilities" />
    <Facts items={[{ label: 'Responsible', value: repair.handler.label }, { label: 'Checks repair', value: repair.verifier.label }, ...(repair.coordinator ? [{ label: 'Coordinator', value: repair.coordinator.label }] : [])]} />
    {repair.recovery_only ? <Notice tone="warning" message="Only assignment recovery metadata is available. Restoring responsibility does not grant access to the private problem, photos or progress." /> : repair.latest_progress?.note ? <Section title="Latest progress"><DomainText>{repair.latest_progress.note}</DomainText></Section> : null}
    {!repair.recovery_only && repair.expected_finish_at ? <DomainText>Expected finish · {domainDate(repair.expected_finish_at)}</DomainText> : null}
    {!action ? <Section title="Next action">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(['accept', 'update', 'complete', 'verify', 'reopen'] as RepairAction[]).filter(value => repair.allowed_actions[value] && !(value === 'accept' && repair.external_view)).map(value => <ControlButton key={value} title={titles[value]} kind={value === 'update' || value === 'reopen' ? 'secondary' : 'primary'} disabled={write.locked || externalEditing || preparingAction} onPress={() => select(value)} />)}</View>
      {repair.allowed_actions.assign || repair.allowed_actions.assign_verifier || repair.allowed_actions.assign_coordinator ? <Disclosure title="Change responsibility" defaultOpen={Boolean(repair.route_unavailable || repair.verification_route_unavailable || repair.coordinator_unavailable)}><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{repair.allowed_actions.assign ? <ControlButton title="Change handler" kind="secondary" disabled={write.locked || externalEditing || preparingAction} onPress={() => select('assign')} /> : null}{repair.allowed_actions.assign_verifier ? <ControlButton title="Change verifier" kind="secondary" disabled={write.locked || externalEditing || preparingAction} onPress={() => select('assign', 'verifier')} /> : null}{repair.allowed_actions.assign_coordinator ? <ControlButton title="Change coordinator" kind="secondary" disabled={write.locked || externalEditing || preparingAction} onPress={() => select('assign', 'coordinator')} /> : null}</View></Disclosure> : null}
    </Section> : <Section title={titles[action]}>
      {action === 'accept' ? <Notice message="You will follow up this repair. Work is not marked as started." /> : null}
      {action === 'complete' ? <Notice message={`Your report goes to ${repair.verifier.label} to check. The repair stays open until confirmed.`} /> : null}
      <ScreenBack title="Back to repair" priority={10} onPress={() => setAction(null)} />
      {changed ? <><Notice tone="warning" message="This repair changed. Your entries are kept; review the latest record before saving." /><ControlButton title="Review latest repair with these entries" disabled={write.busy || preparingAction} onPress={() => void review()} /></> : null}
      {action === 'assign' ? <><Button title={assignee?.label ?? `Choose next ${assignTarget}`} kind="secondary" disabled={write.locked || preparingAction} onPress={() => setAssigning(true)} /><DomainText>{assignTarget === 'coordinator' ? 'This transfers oversight of this repair only. Campus-wide permissions are unchanged.' : assignTarget === 'verifier' ? 'The repair still needs an explicit check. Earlier responsibility stays in history.' : 'The next handler must accept. Earlier responsibility stays in history.'}</DomainText>{assigning ? <FacilitiesChoices root={root} kind="people" repairId={repair.id} appAccessOnly write={write} onClose={() => setAssigning(false)} onSelected={item => { setAssignee(item); setAssigning(false); }} /> : null}</> : null}
      {action === 'update' ? <>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button title="In progress" kind={status === 'in_progress' ? 'primary' : 'secondary'} disabled={write.locked || externalEditing || preparingAction} onPress={() => setStatus('in_progress')} /><Button title="Waiting / delayed" kind={status === 'waiting' ? 'primary' : 'secondary'} disabled={write.locked || externalEditing || preparingAction} onPress={() => setStatus('waiting')} /></View>
        {status === 'waiting' ? <Section title="Waiting for"><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(['parts', 'contractor', 'approval', 'access', 'other'] as RepairWait[]).map(value => <Button key={value} title={value.charAt(0).toUpperCase() + value.slice(1)} kind={wait === value ? 'primary' : 'secondary'} disabled={write.locked || externalEditing || preparingAction} onPress={() => setWait(value)} />)}</View></Section> : null}
        <LabeledSwitch label="Add an expected finish estimate" value={estimate} onChange={value => { setEstimate(value); if (value && !finishAt) setFinishAt(clock.now); }} disabled={write.locked || preparingAction} />
        {estimate ? <><NativeTimeField label="Expected finish · estimate only" value={finishAt} onChange={setFinishAt} disabled={write.locked || preparingAction || !Number.isFinite(Date.parse(clock.now))} />{clock.error ? <><Notice tone="warning" message={clock.error} /><ControlButton title="Refresh campus time" onPress={() => void clock.read().then(setFinishAt).catch(cause => setError(repairError(cause)))} /></> : null}</> : null}
      </> : null}
      {action === 'reopen' && repair.asset_impact ? <LabeledSwitch label="This is a record amendment, rather than further repair work." value={amendment} onChange={setAmendment} disabled={write.locked || externalEditing || preparingAction} /> : null}
      <Field label={action === 'complete' ? 'What was done?' : ['reopen', 'assign'].includes(action) ? 'Reason' : 'Note'} value={note} onChangeText={setNote} editable={!write.locked && !preparingAction} multiline maxLength={2000} />
      {action === 'verify' ? <LabeledSwitch label="I checked the repair and it is satisfactory." value={verified} onChange={setVerified} disabled={write.locked || externalEditing || preparingAction} /> : null}
      {error ? <Notice tone="warning" message={error} /> : null}
      <Button title={titles[action]} busy={write.busy || preparingAction} disabled={write.locked || preparingAction || changed || !permitted || action === 'verify' && !verified || action === 'assign' && !assignee || ['assign', 'update', 'complete', 'reopen'].includes(action) && note.trim().length < 3} onPress={() => void submit()} />
      <Button title="Cancel" kind="secondary" disabled={write.locked || preparingAction} onPress={() => setAction(null)} />
    </Section>}
    <View style={action ? { display: 'none' } : undefined}><FacilitiesExternalAccess root={root} repair={repair} write={write} lastAccepted={lastAccepted} href={href} onNavigate={onNavigate} onEditing={setExternalEditing} /></View>
    {!repair.recovery_only ? <>{photos}
    <Disclosure title="Repair history" defaultOpen={historyPage > 1}>{repair.history.map(item => <Row key={item.id} variant="plain" title={item.action.replaceAll('_', ' ')} detail={`${item.actor_label} · ${domainDate(item.recorded_at)}${item.note ? `\n${item.note}` : ''}`} status={stateLabel[item.state] ?? item.state} />)}
      <DomainPages page={historyPage} hasMore={Boolean(repair.history_has_more)} disabled={write.locked} onChange={onHistoryPage} />
    </Disclosure>
    <Disclosure title={repair.external_view ? 'Job details' : 'Report details'}><Facts items={[...(!repair.external_view ? [{ label: 'Reported by', value: repair.reporter.label }, { label: 'Recorded by', value: repair.recorder.label }] : []), { label: 'Responsible', value: repair.handler.label }, { label: 'Checks repair', value: repair.verifier.label }]} /></Disclosure></> : null}
  </>;
}
