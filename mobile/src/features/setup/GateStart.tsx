import { useState } from 'react';
import { Text } from 'react-native';
import type { ProgressiveSetup, SetupResult } from '../../../../packages/contracts/src/onboarding';
import { useSession } from '../../auth/SessionProvider';
import { apiFetch, captureApiContext } from '../../lib/api';
import { ApiError } from '../../lib/api-client';
import { setupGateBody } from '../../lib/onboarding-policy';
import { ScreenBack, useScreenExitGuard } from '../../ui/BackNavigation';
import { ChoiceMenu, ControlButton, InfoDisclosure } from '../../ui/DomainControls';
import { Button, Field, Notice, Page } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import type { OnboardingProps } from '../OnboardingScreen';

export function GateStart({ data, onSaved }: OnboardingProps & { data: ProgressiveSetup; onSaved: (value: SetupResult) => void }) {
  const session = useSession(), { colors } = useTheme();
  const [gate, setGate] = useState('Main entrance'), [existing, setExisting] = useState(''), [operator, setOperator] = useState('self'), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [unknown, setUnknown] = useState(false);
  useScreenExitGuard({ blocked: busy, dirty: gate !== 'Main entrance' || !!existing || operator !== 'self' || confirmed });
  async function save() {
    if (busy || unknown) return; setBusy(true); setError(''); let sent = false;
    try { const context = captureApiContext(); const body = setupGateBody(gate, existing, operator, confirmed, data, session.user?.id ?? ''); sent = true; const value = await apiFetch<SetupResult>(`/api/v1/schools/${data.school_id}/get-started/gate/`, { method: 'POST', body: JSON.stringify(body) }); context.assertCurrent(); if (value.capability !== 'gate' || value.status !== 'working') throw new Error('The entry point result could not be confirmed.'); setConfirmed(false); setGate('Main entrance'); setExisting(''); setOperator('self'); onSaved(value); }
    catch (cause) { if (sent && (!(cause instanceof ApiError) || cause.status >= 500 || [408, 409, 429].includes(cause.status))) setUnknown(true); setError(cause instanceof Error ? cause.message : 'Setup was not confirmed.'); }
    finally { setBusy(false); }
  }
  return <Page title="Set up entry & exit" subtitle="Choose an entry point and its operator."><ScreenBack fallbackHref="/more/setup/capabilities" title="Campus setup" disabled={busy} />
    {data.options.gates.length ? <ChoiceMenu label="Entry point" value={existing} options={[{ value: '', label: 'Create an entry point' }, ...data.options.gates.map(value => ({ value: value.id, label: value.label }))]} onChange={setExisting} disabled={busy || unknown} /> : null}
    {!existing ? <Field label="Entry point name" value={gate} onChangeText={setGate} maxLength={160} editable={!busy && !unknown} /> : null}
    <ChoiceMenu label="Who will operate it?" value={operator} options={[{ value: 'self', label: 'I will' }, ...data.options.staff.filter(value => value.id !== session.user?.id).map(value => ({ value: value.id, label: value.label }))]} onChange={value => { setOperator(value); setConfirmed(false); }} disabled={busy || unknown} />
    {operator === 'self' ? <ControlButton title={confirmed ? 'Confirmed: I will operate this entry point' : 'Confirm: I will record arrivals and departures using my administrator access'} disabled={busy || unknown} onPress={() => setConfirmed(!confirmed)} /> : <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 23 }}>The selected staff member will receive gatekeeper responsibility.</Text>}
    {error ? <Notice tone="danger" message={error} /> : null}{unknown ? <Notice tone="warning" message="Setup is unconfirmed. Inspect the current entry points before making another request. It has not been repeated." /> : null}
    <Button title={existing ? 'Set up entry point' : 'Create entry point'} busy={busy} disabled={unknown || operator === 'self' && !confirmed} onPress={() => { void save(); }} />
    <InfoDisclosure title="Visitor records"><Text style={{ color: colors.muted, fontSize: 15, lineHeight: 23 }}>Visitors don’t need an app account. No class or student record is required.</Text></InfoDisclosure>
  </Page>;
}
