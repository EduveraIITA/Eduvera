const INTERIOR = 6, MIN_TAB_HEIGHT = 52, MIN_TARGET_WIDTH = 44, ITEM_GAP = 4, MIN_GUTTER = 16, MAX_WIDTH = 560;
const positive = (value: number) => Number.isFinite(value) ? Math.max(0,value) : 0;

/** Insets describe safe control placement, not a hardware corner radius. Keep
 * the tappable row safe while allowing its surrounding glass to extend by its
 * own interior inset. Equal visible side/bottom gutters and nested capsule
 * radii provide continuity without device-name or private screen-radius data. */
export function iosDockGeometry({ width, height = 0, bottom, left = 0, right = 0, count, physicalBottom = true, assistantBubble = false, border = 0 }: {
  width: number; height?: number; bottom: number; left?: number; right?: number; count: number; physicalBottom?: boolean; assistantBubble?: boolean; border?: number;
}) {
  const items = Number.isSafeInteger(count) && count > 0 ? count : 1;
  const available = positive(width), safeBottom = positive(bottom), safeLeft = positive(left), safeRight = positive(right);
  const bottomReserve = physicalBottom ? Math.max(safeBottom,MIN_GUTTER + INTERIOR) : 0;
  const desiredGutter = physicalBottom ? bottomReserve - INTERIOR : MIN_GUTTER;
  const surfaceHeight = positive(height) || MIN_TAB_HEIGHT + INTERIOR * 2;
  // Narrow windows retain full targets before equal visual margins. Side
  // obstruction insets are still enforced by native SafeAreaView maximum edges.
  const effectiveInset = INTERIOR + positive(border);
  const minimumSurfaceWidth = items * MIN_TARGET_WIDTH + (items - 1) * ITEM_GAP + effectiveInset * 2;
  const bubbleSize = assistantBubble ? Math.max(MIN_TARGET_WIDTH + effectiveInset * 2,Math.min(surfaceHeight,available - safeLeft - safeRight - minimumSurfaceWidth - ITEM_GAP)) : 0;
  const controlGap = assistantBubble ? Math.max(ITEM_GAP,Math.min(8,available - Math.max(safeLeft,MIN_GUTTER) - Math.max(safeRight,MIN_GUTTER) - minimumSurfaceWidth - bubbleSize)) : 0;
  const minimumWidth = minimumSurfaceWidth + bubbleSize + controlGap;
  const marginBudget = Math.max(0,available - minimumWidth);
  const horizontal = Math.min(desiredGutter,Math.max(0,Math.min(marginBudget / 2,marginBudget - Math.max(safeLeft,safeRight))));
  const rowWidth = Math.min(MAX_WIDTH,Math.max(0,available - Math.max(safeLeft,horizontal) - Math.max(safeRight,horizontal)));
  const surfaceWidth = Math.max(0,rowWidth - bubbleSize - controlGap);
  const itemWidth = Math.max(0,(surfaceWidth - effectiveInset * 2 - (items - 1) * ITEM_GAP) / items);
  return {
    horizontal, bottomPadding: physicalBottom ? MIN_GUTTER + INTERIOR : 0,
    surfaceBottomMargin: physicalBottom ? -INTERIOR : 0,
    visibleBottomGap: physicalBottom ? bottomReserve - INTERIOR : 0,
    surfaceWidth, itemWidth, surfaceHeight, rowWidth, bubbleSize, controlGap,
    surfaceRadius: Math.min(surfaceHeight,surfaceWidth) / 2,
    selectionRadius: Math.max(0,Math.min(surfaceHeight - effectiveInset * 2,itemWidth) / 2),
    interior: INTERIOR, minimumTabHeight: MIN_TAB_HEIGHT, minimumTargetWidth: MIN_TARGET_WIDTH, gap: ITEM_GAP, maximumWidth: MAX_WIDTH,
  };
}
