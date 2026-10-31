import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import type { AccountConnectionContext } from '../lib/account-capabilities';
import { calendarDisconnectPath, calendarExportPath, calendarParameters, parseCalendarStatus, parseCreatedCalendar, type AccountCalendarStatus, type AccountCreatedCalendar } from '../lib/account-calendar';
import { externalLinkLabel, sharePrivateCalendarLink } from '../lib/account-external';
import { downloadCampusFile, getApiOrigin } from '../lib/api';
import { useApi } from '../lib/query';
import { useAccountCommand } from '../lib/use-account-command';
import { Empty, ListGroup, Loading, Notice, Row, Section } from '../ui/components';
import { ControlButton } from '../ui/DomainControls';
import { useTheme } from '../ui/theme';

interface Props { context: AccountConnectionContext; scopeKey: string; mode: 'live' | 'simulation'; today: string; disabled?: boolean }
interface Choice { kind: 'create' | 'replace' | 'disconnect'; id: string | null; revision: number | null; reviewUnknown: boolean }
const sourceIdentity = (status: AccountCalendarStatus) => JSON.stringify([status.subscription?.id ?? null, status.subscription?.revision ?? null]);
const endpoint = '/api/v1/calendar-connections/subscriptions';

/** A scope change unmounts the one-time private link rather than retaining it. */
export function AccountCalendarConnections(props: Props) {
  return <CalendarConnectionsContent key={JSON.stringify([props.scopeKey, props.context.key, props.context.audience, props.context.studentId ?? null, props.mode])} {...props} />;
}

