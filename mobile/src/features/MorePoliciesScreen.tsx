import { useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import type { PublishedPolicy } from '../../../packages/contracts/src/wire/features/governance/api';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, captureApiContext } from '../lib/api';
import { useApi } from '../lib/query';
import { policyAcknowledgementMatches, policyAttentionProof } from '../lib/policy-attention';
import { usePolicyAttention } from '../lib/use-policy-attention';
import { ControlButton, Facts, InfoDisclosure } from '../ui/DomainControls';
import { Empty, Loading, Notice, Page, Row } from '../ui/components';
import { useTheme } from '../ui/theme';
import { MoreToolBoundary, type MoreToolContext } from './more/MoreToolBoundary';

type Props = { href: string; onNavigate: (href: string) => void };
type Source = { policies: PublishedPolicy[]; membership_roles: string[] };
const date = (value: string) => { try { return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00Z`)); } catch { return value; } };
export function MorePoliciesScreen(props: Props) { return <MoreToolBoundary itemKey="policies" title="Policies & acknowledgements">{context => <PolicyLibrary {...props} {...context} />}</MoreToolBoundary>; }

function PolicyLibrary({ href, onNavigate, manifest, refreshAccess }: Props & MoreToolContext) {
  const { colors } = useTheme(), { user, scopeKey } = useSession();
  const focused = useIsFocused(), active = useRef({ scopeKey, focused }); active.current = { scopeKey, focused };
  const school = manifest.context.institution_id, path = `/api/v1/schools/${encodeURIComponent(school)}/governance/policies/`;
  const query = useApi<Source>(path);
  const policies = !query.isError && query.data && Array.isArray(query.data.policies) ? query.data.policies : [];
  const params = new URLSearchParams(href.split('?')[1] ?? ''), selectedId = params.get('policy');
  const selected = selectedId ? policies.find(policy => policy.id === selectedId) : undefined;
  const proof = query.isSuccess && !query.isError ? policyAttentionProof(href, policies) : null;
  usePolicyAttention(proof, query.dataUpdatedAt);
  const [busy, setBusy] = useState(false), busyNow = useRef(false), [error, setError] = useState('');
  const [pending, setPending] = useState<{ policy: PublishedPolicy; accepted: boolean } | null>(null);
  const navigate = (policy?: PublishedPolicy) => {
    const next = new URLSearchParams(params); for (const key of ['policy', 'policy_revision', 'attention_notification_id']) next.delete(key);
    if (policy) { next.set('policy', policy.id); if (policy.revision) next.set('policy_revision', String(policy.revision)); }
    onNavigate(`/more/policies${next.size ? `?${next}` : ''}`);
  };
  const assertActive = (context: ReturnType<typeof captureApiContext>) => { context.assertCurrent(); if (active.current.scopeKey !== scopeKey || !active.current.focused || AppState.currentState !== 'active') throw new Error('The original policy view is no longer active. Refresh this version before continuing.'); };
  const check = async () => {
    if (busyNow.current || !pending) return; busyNow.current = true; setBusy(true); setError('');
    try { const context = captureApiContext(); assertActive(context); const result = await query.refetch({ throwOnError: true }); assertActive(context); if (result.data?.policies.some(policy => policy.id === pending.policy.id && policy.acknowledgement_id)) setPending(null); else if (!pending.accepted) setError('This version is not confirmed as acknowledged. You may retry the same acknowledgement.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The acknowledgement could not be checked.'); }
    finally { busyNow.current = false; setBusy(false); }
  };
  const acknowledge = async (policy: PublishedPolicy) => {
    if (busyNow.current || !user || pending?.accepted || !policies.some(current => current.id === policy.id && current.version === policy.version && current.revision === policy.revision && current.requires_acknowledgement && !current.acknowledgement_id)) return;
    busyNow.current = true; setBusy(true); setError(''); setPending({ policy, accepted: false });
    try {
      const context = captureApiContext(); assertActive(context);
      const result = await apiFetch<unknown>(`/api/v1/schools/${encodeURIComponent(school)}/governance/policy-versions/${encodeURIComponent(policy.id)}/acknowledgements/`, { method: 'POST', body: JSON.stringify({ acknowledgement_text: `I acknowledge that institution policy version ${policy.version} was presented to me.` }) });
      assertActive(context); if (!policyAcknowledgementMatches(result, policy, user.id, school)) throw new Error('The response did not confirm this exact policy acknowledgement. Refresh to check it.');
      setPending({ policy, accepted: true });
      const refreshed = await query.refetch({ throwOnError: true }); assertActive(context);
      if (refreshed.data?.policies.some(current => current.id === policy.id && current.acknowledgement_id)) setPending(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The acknowledgement could not be confirmed. Refresh before repeating it.'); }
    finally { busyNow.current = false; setBusy(false); }
  };
  return <Page title={selectedId ? 'Policy details' : 'Policies'} refreshing={query.isRefetching} onRefresh={() => { refreshAccess(); void query.refetch(); }}>
    <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>Acknowledgement records the version you have read. It is not consent or a waiver.</Text>
    {params.has('attention_notification_id') && selectedId && query.isSuccess && !proof ? <Notice tone="warning" message="This policy version is no longer available with your current access. It was not marked as opened." /> : null}
    {pending ? <View style={{ gap: 8 }}><Notice message={pending.accepted ? `Your acknowledgement of ${pending.policy.title}, version ${pending.policy.version}, was recorded. Refresh to finish updating this view.` : `The acknowledgement of ${pending.policy.title}, version ${pending.policy.version}, is not confirmed. Check before repeating it.`} tone={pending.accepted ? 'success' : 'warning'} /><ControlButton title="Check acknowledgement" busy={busy} onPress={() => { void check(); }} />{!pending.accepted && selected?.id === pending.policy.id ? <ControlButton title="Retry same acknowledgement" disabled={busy} onPress={() => { void acknowledge(pending.policy); }} /> : null}</View> : null}
    {error ? <Notice tone="danger" message={error} /> : null}
    {query.isPending ? <Loading /> : query.isError ? <Empty title="Policies could not load" message={query.error.message} onRetry={() => void query.refetch()} /> : selectedId ? selected ? <View style={{ gap: 16 }}>
      <Text accessibilityRole="header" aria-level={2} style={{ color: colors.ink, fontSize: 22, lineHeight: 29, fontWeight: '600' }}>{selected.title}</Text>
      <Facts items={[{ label: 'Version', value: String(selected.version) }, { label: 'Effective', value: date(selected.effective_on) }, ...(selected.review_due_on ? [{ label: 'Next review', value: date(selected.review_due_on) }] : [])]} />
      {selected.summary ? <Text style={{ color: colors.ink, fontSize: 16, lineHeight: 24 }}>{selected.summary}</Text> : null}
      <Text selectable style={{ color: colors.ink, fontSize: 16, lineHeight: 25 }}>{selected.body_markdown}</Text>
      {selected.source_note ? <InfoDisclosure title="Institution source note"><Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>{selected.source_note}</Text></InfoDisclosure> : null}
      {selected.requires_acknowledgement && !selected.acknowledgement_id ? <ControlButton title="Acknowledge this version" kind="primary" busy={busy} disabled={Boolean(pending)} onPress={() => { void acknowledge(selected); }} /> : selected.acknowledged_at ? <Notice tone="success" message={`Acknowledged ${new Date(selected.acknowledged_at).toLocaleDateString()}`} /> : null}
    </View> : <Empty title="Policy not available" message="This policy may no longer be available with your current access. Return to the policy list." /> : policies.length ? <View>{policies.map((policy, index) => <Row key={policy.id} variant="plain" separator={index > 0} title={policy.title} detail={`Version ${policy.version} · effective ${date(policy.effective_on)}`} status={policy.acknowledgement_id ? 'Acknowledged' : policy.requires_acknowledgement ? 'Action needed' : 'Read'} statusTone={policy.acknowledgement_id ? 'positive' : policy.requires_acknowledgement ? 'warning' : 'muted'} icon="policies" onPress={() => navigate(policy)} />)}</View> : <Empty title="No policies available with your current access" message="Institution-approved policies will appear here when they are effective." />}
  </Page>;
}
