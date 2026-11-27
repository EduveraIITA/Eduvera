import { useCallback, useContext, useRef, type ComponentRef } from 'react';
import { Platform, type ScrollView } from 'react-native';
import { copilotWait, measureCopilotTarget, type CopilotTargetNode } from '../lib/copilot-target';
import { useReducedMotion } from './Motion';
import { NativeDockInsetsContext } from './campus-tabs-options';

/** Scroll the owning Page while leaving input focus and application state alone. */
export function usePageReveal() {
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const reduced = useReducedMotion();
  const dock = useContext(NativeDockInsetsContext);
  const currentDock = useRef(dock);
  currentDock.current = dock;
  const reveal = useCallback(async (node: CopilotTargetNode, signal: AbortSignal) => {
    const scroll = scrollRef.current, viewport = scroll?.getNativeScrollRef();
    if (!scroll || !viewport || signal.aborted) return;
    for (let pass = 0; pass < 2 && !signal.aborted; pass++) {
      const [target, frame] = await Promise.all([measureCopilotTarget(node,signal), measureCopilotTarget(viewport,signal)]);
      if (!target || !frame || signal.aborted) return;
      const observedDock = currentDock.current;
      const margin = 16, top = target.y - frame.y;
      const visibleHeight = frame.height - observedDock.bar - observedDock.assistant;
      if (visibleHeight <= margin) return;
      const delta = top < margin ? top - margin : Math.max(0, top + target.height - visibleHeight + margin);
      if (!delta) return;
      const animated = !reduced && pass === 0;
      if (Platform.OS === 'web') {
        const element = viewport as unknown as HTMLElement;
        if (pass === 0) element.scrollBy({ top: delta, behavior: animated ? 'smooth' : 'instant' });
        else element.scrollTo({ top: element.scrollTop + delta, behavior: 'instant' });
      } else {
        const content = scroll.getInnerViewRef();
        if (!content) return;
        const moved = await new Promise<boolean>(resolve => {
          const timer = setTimeout(() => resolve(false), 160);
          node.measureLayout(content, (_x, y, _width, _height) => {
            clearTimeout(timer);
            if (!signal.aborted && Number.isFinite(y)) {
              scroll.scrollTo({ y: Math.max(0, y - top + delta), animated });
              resolve(true);
            } else resolve(false);
          }, () => { clearTimeout(timer); resolve(false); });
        });
        if (!moved) return;
      }
      await copilotWait(animated ? 330 : 30,signal);
      if (Platform.OS === 'web' && animated && !signal.aborted) {
        const element = viewport as unknown as HTMLElement;
        // Freeze the compositor before measuring a residual offset. Otherwise
        // a long smooth scroll can advance between measurement and correction.
        element.scrollTo({ top: element.scrollTop, behavior: 'instant' });
        await copilotWait(34,signal);
      }
      // The compact reply can change height while scrolling. Remeasure once
      // and correct only a remaining overlap.
    }
  }, [reduced]);
  return { scrollRef, reveal };
}
