import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { CopyIcon } from 'phosphor-react-native/src/icons/Copy';
import { EnvelopeSimpleIcon } from 'phosphor-react-native/src/icons/EnvelopeSimple';
import { ShareIcon } from 'phosphor-react-native/src/icons/Share';
import type { ArrangedVisit } from '../../../packages/contracts/src/wire/features/gate/visitApi';
import type { VisitOnboardingLinkState } from '../../../packages/contracts/src/visit-onboarding';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, getApiOrigin } from '../lib/api';
import { assertVisitOnboardingReceipt, gateVisitOnboardingAcceptedPath, gateVisitOnboardingInput, gateVisitOnboardingRoot, readVisitOnboardingReveal, readVisitOnboardingState, sameVisitOnboardingSource } from '../lib/gate-visit-onboarding';
import { useNativePendingAction } from '../lib/native-pending-action';
import { useOperationContext } from '../lib/use-operation-context';
import { copyVisitOnboardingLink, emailVisitOnboardingLink, shareVisitOnboardingLink } from '../lib/visit-onboarding-share';
import { Alert } from '../ui/Alert';
import { useScreenExitGuard } from '../ui/BackNavigation';
import { ControlButton } from '../ui/DomainControls';
import { Notice } from '../ui/components';
import { MotionModal } from '../ui/Motion';
import { useTheme } from '../ui/theme';
import { VisitPrimaryAction } from './GateVisitDetails';

interface Props { href: string; schoolId: string; visit: ArrangedVisit; state: VisitOnboardingLinkState; refresh(): Promise<unknown>; disabled?: boolean; onNavigate(href: string): void; timezone?: string }

function sourceKey(state: VisitOnboardingLinkState) { return JSON.stringify([state.visit_id, state.visit_revision, state.revision, state.can_manage, state.can_issue, state.can_revoke, state.public_onboarding_supported, state.current?.id, state.current?.state, state.current?.ends_at]); }
function expiryLabel(value: string, timezone?: string) {
  try { if (timezone?.trim()) return `${new Intl.DateTimeFormat('en-GB', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))} · ${timezone}`; } catch { /* Explicit UTC remains honest when the campus zone is unavailable. */ }
  return `${new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC')}`;
}