function CalendarConnectionsContent({ context, scopeKey, mode, today, disabled = false }: Props) {
  const { colors } = useTheme(), focused = useIsFocused(), simulated = mode === 'simulation';
  const query = useApi<unknown>(disabled ? null : `/api/v1/calendar-connections?${calendarParameters(context).toString()}`);
  const command = useAccountCommand(scopeKey, `calendar:${context.key}`);
  const [created, setCreated] = useState<AccountCreatedCalendar | null>(null), [choice, setChoice] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const mounted = useRef(true), active = useRef({ disabled, focused }), operating = useRef(false), currentStatus = useRef<AccountCalendarStatus | null>(null);
  active.current = { disabled, focused };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (disabled || !focused) { setCreated(null); setChoice(null); } }, [disabled, focused]);
  let status: AccountCalendarStatus | null = null, sourceError = '';
  if (!disabled && !query.isError && query.data !== undefined) {
    try { status = parseCalendarStatus(query.data, context, mode); } catch (cause) { sourceError = cause instanceof Error ? cause.message : 'Calendar status could not be verified.'; }
  }
  currentStatus.current = status;
  const subscription = status?.subscription ?? null;
  const pending = command.pending, reviewedUnknown = pending?.phase === 'unknown' && pending.inspected;
  const working = busy || command.busy, unavailable = disabled || !focused;
  const canChoose = !!status && !unavailable && !working && !query.isFetching && (!pending || reviewedUnknown);
  const privateLink = !simulated && !pending && !working && !unavailable && created?.id === subscription?.id ? created : null;

  function guard() {
    const assertAccountCurrent = command.capture();
    return () => { if (!mounted.current || active.current.disabled || !active.current.focused) throw new Error('Return to this calendar context and refresh before continuing.'); assertAccountCurrent(); };
  }
  async function perform(work: (assertCurrent: () => void) => Promise<void>, failureMessage?: string) {
    if (operating.current || active.current.disabled || !active.current.focused) return;
    operating.current = true; setBusy(true); setError(''); setMessage('');
    try { const assertCurrent = guard(); assertCurrent(); await work(assertCurrent); }
    catch (cause) { if (mounted.current) setError(failureMessage ?? (cause instanceof Error ? cause.message : 'The calendar action could not be completed.')); }
    finally { operating.current = false; if (mounted.current) setBusy(false); }
  }
  async function refresh(): Promise<AccountCalendarStatus> {
    const assertCurrent = guard(); assertCurrent();
    const result = await query.refetch({ throwOnError: true }); assertCurrent();
    const current = parseCalendarStatus(result.data, context, mode);
    setCreated(previous => previous && previous.id !== current.subscription?.id ? null : previous);
    return current;
  }
  function select(kind: Choice['kind']) {
    if (!canChoose || !status) return;
    const next: Choice = { kind, id: subscription?.id ?? null, revision: subscription?.revision ?? null, reviewUnknown: !!pending };
    if (kind === 'create' && !pending) void change(next); else setChoice(next);
  }
  async function change(selected: Choice) {
    await perform(async assertCurrent => {
      const current = await refresh(); assertCurrent();
      if (sourceIdentity(current) !== JSON.stringify([selected.id, selected.revision])) {
        setChoice(null); throw new Error('The calendar connection changed. Review its current status before choosing again.');
      }
      if (selected.kind === 'disconnect' && !selected.id || selected.kind === 'replace' && !selected.id || selected.kind === 'create' && selected.id) throw new Error('Review the current calendar connection before continuing.');
      if (selected.reviewUnknown) command.review();
      const requestOrigin = getApiOrigin();
      if (selected.kind === 'disconnect') {
        const target = selected.id!;
        await command.run({ path: calendarDisconnectPath(target), method: 'DELETE' }, {
          confirm(value) { const row = value as { id?: unknown; active?: unknown } | null; if (!row || row.id !== target || row.active !== false) throw new Error('The exact calendar removal was not confirmed. Refresh its status.'); return true; },
          accepted() { setCreated(null); setChoice(null); }, refresh,
        });
      } else {
        await command.run({ path: endpoint, method: 'POST', body: JSON.stringify({ portal: context.audience, ...(context.studentId ? { student_id: context.studentId } : {}) }) }, {
          confirm: value => parseCreatedCalendar(value, context, mode, requestOrigin),
          accepted(value) { setCreated(value); setChoice(null); }, refresh,
        });
      }
      assertCurrent();
    });
  }
  function inspect() { void perform(async assertCurrent => { await command.inspect(refresh); assertCurrent(); setChoice(null); }); }
  function download(preview: boolean) {
    if (!status || unavailable || working || pending) return;
    const expected = sourceIdentity(status);
    void perform(async assertCurrent => {
      const current = await refresh(); assertCurrent();
      if (preview && sourceIdentity(current) !== expected) throw new Error('The calendar preview changed. Review its current status before downloading.');
      const path = preview && current.subscription ? `${calendarDisconnectPath(current.subscription.id)}/preview.ics` : calendarExportPath(context, today);
      if (preview && (!simulated || !current.subscription)) throw new Error('Choose a current run-local preview.');
      await downloadCampusFile(path, 'thatcampus-calendar.ics'); assertCurrent();
    });
  }
  function openPrivateLink(share: boolean) {
    if (!privateLink) return;
    const link = privateLink;
    void perform(async assertCurrent => {
      assertCurrent();
      if (currentStatus.current?.subscription?.id !== link.id) throw new Error('The private link changed. Replace it to create a new one.');
      // Keep the browser activation from this tap for clipboard and webcal actions.
      if (share) await sharePrivateCalendarLink(link.feed_url); else await Linking.openURL(link.feed_url.replace(/^https:/, 'webcal:'));
      assertCurrent(); if (share) setMessage(String(externalLinkLabel) === 'Copy private link' ? 'Private link copied.' : 'Private link share sheet closed.');
    }, share ? 'The private link could not be shared. Try again from this calendar connection.' : 'The calendar app could not be opened. Share the private link with your calendar app.');
  }

  const title = simulated ? 'Run-local calendar preview' : 'Calendar sync';
  return <Section title={title}>
    {pending ? <View style={styles.detail}>
      <Notice tone={working ? 'info' : 'warning'} message={working ? 'Checking the current calendar action…' : pending.phase === 'acknowledged' ? 'The calendar action was acknowledged. Refresh its saved state; the request will not be repeated.' : simulated ? 'The preview action may have completed. Inspect its current state before making another choice.' : 'The calendar action may have completed. Inspect its current state before making another choice. A private link from a lost response cannot be recovered.'} />
      <ControlButton title="Inspect current status" busy={working} disabled={unavailable} onPress={inspect} />
      {reviewedUnknown ? <Text style={[styles.copy, { color: colors.muted }]}>{simulated ? 'Current status has been reviewed. A new choice starts a new action in this world.' : 'Current status has been reviewed. A new choice starts a new action. Replacing a link stops the old link from refreshing.'}</Text> : null}
    </View> : null}
    {disabled ? <Notice message="Calendar connections are unavailable in this context. Refresh the workspace to continue." /> : query.isPending ? <Loading label="Checking calendar connection…" /> : query.isError || sourceError ? <Empty title="Calendar status unavailable" message={sourceError || query.error?.message} onRetry={() => { void perform(async () => { await refresh(); }); }} /> : status ? <>
      <ListGroup><Row icon="calendar" title={status.scope.calendar_name} status={simulated ? subscription ? 'Run-local preview ready' : 'Create a calendar preview' : subscription ? 'Subscribed calendar ready' : 'Connect your calendar'} statusTone={subscription ? 'positive' : 'muted'} detail={simulated ? 'Authenticated .ics from this isolated world. Calendar apps receive no updates.' : subscription ? subscription.last_fetched_at ? `Last refreshed ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(subscription.last_fetched_at))}` : 'Waiting for the calendar app to refresh' : 'Updates automatically without access to your Google or Microsoft account.'} /></ListGroup>
      {privateLink ? <View style={styles.detail}>
        <Text accessibilityRole="header" aria-level={3} style={[styles.label, { color: colors.ink }]}>Private link created</Text>
        <Text style={[styles.copy, { color: colors.muted }]}>Open or share it now. The link is shown only in this view; ThatCampus stores its fingerprint. Calendar host: {privateLink.feedOrigin}</Text>
        <View style={styles.actions}><ControlButton title="Open calendar app" disabled={working} onPress={() => openPrivateLink(false)} /><ControlButton title={externalLinkLabel} disabled={working} onPress={() => openPrivateLink(true)} /><ControlButton title="Hide link" disabled={working} onPress={() => setCreated(null)} /></View>
      </View> : null}
      {!pending || reviewedUnknown ? <View style={styles.actions}>
        {!pending ? <ControlButton title="Export .ics" disabled={unavailable || working || query.isFetching} onPress={() => download(false)} /> : null}
        {simulated && subscription && !pending ? <ControlButton title="Download current preview" disabled={unavailable || working || query.isFetching} onPress={() => download(true)} /> : null}
        {!subscription ? <ControlButton title={simulated ? 'Create preview' : pending ? 'Create a new private link' : 'Subscribe'} kind="primary" disabled={!canChoose || !!choice} busy={command.busy} onPress={() => select('create')} /> : <><ControlButton title={simulated ? 'Refresh preview' : 'Replace link'} disabled={!canChoose || !!choice} onPress={() => select('replace')} /><ControlButton title={simulated ? 'Remove preview' : 'Disconnect'} kind="danger" disabled={!canChoose || !!choice} onPress={() => select('disconnect')} /></>}
      </View> : null}
      {choice ? <View style={styles.detail}>
        <Notice tone="warning" message={choice.kind === 'disconnect' ? simulated ? 'Remove this run-local preview?' : 'The installed calendar will stop receiving updates. Disconnect the current link?' : simulated ? choice.id ? 'Create a new run-local preview? The current preview will be replaced.' : 'Create a new authenticated preview in this Simulation world?' : choice.reviewUnknown ? 'This starts a new request after reviewing the current state. Any current private link will stop refreshing. Create a new link?' : 'The old calendar link will stop refreshing. Replace it with a new private link?'} />
        <View style={styles.actions}><ControlButton title="Keep it" disabled={working} onPress={() => setChoice(null)} /><ControlButton title={choice.kind === 'disconnect' ? simulated ? 'Remove preview' : 'Disconnect calendar' : simulated ? 'Create preview' : 'Create new link'} kind={choice.kind === 'disconnect' ? 'danger' : 'primary'} disabled={unavailable || working} onPress={() => { void change(choice); }} /></View>
      </View> : null}
    </> : null}
    {error || command.error ? <Notice tone="danger" message={error || command.error} /> : null}
    {message || command.message ? <Notice message={message || command.message} /> : null}
    <Text style={[styles.copy, { color: colors.muted }]}>{simulated ? 'Preview and export use only this selected Simulation world. No public token is opened or shared, and no calendar app is subscribed.' : 'Only timetable, assessments, events and campus dates visible in this scope are included. Calendar apps cannot change campus records.'}</Text>
  </Section>;
}

const styles = StyleSheet.create({ actions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 4 }, detail: { gap: 8 }, label: { fontSize: 16, lineHeight: 23, fontWeight: '600' }, copy: { fontSize: 14, lineHeight: 21 } });
