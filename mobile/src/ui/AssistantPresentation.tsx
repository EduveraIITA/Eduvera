import { useCallback, useLayoutEffect } from 'react';
import { useRoute } from 'expo-router';
import { useSession } from '../auth/SessionProvider';
import { useOperationContext } from '../lib/use-operation-context';
import { useCampusNavigation } from './BackNavigation';
import { useAssistantPresentationState } from './assistant-presentation-context';
export { AssistantPresentationProvider } from './assistant-presentation-context';
export type { AssistantFrame } from './assistant-presentation-context';

export function useAssistantPresentation(options: { available?: boolean } = {}) {
  const presentation = useAssistantPresentationState(), route = useRoute(), { scopeKey } = useSession();
  const { onAssistantNavigate,assistantIntent } = useCampusNavigation();
  useLayoutEffect(() => { if (options.available === false && presentation.expanded) { if (presentation.mode === 'split') presentation.close(route.key,scopeKey,presentation.entryToken); else presentation.setExpanded(route.key,scopeKey,false,presentation.entryToken); } },[options.available,presentation.expanded,presentation.mode,route.key,scopeKey]);
  const setExpanded = (value: boolean) => { if (value && options.available === false) return; presentation.setExpanded(route.key,scopeKey,value,presentation.entryToken); };
  const canonical = (href: string,force: boolean) => {
    if (!force && href === presentation.href && presentation.active) return;
    const previous = new URL(presentation.href,'https://thatcampus.invalid'), next = new URL(href,'https://thatcampus.invalid');
    const commit = () => presentation.open(route.key,scopeKey,href,force);
    if (previous.searchParams.get('student_id') !== next.searchParams.get('student_id')) assistantIntent(commit); else commit();
  };
  return { active: presentation.active,entryToken: presentation.entryToken,requestRevision: presentation.requestRevision,href: presentation.href,frame: presentation.frame,mode: presentation.mode,splitAxis: presentation.splitAxis,
    expanded: presentation.expanded && options.available !== false,setExpanded,expand: () => setExpanded(true),collapse: () => setExpanded(false),
    close: () => presentation.close(route.key,scopeKey,presentation.entryToken),canClose: !presentation.canonical,
    open: () => presentation.open(route.key,scopeKey),
    openCanonical: (href: string) => canonical(href,false),requestCanonical: (href: string) => canonical(href,true),
    captureOperation: (_source?: string) => presentation.captureOperation(presentation.entryToken),onNavigate: (href: string) => { try { presentation.captureOperation(presentation.entryToken)(); } catch { return; } onAssistantNavigate(href); } };
}
/** Exact owning conversation source + scope/focus/AppState/API + overlay entry.
 * Expansion is lossless; close/tab/source/account changes invalidate the lease. */
export function useAssistantOperationContext(source: string) {
  const captureSource = useOperationContext(source), presentation = useAssistantPresentationState();
  return useCallback(() => { const assertSource = captureSource(), assertOverlay = presentation.captureOperation(presentation.entryToken); return () => { assertSource(); assertOverlay(); }; },[captureSource,presentation.captureOperation,presentation.entryToken]);
}
