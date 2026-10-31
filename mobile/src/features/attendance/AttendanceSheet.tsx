import type { PropsWithChildren } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { MotionModal as Modal } from '../../ui/Motion';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ControlButton } from '../../ui/DomainControls';
import { ExecutionBanner } from '../../ui/ExecutionBanner';
import { useTheme } from '../../ui/theme';

/** A native read/form sheet leaves its owning register and journal mounted. */
export function AttendanceSheet({ visible, title, onClose, children, busy = false }: PropsWithChildren<{ visible: boolean; title: string; onClose: () => void; busy?: boolean }>) {
  const { colors } = useTheme();
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { if (!busy) onClose(); }}><SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
    <ExecutionBanner />
    <View style={{ paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: .5, borderColor: colors.border }}><Text accessibilityRole="header" style={{ flex: 1, color: colors.ink, fontSize: 20, lineHeight: 28, fontWeight: '600' }}>{title}</Text><ControlButton title="Done" disabled={busy} onPress={onClose} /></View>
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 36, gap: 12 }}>{children}</ScrollView>
  </SafeAreaView></SafeAreaProvider></Modal>;
}
