import { useCallback, useContext, useRef, type ComponentRef } from 'react';
import { Platform, type ScrollView } from 'react-native';
import { copilotWait, measureCopilotTarget, type CopilotTargetNode } from '../lib/copilot-target';
import { useReducedMotion } from './Motion';
import { NativeDockInsetsContext } from './campus-tabs-options';

/** Scroll the owning Page while leaving input focus and application state alone. */
export function usePageReveal() {
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const reduced = useReducedMotion();
  const { bar, assistant } = useContext(NativeDockInsetsContext);
  const reveal = useCallback(async (node: CopilotTargetNode, signal: AbortSignal) => {
    const scroll = scrollRef.current, viewport = scroll?.getNativeScrollRef();
    if (!scroll || !viewport || signal.aborted) return;
    const [target, frame] = await Promise.all([measureCopilotTarget(node,signal), measureCopilotTarget(viewport,signal)]);
    if (!target || !frame || signal.aborted) return;
    const margin = 16, top = target.y - frame.y;
    const visibleHeight = frame.height - bar - assistant;
    if (visibleHeight <= margin) return;
    const delta = top < margin ? top - margin : Math.max(0, top + target.height - visibleHeight + margin);
    if (!delta) return;
    if (Platform.OS === 'web') {
      const element = viewport as unknown as HTMLElement;
      element.scrollBy({ top: delta, behavior: reduced ? 'instant' : 'smooth' });
    } else {
      const content = scroll.getInnerViewRef();
      if (!content) return;
      const moved = await new Promise<boolean>(resolve => {
        const timer = setTimeout(() => resolve(false), 160);
        node.measureLayout(content, (_x, y, _width, _height) => {
          clearTimeout(timer);
          if (!signal.aborted && Number.isFinite(y)) {
            scroll.scrollTo({ y: Math.max(0, y - top + delta), animated: !reduced });
            resolve(true);
          } else resolve(false);
        }, () => { clearTimeout(timer); resolve(false); });
      });
      if (!moved) return;
    }
    await copilotWait(reduced ? 30 : 330,signal);
  }, [assistant, bar, reduced]);
  return { scrollRef, reveal };
}
