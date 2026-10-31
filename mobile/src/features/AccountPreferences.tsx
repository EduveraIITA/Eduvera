import { useRef, useState, type PropsWithChildren, type ReactNode } from 'react';
import { Switch, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/SessionProvider';
import { getApiOrigin } from '../lib/api';
import { accountMemoryAvailable, accountMemoryDeletePath, accountMemoryListFingerprint as memoryFingerprint, accountQueryBelongsToActor, assertMemoriesCleared, assertMemoryDeleted, memoryCategoryLabel, parseAccountMemories, parseAccountProPreference, type AccountMemory } from '../lib/account-capabilities';
import { useAccountQuery } from '../lib/account-query';
import { useAccountCommand } from '../lib/use-account-command';
import { Alert } from '../ui/Alert';
import { useCampusNavigation, useScreenExitGuard } from '../ui/BackNavigation';
import { AssistantMark } from '../ui/AssistantMark';
import { ControlButton, Disclosure, InfoDisclosure } from '../ui/DomainControls';
import { Empty, Loading, Notice } from '../ui/components';
import { useTheme } from '../ui/theme';

export function AccountGroup({ title, detail, icon, action, children }: PropsWithChildren<{ title: string; detail?: string; icon?: ReactNode; action?: ReactNode }>) {
  const { colors } = useTheme();
  return <View style={{ backgroundColor: colors.row, borderRadius: 24, padding: 16, gap: 12 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>{icon}<View style={{ flex: 1, minWidth: 0, gap: 5 }}><Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 18, fontWeight: '600', lineHeight: 25 }}>{title}</Text>{detail ? <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>{detail}</Text> : null}</View>{action}</View>{children}</View>;
}
export function AccountCommandFeedback({ command, refresh, resolves, allowNewChoice = false }: { command: ReturnType<typeof useAccountCommand>; refresh: () => Promise<unknown>; resolves?: Parameters<ReturnType<typeof useAccountCommand>['inspect']>[1]; allowNewChoice?: boolean }) {
  const { colors } = useTheme();
  return <>{command.error ? <Notice tone="warning" message={command.error} /> : null}{command.message ? <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>{command.message}</Text> : null}{command.pending ? <><Notice tone="warning" message={command.pending.phase === 'acknowledged' ? 'This action was acknowledged. Refresh checks the saved state without sending it again.' : 'The result is unconfirmed. Review current saved state before making another choice. The original action is not sent again.'} /><ControlButton title="Refresh saved state" busy={command.busy} onPress={() => void command.inspect(refresh, resolves)} />{allowNewChoice && command.pending.phase === 'unknown' && command.pending.inspected ? <ControlButton title="Use reviewed state for a new choice" disabled={command.busy} onPress={() => command.review()} /> : null}</> : null}</>;
}
export function AccountProFeatures() {
  const session = useSession(), cache = useQueryClient(), { colors } = useTheme();
  const query = useAccountQuery('/api/v1/auth/pro-features/', parseAccountProPreference);
  const command = useAccountCommand(JSON.stringify([session.user?.id, getApiOrigin()]), 'account-pro');
  const { prepareTabConfiguration } = useCampusNavigation();
  useScreenExitGuard({ blocked: command.busy });
  const updateCaches = (result: ReturnType<typeof parseAccountProPreference>) => {
    const belongs = (key: readonly unknown[]) => accountQueryBelongsToActor(key, session.user!.id, getApiOrigin());
    cache.setQueriesData({ predicate: item => belongs(item.queryKey) && item.queryKey[2] === '/api/v1/auth/pro-features/' }, result);
    if (!result.enabled) cache.removeQueries({ predicate: item => belongs(item.queryKey) && typeof item.queryKey[2] === 'string' && (item.queryKey[2].startsWith('/api/v1/agent/') && item.queryKey[2] !== '/api/v1/agent/memories' || item.queryKey[2].startsWith('assistant-')) });
    void cache.invalidateQueries({ predicate: item => belongs(item.queryKey) && item.queryKey[2] === '/api/v1/workspace' });
  };
  const change = (enabled: boolean) => {
    if (command.locked || !query.value) return;
    prepareTabConfiguration(enabled,operation => {
      if (command.locked || !query.value) { operation.finish(false); return; }
      void command.run({ path: '/api/v1/auth/pro-features/', method: 'POST', body: JSON.stringify({ enabled }) }, {
        confirm: value => { const result = parseAccountProPreference(value); if (result.enabled !== enabled) throw new Error('The requested preference was not confirmed.'); return result; },
        accepted: result => { operation.acknowledge(); updateCaches(result); },refresh: query.refresh,
      }).then(confirmed => operation.finish(confirmed),() => operation.finish(false));
    });
  };
  return <AccountGroup title="Pro features" detail="Advanced assistant tools, charts and specialist AI" icon={<AssistantMark size={30} />} action={<Switch accessibilityLabel="Pro features" value={query.value?.enabled === true} disabled={command.locked || query.isPending || !!query.invalid || query.isError} trackColor={{ true: colors.action }} onValueChange={enabled => enabled ? change(true) : Alert.alert('Turn off Pro features?', 'This stops unfinished AI work and dismisses its pending actions across your account. Ordinary campus screens and Messages stay available.', [{ text: 'Keep Pro features', style: 'cancel' }, { text: 'Turn off', onPress: () => change(false) }])} />}>
    {query.isPending ? <Loading /> : query.isError || query.invalid ? <Empty title="Your preference could not load" message={query.invalid || query.error?.message} onRetry={() => void query.refresh().catch(() => {})} /> : null}
    <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>Optional preview. Turning it off removes assistant and specialist AI tools. Re-enabling does not restore dismissed AI work.</Text>
    {session.environment.mode === 'simulation' ? <Notice message="This is your account preference. Changing it also affects Live assistant work." /> : null}
    <AccountCommandFeedback command={command} refresh={query.refresh} resolves={(value, request) => parseAccountProPreference(value).enabled === (JSON.parse(request.body ?? '{}') as { enabled?: boolean }).enabled} allowNewChoice />
  </AccountGroup>;
}
export function AccountAssistantMemory() {
  const session = useSession();
  if (session.environment.mode === 'simulation') return <AccountGroup title="Assistant memory" detail="Available in Live"><Notice message="Memory is not loaded or changed in Simulation. Return to Live to manage your remembered preferences." /></AccountGroup>;
  if (!accountMemoryAvailable(session.environment.mode, session.schoolId, false)) return <AccountGroup title="Assistant memory" detail="Choose a campus to view its remembered preferences." />;
  return <LiveAccountMemory key={session.scopeKey} />;
}
function LiveAccountMemory() {
  const session = useSession(), { colors } = useTheme(), query = useAccountQuery('/api/v1/agent/memories', parseAccountMemories);
  const command = useAccountCommand(session.scopeKey, 'assistant-memory');
  const [preparing, setPreparing] = useState(false), preparingRef = useRef(false), [localError, setLocalError] = useState('');
  const change = async (selected: AccountMemory | null) => {
    if (command.locked || preparingRef.current || !query.value) return;
    const original = query.value; preparingRef.current = true; setPreparing(true); setLocalError('');
    try {
      const assertCurrent = command.capture(), current = await query.refresh(); assertCurrent();
      if (selected ? !current.items.some(item => item.id === selected.id && memoryFingerprint([item]) === memoryFingerprint([selected])) : memoryFingerprint(current.items) !== memoryFingerprint(original.items)) throw new Error('Remembered preferences changed. Review the current list before deleting.');
      await command.run({ path: selected ? accountMemoryDeletePath(selected.id) : '/api/v1/agent/memories', method: 'DELETE' }, { confirm: value => { if (selected) assertMemoryDeleted(value, selected.id); else assertMemoriesCleared(value); return true; }, refresh: query.refresh });
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Memory could not be changed.'); }
    finally { preparingRef.current = false; setPreparing(false); }
  };
  const disabled = command.locked || preparing;
  return <AccountGroup title="Assistant memory" detail="Your stated preferences and app familiarity">
    <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>Preferences for this campus personalize the assistant. Campus records and permissions are always checked live. You can inspect or forget memory with Pro features turned off.</Text>
    {query.isPending ? <Loading /> : query.isError || query.invalid ? <Empty title="Assistant memory could not load" message={query.invalid || query.error?.message} onRetry={() => void query.refresh().catch(() => {})} /> : query.value ? <>
      {!query.value.items.length ? <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>Nothing remembered yet. Only durable preferences you clearly state are saved.</Text> : <>
        <Disclosure title={`${query.value.items.length} remembered ${query.value.items.length === 1 ? 'preference' : 'preferences'}`} defaultOpen>
          {query.value.items.map((item, index) => <View key={item.id} style={{ borderTopWidth: index ? .5 : 0, borderColor: colors.border, paddingVertical: 10, gap: 8 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ flex: 1, minWidth: 0, gap: 5 }}><Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>{memoryCategoryLabel(item.category)}</Text><Text selectable style={{ color: colors.ink, fontSize: 15, lineHeight: 23 }}>{item.content}</Text></View><ControlButton title="Forget" kind="danger" disabled={disabled} onPress={() => void change(item)} /></View></View>)}
        </Disclosure>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>{query.value.budget.used_tokens.toLocaleString()} of {query.value.budget.max_tokens.toLocaleString()} memory tokens</Text><ControlButton title="Clear memory" kind="danger" disabled={disabled} onPress={() => Alert.alert('Clear remembered preferences?', 'This removes your assistant memory for this campus, across its assistant contexts. Your campus records and conversation history stay available.', [{ text: 'Keep memory', style: 'cancel' }, { text: 'Clear memory', style: 'destructive', onPress: () => void change(null) }])} /></View>
      </>}
    </> : null}
    {localError ? <Notice tone="warning" message={localError} /> : null}
    <AccountCommandFeedback command={command} refresh={query.refresh} allowNewChoice />
    <InfoDisclosure title="What memory can contain"><Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>Communication preferences, recurring app workflows and your stated app familiarity. Memory does not grant access or replace current campus evidence.</Text></InfoDisclosure>
  </AccountGroup>;
}
