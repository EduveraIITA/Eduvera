import type { ComponentRef } from 'react';
import type { View } from 'react-native';

export type CopilotTargetNode = ComponentRef<typeof View>;
export type CopilotRect = { x: number; y: number; width: number; height: number };

export function copilotRect(x: number, y: number, width: number, height: number): CopilotRect | undefined {
  if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) {
    return { x: Math.round(x), y: Math.round(y), width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }
}

export function measureCopilotTarget(node: CopilotTargetNode, signal?: AbortSignal): Promise<CopilotRect | undefined> {
  if (signal?.aborted) return Promise.resolve(undefined);
  const web = node as unknown as { getBoundingClientRect?: () => DOMRect };
  if (typeof web.getBoundingClientRect === 'function') {
    const { left, top, width, height } = web.getBoundingClientRect();
    return Promise.resolve(copilotRect(left, top, width, height));
  }
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(undefined), 160);
    node.measureInWindow((x, y, width, height) => {
      clearTimeout(timer);
      resolve(signal?.aborted ? undefined : copilotRect(x, y, width, height));
    });
  });
}

const BADGE = 36;
const EDGE_PADDING = 6;

/** Position in the overlay host, at the center of the visible part of the target.
 * Leave a gap so the pointer never obscures the button or text field it marks. */
export function copilotIndicator(target: CopilotRect, frame: CopilotRect) {
  const left = Math.max(0, target.x - frame.x);
  const top = Math.max(0, target.y - frame.y);
  const right = Math.min(frame.width, target.x + target.width - frame.x);
  const bottom = Math.min(frame.height, target.y + target.height - frame.y);
  if (right <= left || bottom <= top || frame.width < BADGE + 2 * EDGE_PADDING || frame.height < BADGE) return;
  const below = top < BADGE + 9 && bottom + BADGE + 5 <= frame.height;
  const x = Math.max(EDGE_PADDING, Math.min(frame.width - BADGE - EDGE_PADDING, (left + right - BADGE) / 2));
  const y = Math.max(0, Math.min(frame.height - BADGE, below ? bottom + 5 : top - BADGE - 5));
  const outline = right - left >= 22 && bottom - top >= 18 ? { left, top, width: right - left, height: bottom - top } : undefined;
  return { x, y, below, outline };
}

export function copilotWait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}
