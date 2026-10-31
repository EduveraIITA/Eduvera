export interface AssistantLayoutInput {
  width: number; height: number; isPad: boolean; expanded: boolean;
}
export interface AssistantLayoutFrame { width: number; height: number }
export interface AssistantLayout {
  mode: 'compact' | 'fullscreen' | 'split';
  axis: 'horizontal' | 'vertical' | null;
  app: AssistantLayoutFrame;
  chat: AssistantLayoutFrame;
  sidebar: boolean;
}
export const ASSISTANT_SPLIT_DIVIDER = 1;
const APP_MIN_WIDTH = 400, CHAT_MIN_WIDTH = 320, CHAT_MAX_WIDTH = 480;
const SIDEBAR_WIDTH = 244, COMPACT_SIDEBAR_MIN_WIDTH = 900;
const dimension = (value: number) => Number.isFinite(value) ? Math.max(0,value) : 0;
/** Screen-coordinate intersection for the stacked tablet fallback. Resize the
 * two panes together before either footer applies its own residual avoidance. */
export function assistantVisibleHeight(height: number,screenY: number,keyboardTop: number | null) {
  const measured = dimension(height);
  return keyboardTop === null || !Number.isFinite(screenY) || !Number.isFinite(keyboardTop) ? measured : Math.max(0,Math.min(measured,keyboardTop - screenY));
}

/** Layout allocation only. The host measures the real pane frames; keyboard,
 * safe-area and navigation-bar exclusions remain with their existing owners. */
export function assistantLayout(input: AssistantLayoutInput): AssistantLayout {
  const width = dimension(input.width), height = dimension(input.height);
  const landscape = height > 0 && width > height;
  const overlay = (mode: 'compact' | 'fullscreen'): AssistantLayout => ({
    mode,axis: null,app: { width,height },chat: { width,height },
    sidebar: mode === 'compact' && input.isPad && landscape && width >= COMPACT_SIDEBAR_MIN_WIDTH,
  });
  if (!input.expanded) return overlay('compact');
  // An unmeasured/empty frame cannot admit two usable panes. Keep the retained
  // app behind the full overlay until the host has a positive layout.
  if (!input.isPad || width === 0 || height <= ASSISTANT_SPLIT_DIVIDER) return overlay('fullscreen');
  if (width >= APP_MIN_WIDTH + ASSISTANT_SPLIT_DIVIDER + CHAT_MIN_WIDTH) {
    const chatWidth = Math.min(CHAT_MAX_WIDTH,Math.max(CHAT_MIN_WIDTH,width * .4));
    const appWidth = width - ASSISTANT_SPLIT_DIVIDER - chatWidth;
    return {
      mode: 'split',axis: 'horizontal',app: { width: appWidth,height },chat: { width: chatWidth,height },
      sidebar: landscape && appWidth >= SIDEBAR_WIDTH + APP_MIN_WIDTH,
    };
  }
  // Narrow iPad multitasking keeps both owners visible without imposing a
  // minimum height that could exceed the measured host. Each gets equal flex.
  const appHeight = (height - ASSISTANT_SPLIT_DIVIDER) / 2;
  return { mode: 'split',axis: 'vertical',app: { width,height: appHeight },chat: { width,height: height - ASSISTANT_SPLIT_DIVIDER - appHeight },sidebar: false };
}
