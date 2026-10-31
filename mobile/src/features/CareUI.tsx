import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { ControlButton, Disclosure } from '../ui/DomainControls';
import { Empty, Loading, Notice } from '../ui/components';
import { useTheme } from '../ui/theme';
import type { CareReference } from '../lib/care-command';
import type { useCareJournal } from '../lib/use-care-native';
import type { CareReceipt, CareWorkspace } from '../lib/care-native';
export type CareController = ReturnType<typeof useCareJournal>;
export interface CarePaneProps { schoolId: string; scopeKey: string; href: string; controller: CareController; workspace: CareWorkspace; available: boolean; refreshWorkspace(): Promise<CareWorkspace>; onNavigate(href: string): void; onSavedNavigate(href: string): void; now(): string; today: string }
export function CareText({ children }: { children: React.ReactNode }) { const { colors } = useTheme(); return <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>{children}</Text>; }
export function CareSafety() { const [failed, setFailed] = useState(false); return <View style={{ gap: 6 }}><Notice tone="warning" message="Immediate danger? Call 112 now. Do not wait for this form or an in-app response. Follow the institution’s approved police, SJPU, Child Helpline or emergency procedure." /><ControlButton title="Call 112" onPress={() => { setFailed(false); void Linking.openURL('tel:112').catch(() => setFailed(true)); }} />{failed ? <Notice tone="warning" message="This device could not open the phone app. Use an available phone and follow the approved emergency procedure." /> : null}</View>; }
export function CareUnavailable({ error, retry, pending = false }: { error?: Error | null; retry(): void; pending?: boolean }) { return <Empty title="Protected care is unavailable" message={pending ? 'A protected save is still awaiting confirmation. Its exact receipt remains available to check; current access controls case details.' : error?.message || 'Your current protected assignment and staff access must be confirmed.'} onRetry={retry} />; }
export function CareRecovery({ controller, reference, accepted, resume }: { controller: CareController; reference: CareReference; accepted(receipt: CareReceipt, reference: CareReference): Promise<void> | void; resume?: () => void }) {
  const retry = controller.retryReady.includes(reference.commandId) && controller.journal.hasPrivate(reference);
  return <View style={{ gap: 8 }}><Notice tone="warning" message={reference.phase === 'accepted' ? 'Saved. Refresh checks the recorded result/current access without sending the protected details again.' : 'Protected save awaiting confirmation. Check this exact result before starting a replacement.'} />
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><ControlButton title={reference.phase === 'accepted' ? 'Refresh saved record' : 'Check exact result'} busy={controller.busy} onPress={() => void controller.journal.check(reference.commandId, controller.context(accepted))} />{retry ? <ControlButton title="Retry exact save" disabled={controller.busy || controller.blocked} onPress={() => void controller.journal.retry(reference.commandId, controller.context(accepted))} /> : null}{resume ? <ControlButton title="Resume this save" disabled={controller.busy} onPress={resume} /> : null}</View><Disclosure title="Protected save reference"><CareText>{reference.commandId}</CareText></Disclosure></View>;
}
export function CareReadState({ pending, error, retry }: { pending: boolean; error?: Error | null; retry(): void }) { return pending ? <Loading /> : <CareUnavailable error={error} retry={retry} />; }
