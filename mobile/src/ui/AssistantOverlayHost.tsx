import { useEffect } from 'react';
import { BackHandler, Platform, StyleSheet, View } from 'react-native';
import { useAssistantPresentation } from './AssistantPresentation';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AssistantScreen } from '../features/AssistantScreen';
import { useAssistantPresentationState } from './assistant-presentation-context';
import { AssistantOverlayOwnerContext, AssistantOverlayActivityContext } from './assistant-overlay-context';
import { useTheme } from './theme';
import { ExecutionBanner } from './ExecutionBanner';
import type { AssistantLayout } from '../lib/assistant-layout';
import { useSession } from '../auth/SessionProvider';
import { Glass } from './Glass';
import { CAMPUS_ASSISTANT_TASK_HREF, useAssistantWorkspaceTask } from './assistant-workspace-task';

/** One native view/body across compact, phone full-screen and tablet split.
 * The real workspace remains mounted; the split keeps it usable alongside chat. */
export function AssistantOverlayHost({ layout,compactInsets = { top: 0,bottom: 0 },onCompactHeightChange }: { layout?: AssistantLayout; compactInsets?: { top: number; bottom: number }; onCompactHeightChange?: (height: number) => void }) {
  const presentation = useAssistantPresentationState(), { colors } = useTheme();
  const actions = useAssistantPresentation();
  const { scopeKey } = useSession(), workspaceTask = useAssistantWorkspaceTask(scopeKey);
  const task = presentation.active && presentation.href === CAMPUS_ASSISTANT_TASK_HREF ? workspaceTask : null;
  const split = presentation.mode === 'split', fullscreen = presentation.mode === 'fullscreen', horizontal = layout?.axis === 'horizontal';
  useEffect(() => {
    if (Platform.OS !== 'android' || !presentation.active) return;
    const listener = BackHandler.addEventListener('hardwareBackPress',() => { if (task) task.onReturn(); else if (fullscreen) actions.collapse(); else if (!split && actions.canClose) actions.close(); else return false; return true; });
    return () => listener.remove();
  },[presentation.active,fullscreen,split,presentation.entryToken,actions.canClose,task]);
  if (!presentation.mounted) return null;
  return <View collapsable={false} pointerEvents={presentation.active ? 'box-none' : 'none'} accessibilityElementsHidden={!presentation.active} importantForAccessibility={presentation.active ? 'auto' : 'no-hide-descendants'} accessibilityViewIsModal={fullscreen} style={[split ? { position: 'relative',flex: 0,width: horizontal && layout ? layout.chat.width + 1 : '100%',height: horizontal ? '100%' : layout ? layout.chat.height + 1 : undefined,borderLeftWidth: horizontal ? 1 : 0,borderTopWidth: horizontal ? 0 : 1,borderColor: colors.border } : { position: 'absolute',top: fullscreen ? 0 : compactInsets.top,right: 0,bottom: fullscreen ? 0 : compactInsets.bottom,left: 0 },{ minWidth: 0,minHeight: 0,display: presentation.active ? 'flex' : 'none',backgroundColor: split ? colors.canvas : 'transparent' }]}>
    {fullscreen ? <Glass material="assistantBackdrop" pointerEvents="none" accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill} /> : null}
    <SafeAreaView pointerEvents="box-none" edges={presentation.expanded ? split ? horizontal ? ['top','right','bottom'] : ['right','bottom','left'] : ['top','right','bottom','left'] : ['left','right']} style={{ flex: 1,minHeight: 0 }}>
      <AssistantOverlayOwnerContext.Provider value><AssistantOverlayActivityContext.Provider value={presentation.active}><View pointerEvents="box-none" style={{ flex: 1,minHeight: 0 }}>{presentation.expanded ? <ExecutionBanner /> : null}<View collapsable={false} pointerEvents="box-none" style={{ flex: 1,minHeight: 0 }} onLayout={({ nativeEvent: { layout } }) => presentation.setFrame({ width: layout.width,height: layout.height })}><AssistantScreen href={task ? presentation.href.split('?')[0]! : presentation.href} onNavigate={actions.onNavigate}
        onCompactHeightChange={onCompactHeightChange} workspaceTask={task} /></View></View></AssistantOverlayActivityContext.Provider></AssistantOverlayOwnerContext.Provider>
    </SafeAreaView>
  </View>;
}
