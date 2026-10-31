import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { assertWorkspaceManifestContext, normalizeWorkspaceManifest } from '../../../packages/contracts/src/workspace-normalizer';
import { useSession } from '../auth/SessionProvider';
import { accountChannelBody, accountChannelFingerprint as channelFingerprint, accountChannelLinkCurrent, accountConnectionContexts, accountMoreItems, assertAccountChannelDisconnected, parseAccountChannelLink, parseAccountChannels, parseAccountProPreference, selectedAccountConnection, type AccountChannelProvider, type AccountConnectionContext } from '../lib/account-capabilities';
import { nativeCalendarDay } from '../lib/native-calendar';
import { useApi } from '../lib/query';
import { useAccountQuery } from '../lib/account-query';
import { useAccountCommand } from '../lib/use-account-command';
import { Alert } from '../ui/Alert';
import { ChoiceMenu, ControlButton, InfoDisclosure } from '../ui/DomainControls';
import { Empty, Loading, Notice, Page } from '../ui/components';
import { useTheme } from '../ui/theme';
import { AccountCommandFeedback, AccountGroup } from './AccountPreferences';
import { AccountCalendarConnections } from './AccountCalendarConnections';

type Props = { href: string; onNavigate: (href: string) => void };
export function AccountConnectionsScreen(_props: Props) {
  const session = useSession(), query = useApi<unknown>(session.schoolId ? '/api/v1/workspace' : null);
  const [requested, setRequested] = useState('');
  const manifest = useMemo(() => { try { if (!query.data || !session.schoolId || !session.user) return null; const value = normalizeWorkspaceManifest(query.data); assertWorkspaceManifestContext(value, { actorUserId: session.user.id, institutionId: session.schoolId, environment: session.environment }); return value; } catch { return null; } }, [query.data, session.schoolId, session.user?.id, session.environment]);
  const contexts = useMemo(() => manifest ? accountConnectionContexts(manifest) : [], [manifest]), selected = selectedAccountConnection(contexts, requested);
  const showScopeChoice = contexts.length > 1 || Boolean(requested && !selected && contexts.length);
  if (!session.schoolId) return <Page title="Connected apps"><Empty title="Choose a campus" /></Page>;
  if (query.isPending) return <Page title="Connected apps"><Loading /></Page>;
  if (query.isError || !manifest) return <Page title="Connected apps"><Empty title="Your connection scopes could not load" message={query.error?.message} onRetry={() => void query.refetch()} /></Page>;
  if (!accountMoreItems(manifest).some(item => item.key === 'connections' && item.href.split('?')[0] === '/more/connections')) return <Page title="Connected apps"><Empty title="Connections are unavailable in your current workspace" /></Page>;
  let today: string; try { today = nativeCalendarDay(session.environment.virtual_clock?.now ?? Date.now(), manifest.context.time_zone ?? 'UTC'); } catch { return <Page title="Connected apps"><Empty title="The campus date could not be confirmed" /></Page>; }
  return <Page title="Connected apps" subtitle="Calendars and supported messaging apps" refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
    {showScopeChoice ? <AccountGroup title="Connect for" detail={selected?.detail ?? 'Choose which current work or learning relationship to connect.'}><ChoiceMenu label="Connection scope" value={selected?.key ?? ''} options={contexts.map(context => ({ value: context.key, label: context.label }))} onChange={setRequested} /></AccountGroup> : null}
    {!selected ? <Empty title={requested ? 'This connection scope is no longer available' : 'No connection scope is available'} message="Connections need a current institution relationship or active responsibility. Choose another available scope explicitly." /> : <View key={`${session.scopeKey}:${selected.key}`} style={{ gap: 20 }}>
      {!showScopeChoice ? <AccountGroup title={selected.label} detail={selected.detail} /> : null}
      <AccountCalendarConnections context={selected} scopeKey={session.scopeKey} mode={session.environment.mode} today={today} />
      {session.environment.mode === 'simulation' ? <AccountGroup title="Messaging connections stay in Live" detail="Provider account links are not opened or changed from this isolated world"><Notice message="Modeled outbound activity is contained in Simulation results. Nothing is sent to a Telegram, WhatsApp or other Live recipient." /></AccountGroup> : <AccountMessagingConnections context={selected} />}
    </View>}
  </Page>;
}
function AccountMessagingConnections({ context }: { context: AccountConnectionContext }) {
  const session = useSession(), focused = useIsFocused(), { colors } = useTheme(), query = useAccountQuery('/api/v1/agent/channels', parseAccountChannels), preference = useAccountQuery('/api/v1/auth/pro-features/', parseAccountProPreference);
  const command = useAccountCommand(session.scopeKey, 'messaging-connections');
  const [privateLink, setPrivateLink] = useState<{ provider: AccountChannelProvider['name']; url: string; expiresAt: string; source: string } | null>(null), [preparing, setPreparing] = useState(false), [localError, setLocalError] = useState('');
  const preparingRef = useRef(false);
  useEffect(() => { if (!privateLink) return; const timer = setTimeout(() => setPrivateLink(null), Math.max(0, Date.parse(privateLink.expiresAt) - Date.now())); return () => clearTimeout(timer); }, [privateLink]);
  useEffect(() => { if (!focused || privateLink && query.value && !accountChannelLinkCurrent(privateLink, query.value)) setPrivateLink(null); }, [focused, query.value, privateLink]);
  const perform = async (provider: AccountChannelProvider, disconnect: boolean) => {
    if (command.locked || preparingRef.current) return;
    preparingRef.current = true; setPreparing(true); setLocalError('');
    try {
      const assertCurrent = command.capture(), current = await query.refresh(); assertCurrent();
      const latest = current.find(item => item.name === provider.name);
      if (!latest || channelFingerprint(latest) !== channelFingerprint(provider) || !disconnect && (!latest.configured || latest.username !== provider.username)) throw new Error('This messaging connection changed. Review its current state before continuing.');
      if (disconnect) await command.run({ path: `/api/v1/agent/channels/${provider.name}`, method: 'DELETE' }, { confirm: value => { assertAccountChannelDisconnected(value, provider.name); return true; }, accepted: () => setPrivateLink(null), refresh: query.refresh });
      else {
        const pro = await preference.refresh(); assertCurrent(); if (!pro.enabled) throw new Error('Turn on Pro features in your account to connect the assistant.');
        await command.run({ path: '/api/v1/agent/channels/link', method: 'POST', body: JSON.stringify(accountChannelBody(provider.name, context)) }, { confirm: value => parseAccountChannelLink(value, latest), accepted: link => setPrivateLink({ provider: provider.name, ...link, source: channelFingerprint(latest) }), refresh: query.refresh });
      }
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'This messaging connection could not be changed.'); }
    finally { preparingRef.current = false; setPreparing(false); }
  };
  const disabled = command.locked || preparing;
  const open = async () => { if (preparingRef.current || command.locked || query.isError || query.invalid) return; try { const assertCurrent = command.capture(); if (!privateLink || !accountChannelLinkCurrent(privateLink, query.value)) throw new Error('The private link is no longer current.'); await Linking.openURL(privateLink.url); assertCurrent(); } catch { setLocalError('The messaging app could not be opened. The private link was not marked as connected.'); } };
  return <AccountGroup title="Messaging apps" detail="Use the assistant from a supported private chat">
    {query.isPending ? <Loading /> : query.isError || query.invalid ? <Empty title="Messaging connections could not load" message={query.invalid || query.error?.message} onRetry={() => void query.refresh().catch(() => {})} /> : query.value?.length ? query.value.map(provider => <View key={provider.name} style={{ paddingVertical: 8, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ flex: 1, minWidth: 0, gap: 5 }}><Text style={{ color: colors.ink, fontSize: 16, lineHeight: 23, fontWeight: '600' }}>{provider.label}</Text><Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>{provider.availability === 'temporarily_unavailable' ? 'Temporarily unavailable' : provider.connection ? 'Linked to your account' : provider.configured ? provider.username || 'Ready to connect' : 'Not configured by your administrator'}</Text></View></View>
      {provider.connection?.uncertain_replies ? <Notice message="A reply may not have arrived. Read it in the ThatCampus assistant; it will not be sent twice." /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {provider.configured && provider.name === 'telegram' ? <ControlButton title={provider.connection ? 'Connect for selected work' : 'Connect'} disabled={disabled || preference.isError || !!preference.invalid || !preference.value?.enabled} onPress={() => provider.connection ? Alert.alert('Connect for this work?', `Finish linking in a private ${provider.label} chat for ${context.label}. Your existing account connection may be replaced. An older unused link will stop working.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Create private link', onPress: () => void perform(provider, false) }]) : void perform(provider, false)} /> : null}
        {provider.connection ? <ControlButton title="Disconnect" kind="danger" disabled={disabled} onPress={() => Alert.alert(`Disconnect ${provider.label}?`, 'This disconnects the messaging provider from your account, including any campus scope linked to it.', [{ text: 'Keep connection', style: 'cancel' }, { text: 'Disconnect', style: 'destructive', onPress: () => void perform(provider, true) }])} /> : null}
      </View>
    </View>) : <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>No messaging provider is configured yet.</Text>}
    {preference.isError || preference.invalid ? <Empty title="Your AI preference could not load" message={preference.invalid || preference.error?.message} onRetry={() => void preference.refresh().catch(() => {})} /> : !preference.isPending && !preference.value?.enabled ? <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>Turn on Pro features in your account to connect the assistant. Existing connections can still be disconnected.</Text> : null}
    {privateLink && !disabled && !query.isError && !query.invalid ? <View style={{ padding: 14, borderRadius: 16, backgroundColor: colors.surface, gap: 8 }}><Text style={{ color: colors.ink, fontSize: 15, lineHeight: 22, fontWeight: '600' }}>Private link ready</Text><Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>Open Telegram and finish linking in its private chat. Expires {new Date(privateLink.expiresAt).toLocaleTimeString()}. Creating the link alone does not connect your account.</Text><ControlButton title="Open Telegram" onPress={() => void open()} /><ControlButton title="Hide private link" onPress={() => setPrivateLink(null)} /></View> : null}
    {localError ? <Notice tone="warning" message={localError} /> : null}
    <AccountCommandFeedback command={command} refresh={query.refresh} allowNewChoice />
    <ControlButton title="Refresh connections" busy={query.isRefetching} disabled={preparing || command.busy} onPress={() => void query.refresh().catch(cause => setLocalError(cause instanceof Error ? cause.message : 'Connections could not refresh.'))} />
    <InfoDisclosure title="How connections use access"><Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>Account links use your current campus access, selected learning relationship and AI allowance. The server checks each request. Actions needing review still open in ThatCampus.</Text></InfoDisclosure>
  </AccountGroup>;
}
