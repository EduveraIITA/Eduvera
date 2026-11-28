import { useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { CaretLeftIcon } from 'phosphor-react-native/src/icons/CaretLeft';
import { DotsThreeIcon } from 'phosphor-react-native/src/icons/DotsThree';
import { Button } from '../../ui/components';
import { ControlButton } from '../../ui/DomainControls';
import { ExecutionBanner } from '../../ui/ExecutionBanner';
import { MotionModal } from '../../ui/Motion';
import { useTheme } from '../../ui/theme';
import { useSession } from '../../auth/SessionProvider';
import { assistantEntryAvailable, assistantPerspective } from '../../lib/assistant-access';
import { assistantPresentationPermitted } from '../../lib/assistant-presentation-policy';
import { ApiError } from '../../lib/api';
import { useApi } from '../../lib/query';
import { useCopilotTarget } from '../../ui/CopilotProvider';
import { NativeDockInsetsContext } from '../../ui/campus-tabs-options';
import { useAssistantPresentation } from '../../ui/AssistantPresentation';
import { CAMPUS_ASSISTANT_TASK_HREF, clearAssistantWorkspaceTask, showAssistantWorkspaceTask } from '../../ui/assistant-workspace-task';

type SetupAction = { label: string; run: () => void };
type SetupProps = {
  campusName: string; phase: 'boundary' | 'layout' | 'facilities' | 'publication' | 'interior';
  map: ReactNode; feedback?: ReactNode; guidance?: ReactNode; mapTools?: ReactNode;
  assistantGuidance?: (backToMap: () => void, inAssistant: boolean) => ReactNode; autoOpenAssistant?: boolean;
  featureCount?: number; layoutDetail?: string; onClose: () => void; locked?: boolean;
  options: SetupAction[]; primary?: SetupAction; secondary?: SetupAction;
};

export function CampusSetupWorkspace({ campusName, phase, map, feedback, guidance, mapTools, featureCount = 0, layoutDetail, assistantGuidance, autoOpenAssistant,
  onClose, locked, options, primary, secondary }: SetupProps) {
  const focused = useIsFocused();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [menu, setMenu] = useState(false);
  const wide = width >= 840;
  const session = useSession(), assistant = useAssistantPresentation();
  const dock = useContext(NativeDockInsetsContext);
  const taskEligible = !!assistantGuidance && assistantEntryAvailable(session.environment, true,
    assistantPerspective(session.user, session.memberships, session.schoolId));
  const preference = useApi<unknown>(taskEligible ? '/api/v1/auth/pro-features/' : null);
  const canUseAssistant = assistantPresentationPermitted(taskEligible, preference.data,
    preference.error instanceof ApiError ? preference.error.status : undefined);
  const [taskRequested, setTaskRequested] = useState(false);
  const taskOwner = useRef(Symbol('campus-workspace')), autoOpened = useRef(false), viewedTask = useRef(false);
  const taskVisible = !!assistantGuidance && focused && canUseAssistant && taskRequested && assistant.active && assistant.href === CAMPUS_ASSISTANT_TASK_HREF;
  const closeAssistant = () => {
    clearAssistantWorkspaceTask(taskOwner.current);
    setTaskRequested(false);
    if (assistant.active && assistant.href === CAMPUS_ASSISTANT_TASK_HREF) assistant.collapse();
  };
  const launchAssistant = () => {
    if (!focused || !canUseAssistant) return;
    setTaskRequested(true);
    assistant.requestCanonical(CAMPUS_ASSISTANT_TASK_HREF);
  };
  const visibleInApp = focused && assistant.active && assistant.mode !== 'fullscreen';
  const campusTarget = useCopilotTarget('open_virtual_campus', { enabled: visibleInApp && phase !== 'interior', stage: 'after' });
  const layoutTarget = useCopilotTarget('open_campus_layout', { enabled: visibleInApp && phase !== 'interior', stage: 'after' });
  const interiorsTarget = useCopilotTarget('open_campus_interiors', { enabled: visibleInApp && phase === 'interior', stage: 'after' });
  const title = phase === 'facilities' ? 'Set up facilities' : phase === 'publication' ? 'Review and publish' : phase === 'interior' ? 'Map building interiors' : 'Virtual campus';
  useLayoutEffect(() => {
    if (taskVisible && assistantGuidance) {
      viewedTask.current=true;
      showAssistantWorkspaceTask({ owner:taskOwner.current, scopeKey:session.scopeKey, title:`${title} · ${campusName}`,
        content:assistantGuidance(closeAssistant,true), onReturn:closeAssistant });
    } else {
      clearAssistantWorkspaceTask(taskOwner.current);
      if (viewedTask.current) { viewedTask.current=false;setTaskRequested(false); }
    }
  });
  useLayoutEffect(() => {
    const owner=taskOwner.current;
    return () => clearAssistantWorkspaceTask(owner);
  },[]);
  useLayoutEffect(() => {
    if (!autoOpenAssistant) { autoOpened.current=false; return; }
    if (!autoOpened.current && focused && canUseAssistant) {
      autoOpened.current=true;
      launchAssistant();
    }
  },[autoOpenAssistant,focused,canUseAssistant]);
  const workspaceGuidance = <>{guidance}{assistantGuidance ? canUseAssistant
    ? <Button title="Continue in Assistant" disabled={locked} onPress={launchAssistant} />
    : assistantGuidance(() => {},false) : null}</>;
  const hasGuidance = !!guidance || !!assistantGuidance;
  const close = () => {
    if (menu) { setMenu(false); return; }
    if (!locked) onClose();
  };
  const backLabel = hasGuidance ? 'Back to campus layout' : 'Close campus setup';
  const inline = assistant.active && focused;
  const content = <SafeAreaProvider>
      <SafeAreaView style={[styles.shell, { backgroundColor: colors.canvas }]} edges={inline ? [] : ['top', 'left', 'right', 'bottom']}>
        <KeyboardAvoidingView style={styles.shell} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View accessibilityViewIsModal style={styles.shell}>
            <ExecutionBanner />
            <View style={[styles.header, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Pressable accessibilityRole="button" accessibilityLabel={backLabel} disabled={locked}
                onPress={close} style={styles.icon}><CaretLeftIcon size={22} color={colors.ink} /></Pressable>
              <View ref={node => {
                if (phase === 'interior') interiorsTarget(node);
                else { campusTarget(node); layoutTarget(node); }
              }} collapsable={false} style={styles.titleGroup}>
                <Text accessibilityRole="header" aria-level={1} style={[styles.title, { color: colors.ink }]}>{title}</Text>
                <Text numberOfLines={1} style={[styles.subtitle, { color: colors.muted }]}>{campusName}</Text>
              </View>
              {options.length ? <Pressable accessibilityRole="button" accessibilityLabel="More setup options"
                accessibilityState={{ expanded: menu }} disabled={locked} onPress={() => setMenu(value => !value)}
                style={styles.icon}><DotsThreeIcon size={25} weight="bold" color={colors.ink} /></Pressable> : null}
            </View>
            {menu && options.length ? <View style={[styles.menu, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {options.map(option => <ControlButton key={option.label} title={option.label} disabled={locked}
                onPress={() => { setMenu(false); option.run(); }} />)}
            </View> : null}
            {feedback ? <View style={styles.feedback}>{feedback}</View> : null}
            <View style={[styles.body, wide && hasGuidance ? styles.split : null]}>
              <View style={styles.map}>
                {map}
                {mapTools ? <View pointerEvents="box-none" style={[styles.tools, { backgroundColor: colors.surface, borderColor: colors.border }]}>{mapTools}</View> : null}
              </View>
              {hasGuidance ? <ScrollView style={[styles.guide, wide ? styles.guideWide : styles.guideCompact,
                { backgroundColor: colors.surface, borderColor: colors.border }]}
                keyboardShouldPersistTaps="handled" contentContainerStyle={styles.guideContent}>{workspaceGuidance}</ScrollView> : null}
            </View>
            {phase === 'layout' ? <View style={[styles.footer, { backgroundColor: colors.surface, borderColor: colors.border }, wide && styles.footerWide]}>
              <View style={styles.titleGroup}>
                <Text accessibilityRole="header" aria-level={2} style={[styles.layoutTitle, { color: colors.ink }]}>Your campus layout</Text>
                <Text style={[styles.subtitle, { color: colors.muted }]}>{layoutDetail ?? (featureCount ? `${featureCount} mapped ${featureCount === 1 ? 'feature' : 'features'}` : 'No features were found inside this boundary')}</Text>
              </View>
              <View style={[styles.actions, wide && styles.actionsWide]}>
                {secondary ? <Button title={secondary.label} kind="secondary" disabled={locked} onPress={secondary.run} /> : null}
                {primary ? <Button title={primary.label} disabled={locked} onPress={primary.run} /> : null}
              </View>
            </View> : null}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>;
  // A native modal sits above the workspace window. Keep the real map in the
  // current workspace while Assistant is open so both surfaces stay usable.
  if (inline) return <View style={[styles.shell, dock.assistant > 0 && { paddingBottom: dock.bar + dock.assistant }]}>{content}</View>;
  return <MotionModal visible={focused && !taskVisible} animationType="fade" presentationStyle="fullScreen" onRequestClose={close}>{content}</MotionModal>;
}

const styles = StyleSheet.create({
  shell: { flex: 1, minHeight: 0 },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, zIndex: 2 },
  icon: { width: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  titleGroup: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 18, lineHeight: 23, fontWeight: '700' },
  subtitle: { fontSize: 14, lineHeight: 20 },
  menu: { position: 'absolute', zIndex: 5, right: 12, top: 60, minWidth: 190, maxWidth: '90%', padding: 8, borderRadius: 16, borderWidth: 1 },
  feedback: { paddingHorizontal: 16, gap: 8 },
  body: { flex: 1, minHeight: 0 },
  split: { flexDirection: 'row' },
  map: { flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' },
  tools: { position: 'absolute', top: 12, right: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', boxShadow: '0px 2px 8px rgba(0,0,0,0.10)' },
  guide: { flexGrow: 0, borderColor: 'transparent' },
  guideWide: { width: 388, borderLeftWidth: StyleSheet.hairlineWidth },
  guideCompact: { maxHeight: '52%', borderTopWidth: StyleSheet.hairlineWidth },
  guideContent: { padding: 20, gap: 12 },
  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth, gap: 12 },
  footerWide: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24 },
  layoutTitle: { fontSize: 18, lineHeight: 23, fontWeight: '700' },
  actions: { gap: 8 },
  actionsWide: { flexDirection: 'row', alignItems: 'center' },
});