/** The credential lives only in this visible, current management surface. */
export function GateVisitOnboarding({ href, schoolId, visit, state, refresh, disabled, onNavigate, timezone }: Props) {
  const session = useSession(), focused = useIsFocused(), { colors } = useTheme(), root = gateVisitOnboardingRoot(schoolId, visit.id);
  const captureOperation = useOperationContext(root), [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [open, setOpen] = useState(false), [working, setWorking] = useState(false), [error, setError] = useState(''), [feedback, setFeedback] = useState('');
  const [credential, setCredential] = useState<{ key: string; epoch: number; url: string } | null>(null), pending = useRef(false), reviewAttempt = useRef(0);
  const valid = !!readVisitOnboardingState(state, visit.id) && state.visit_revision === visit.revision, eligible = valid && state.can_manage && session.status === 'authenticated' && session.schoolId === schoolId && !session.environment.unavailable;
  const publicSupported = state.public_onboarding_supported && session.environment.mode === 'live';
  const origin = getApiOrigin(), active = eligible && focused && foreground && AppState.currentState === 'active', owner = JSON.stringify([session.scopeKey, origin, root]), signature = sourceKey(state);
  const current = useRef({ owner, active, epoch: 0, credentialEpoch: 0, mounted: false, signature, open, state, disabled });
  const ownerChanged = current.current.owner !== owner || current.current.active !== active;
  if (ownerChanged) current.current.epoch++;
  if (ownerChanged || current.current.signature !== signature || current.current.open !== open || current.current.disabled !== disabled) { current.current.credentialEpoch++; reviewAttempt.current++; }
  Object.assign(current.current, { owner, active, signature, open, state, disabled });
  useEffect(() => { current.current.mounted = true; return () => { current.current.mounted = false; current.current.epoch++; }; }, []);
  useEffect(() => {
    const listener = AppState.addEventListener('change', value => { current.current.epoch++; current.current.credentialEpoch++; reviewAttempt.current++; current.current.active = value === 'active' && focused && eligible; setCredential(null); setForeground(value === 'active'); });
    return () => listener.remove();
  }, [focused, eligible]);
  useEffect(() => { setCredential(null); setFeedback(''); }, [signature, active, owner, open]);
  useEffect(() => {
    if (!credential || !state.current) return;
    const endsAt = Date.parse(state.current.ends_at); let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (!current.current.mounted || current.current.credentialEpoch !== credential.epoch || current.current.signature !== credential.key) return;
      const remaining = endsAt - Date.now();
      if (remaining > 0) { timer = setTimeout(tick, Math.min(remaining, 2_147_483_647)); return; }
      current.current.credentialEpoch++; setCredential(null); setFeedback('The link expiry has been reached. Refresh the visit before sharing again.');
    };
    tick();
    return () => clearTimeout(timer);
  }, [credential?.key, credential?.epoch, state.current?.ends_at]);
  const capture = useCallback(() => {
    const epoch = current.current.epoch;
    const assertCurrent = () => { if (!current.current.mounted || !current.current.active || current.current.owner !== owner || current.current.epoch !== epoch || AppState.currentState !== 'active') throw new Error('Return to the current visit before continuing.'); };
    assertCurrent(); const assertOperation = captureOperation(); return () => { assertCurrent(); assertOperation(); };
  }, [owner, captureOperation]);
  const writer = useNativePendingAction<unknown>({ scope: { actorId: session.user!.id, schoolId, mode: session.environment.mode, namespaceId: session.environment.namespace_id ?? null, origin }, domain: 'gate', ownerHref: href, refreshPath: root, captureOperation: capture,
    resolveRefreshPath: gateVisitOnboardingAcceptedPath, accepted: async (value, assertCurrent, action) => { assertVisitOnboardingReceipt(value, action); assertCurrent(); await refresh(); assertCurrent(); } });
  const ownAction = writer.action?.source?.kind === 'gate_visit_onboarding' && writer.action.source.sourceId === visit.id && writer.action.ownerHref === href;
  const locked = !!disabled || working || writer.locked || !active, busy = working || writer.busy;
  useScreenExitGuard({ blocked: busy });
  const close = () => { if (pending.current || writer.busy) return; current.current.open = false; current.current.credentialEpoch++; reviewAttempt.current++; setCredential(null); setOpen(false); setError(''); setFeedback(''); };
  const stillSource = (snapshot: VisitOnboardingLinkState) => { if (!current.current.open || !sameVisitOnboardingSource(snapshot, current.current.state) || current.current.disabled) throw new Error('Review the current visit before continuing.'); };
  const freshSource = async (snapshot: VisitOnboardingLinkState, assertCurrent: () => void) => {
    const fresh = readVisitOnboardingState(await apiFetch<unknown>(root), visit.id); assertCurrent(); stillSource(snapshot);
    if (!fresh || !sameVisitOnboardingSource(snapshot, fresh) || fresh.visit_revision !== visit.revision) { await refresh(); assertCurrent(); throw new Error('The visit changed. Review it before continuing.'); }
    return fresh;
  };
  const reveal = async () => {
    if (locked || pending.current || !open || state.current?.state !== 'active' || !publicSupported) return;
    pending.current = true; setWorking(true); setError(''); setFeedback(''); setCredential(null);
    let reportCurrent: (() => void) | undefined;
    try {
      const assertCurrent = capture(), snapshot = state, key = signature, epoch = current.current.credentialEpoch;
      reportCurrent = () => { assertCurrent(); stillSource(snapshot); if (current.current.signature !== key || current.current.credentialEpoch !== epoch) throw new Error('This reveal expired.'); };
      const fresh = await freshSource(snapshot, assertCurrent);
      const value = readVisitOnboardingReveal(await apiFetch(`${root}reveal/`, { method: 'POST', body: JSON.stringify({ expected_revision: fresh.revision, expected_visit_revision: fresh.visit_revision }) }), fresh);
      assertCurrent(); stillSource(snapshot); if (current.current.signature !== key || current.current.credentialEpoch !== epoch) return;
      setCredential({ key, epoch, url: value.join_url });
    } catch { try { reportCurrent?.(); if (reportCurrent) setError('The link could not be revealed. Refresh this visit and confirm your current management access.'); } catch { /* A retired reveal cannot alter the returning surface. */ } }
    finally { pending.current = false; if (current.current.mounted) setWorking(false); }
  };
  const change = (action: 'issue' | 'revoke') => {
    if (locked || pending.current || !open || !publicSupported || !(action === 'issue' ? state.can_issue : state.can_revoke)) return;
    const snapshot = state, assertCurrent = capture(), expectedSignature = signature, attempt = ++reviewAttempt.current;
    Alert.alert(action === 'revoke' ? 'Stop new registrations?' : state.current ? 'Replace the registration link?' : 'Create a visitor link?', action === 'revoke'
      ? 'The existing link will stop accepting new registrations. Recorded registrations and observed movements stay in the visit.'
      : `${state.current ? 'The previous link will stop accepting new registrations. Existing registrations stay recorded. ' : ''}One link is shared with the whole group. Each visitor signs in and registers themselves. It expires when this visit ends: ${expiryLabel(visit.ends_at, timezone)}.`,
    [{ text: 'Cancel', style: 'cancel' }, { text: action === 'revoke' ? 'Stop registrations' : state.current ? 'Replace link' : 'Create link', style: action === 'revoke' || state.current ? 'destructive' : 'default', onPress: () => void (async () => {
      let acquired = false;
      try {
        assertCurrent(); stillSource(snapshot); if (current.current.signature !== expectedSignature || attempt !== reviewAttempt.current || pending.current || writer.locked) return;
        pending.current = true; setWorking(true); setError(''); setFeedback(''); setCredential(null);
        acquired = true;
        const fresh = await freshSource(snapshot, assertCurrent);
        if (action === 'issue' && Date.parse(visit.ends_at) <= Date.now()) throw new Error('Review the visit end time first.');
        const saved = await writer.run(gateVisitOnboardingInput(schoolId, fresh, action, action === 'issue' ? visit.ends_at : undefined));
        assertCurrent(); if (saved) setFeedback(action === 'issue' ? 'Visitor link saved. Reveal it when you are ready to share.' : 'The link no longer accepts new registrations.');
      } catch { try { assertCurrent(); stillSource(snapshot); if (current.current.signature === expectedSignature && attempt === reviewAttempt.current) setError('This action was not confirmed. Review the current visit and any retained action before continuing.'); } catch { /* A retired review cannot update another source. */ } }
      finally { if (acquired) { pending.current = false; if (current.current.mounted) setWorking(false); } }
    })() }]);
  };
  const visibleCredential = active && open && publicSupported && !disabled && credential?.key === signature && credential.epoch === current.current.credentialEpoch && state.current?.state === 'active' && Date.parse(state.current.ends_at) > Date.now() ? credential : null;
  const sendTo = async (kind: 'share' | 'email' | 'copy') => {
    if (!visibleCredential || locked || pending.current) return;
    const snapshot = state, link = visibleCredential; pending.current = true; setWorking(true); setError(''); setFeedback('');
    try {
      const lease = capture(), assertCurrent = () => { lease(); stillSource(snapshot); if (current.current.signature !== link.key || current.current.credentialEpoch !== link.epoch || !snapshot.current || Date.parse(snapshot.current.ends_at) <= Date.now()) throw new Error('This link changed.'); };
      if (kind === 'share') { const outcome = await shareVisitOnboardingLink(link.url, assertCurrent); assertCurrent(); if (outcome === 'unavailable') setFeedback('Sharing is unavailable here. Copy the link or open an email draft.'); }
      else if (kind === 'email') await emailVisitOnboardingLink(link.url, assertCurrent);
      else { await copyVisitOnboardingLink(link.url, assertCurrent); assertCurrent(); setFeedback('Link copied. Share it only with the visitors you intend to invite.'); }
    } catch { if (current.current.mounted && current.current.active && current.current.signature === link.key && current.current.credentialEpoch === link.epoch && current.current.epoch === outboundEpoch.current) setError('This sharing option is unavailable. Reveal the current link again, then choose Copy, Email or Share.'); }
    finally { pending.current = false; if (current.current.mounted) setWorking(false); }
  };
  const outboundEpoch = useRef(0);
  const outbound = (kind: 'share' | 'email' | 'copy') => { outboundEpoch.current = current.current.epoch; void sendTo(kind); };
  if (!valid || !state.can_manage) return null;
  return <><VisitPrimaryAction disabled={!!disabled || !active || busy} busy={writer.busy} onPress={() => { setError(''); setFeedback(''); setOpen(true); }} />
    <MotionModal visible={open && active} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}><SafeAreaProvider><SafeAreaView accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.canvas }]}>
      <View style={styles.heading}><Text accessibilityRole="header" aria-level={2} style={[styles.title, { color: colors.ink }]}>Invite visitors</Text><ControlButton title="Done" disabled={busy} onPress={close} /></View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <Text style={[styles.description, { color: colors.ink }]}>Share one link with the group. Each visitor signs in or creates an account and registers themselves for this visit.</Text>
        <View style={[styles.counts, { backgroundColor: colors.row }]}><Text style={[styles.countText, { color: colors.ink }]}>{visit.party_size} {visit.party_size === 1 ? 'person' : 'people'} expected</Text><Text style={[styles.countText, { color: colors.muted }]}>{state.current?.registration_count ?? 0} registered with {state.current ? 'the current' : 'a'} link</Text></View>
        <Notice message="Registration records who signed up. It does not grant entry or confirm arrival, attendance or an organiser conversation." />
        {!publicSupported ? <Notice message={session.environment.mode === 'simulation' ? "Public visitor registration is unavailable in Simulation. No Live link is borrowed or sent. You can continue using the selected world's visit arrangements." : 'Public visitor registration is currently unavailable for this visit. No link has been revealed or shared.'} /> : <>
          {state.current ? <><Text style={[styles.label, { color: colors.ink }]}>Registration link · {state.current.state.replaceAll('_', ' ')}</Text><Text style={[styles.description, { color: colors.muted }]}>Available until {expiryLabel(state.current.ends_at, timezone)}</Text></> : <Text style={[styles.description, { color: colors.muted }]}>No registration link has been created.</Text>}
          {visibleCredential ? <><Notice message="The current link is ready. Choose where to share it. Closing this sheet or leaving the app clears the revealed copy." /><View style={styles.actions}>
            {(['share', 'email', 'copy'] as const).map(kind => { const Glyph = kind === 'share' ? ShareIcon : kind === 'email' ? EnvelopeSimpleIcon : CopyIcon; return <Pressable key={kind} accessibilityRole="button" accessibilityLabel={kind === 'email' ? 'Open email draft with visit link' : kind === 'copy' ? 'Copy visit registration link' : 'Share visit registration link'} accessibilityState={{ disabled: locked }} disabled={locked} onPress={() => outbound(kind)} style={({ pressed }) => [styles.shareAction, { backgroundColor: colors.row, opacity: locked ? .45 : pressed ? .65 : 1 }]}><View accessible={false}><Glyph size={22} color={colors.link} /></View><Text style={[styles.actionLabel, { color: colors.link }]}>{kind === 'share' ? 'Share' : kind === 'email' ? 'Email' : 'Copy link'}</Text></Pressable>; })}
          </View></> : state.current?.state === 'active' ? <View style={styles.actions}><ControlButton title="Reveal current link" kind="primary" busy={working} disabled={locked} onPress={() => void reveal()} /></View> : null}
          <View style={styles.actions}>{state.can_issue ? <ControlButton title={state.current ? 'Replace link' : 'Create visitor link'} disabled={locked || Date.parse(visit.ends_at) <= Date.now()} onPress={() => change('issue')} /> : null}{state.can_revoke ? <ControlButton title="Stop registrations" kind="danger" disabled={locked} onPress={() => change('revoke')} /> : null}</View>
          {state.can_issue && Date.parse(visit.ends_at) <= Date.now() ? <Notice message="The visit has ended. Review its dates before creating a new registration link." /> : null}
        </>}
        {writer.action ? <><Notice tone="warning" message={ownAction ? 'An exact visitor-link action is retained. Confirm its receipt before creating, replacing or revoking another link.' : 'Another In & Out action is retained. Return to its original screen to resolve it first.'} /><View style={styles.actions}>{ownAction ? <ControlButton title={writer.action.phase === 'accepted' ? 'Confirm saved action' : 'Recover exact action'} busy={writer.busy} disabled={!!disabled || working} onPress={() => void writer.recover()} /> : writer.resumeHref ? <ControlButton title="Open retained action" disabled={busy} onPress={() => { close(); onNavigate(writer.resumeHref!); }} /> : null}</View></> : writer.blocked ? <Notice tone="warning" message="The retained In & Out action could not be read safely. New actions remain blocked." /> : null}
        {error || writer.error ? <Notice tone="warning" message={error || 'The action could not be confirmed. Review the retained action or refresh this visit.'} /> : null}{feedback ? <Notice message={feedback} /> : null}
      </ScrollView>
    </SafeAreaView></SafeAreaProvider></MotionModal>
  </>;
}

const styles = StyleSheet.create({ sheet: { flex: 1 }, heading: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12 }, title: { flex: 1, minWidth: 0, fontSize: 24, lineHeight: 30, fontWeight: '700' }, body: { padding: 20, paddingBottom: 40, gap: 16 }, description: { fontSize: 16, lineHeight: 24 }, counts: { gap: 8, padding: 16, borderRadius: 20 }, countText: { fontSize: 16, lineHeight: 24 }, label: { fontSize: 16, lineHeight: 24, fontWeight: '600' }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, shareAction: { minHeight: 48, minWidth: 44, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16 }, actionLabel: { fontSize: 16, lineHeight: 24, fontWeight: '600', flexShrink: 1 } });
