import { Group, Rect } from "react-konva";
import type { RepresentativeSeat, RoomCapacityPresentation } from "./roomOccupancy";

const seatPalette = {
  planned: { fill: "#d9e6fa", stroke: "#5f8fd8" },
  unconfirmed: { fill: "#f8fafc", stroke: "#aeb9c7" },
} as const;

const MAX_VISIBLE_SEATS = 16;

export interface SeatGridLayout {
  columns: number;
  rows: number;
  gap: number;
  aisleAfterColumn: number | null;
  aisleWidth: number;
  seatWidth: number;
  seatHeight: number;
  originX: number;
  originY: number;
}

export function representativeSeatsForDisplay(seats: RepresentativeSeat[], maximum = MAX_VISIBLE_SEATS): RepresentativeSeat[] {
  if (seats.length <= maximum) return seats;
  const totalPlanned = seats.filter((seat) => seat.state === "planned").length;
  const visibleCount = Math.max(1, maximum);
  const visiblePlanned = Math.round((totalPlanned / seats.length) * visibleCount);
  return Array.from({ length: visibleCount }, (_, index) => ({
    key: `representative-seat:${index + 1}`,
    state: index < visiblePlanned ? "planned" : "unconfirmed",
  }));
}

export function seatGridLayout(total: number, x: number, y: number, width: number, height: number): SeatGridLayout | null {
  if (total <= 0 || width <= 0 || height <= 0) return null;
  const columns = total <= 8 ? Math.min(4, total) : total <= 12 ? 6 : 8;
  const rows = Math.ceil(total / columns);
  const gap = height < 40 ? 2 : 3;
  const aisleAfterColumn = columns >= 6 ? Math.floor(columns / 2) : null;
  const aisleWidth = aisleAfterColumn === null ? 0 : gap * 2;
  const horizontalGaps = gap * Math.max(0, columns - 1) + aisleWidth;
  const seatWidth = Math.max(5, Math.min(14, (width - horizontalGaps) / columns));
  const seatHeight = Math.max(5, Math.min(10, (height - gap * Math.max(0, rows - 1)) / rows));
  const patternWidth = columns * seatWidth + horizontalGaps;
  const patternHeight = rows * seatHeight + Math.max(0, rows - 1) * gap;
  return {
    columns,
    rows,
    gap,
    aisleAfterColumn,
    aisleWidth,
    seatWidth,
    seatHeight,
    originX: x + Math.max(0, (width - patternWidth) / 2),
    originY: y + Math.max(0, (height - patternHeight) / 2),
  };
}

export function RoomSeatPattern({ presentation, x, y, width, height }: {
  presentation: RoomCapacityPresentation;
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const seats = representativeSeatsForDisplay(presentation.seats);
  const layout = seatGridLayout(seats.length, x, y, width, height);
  if (!layout) return null;

  return <Group listening={false} clipX={x} clipY={y} clipWidth={width} clipHeight={height}>{seats.map((seat, index) => {
    const column = index % layout.columns;
    const row = Math.floor(index / layout.columns);
    const aisleOffset = layout.aisleAfterColumn !== null && column >= layout.aisleAfterColumn ? layout.aisleWidth : 0;
    const left = layout.originX + column * (layout.seatWidth + layout.gap) + aisleOffset;
    const top = layout.originY + row * (layout.seatHeight + layout.gap);
    const colors = seatPalette[seat.state];
    const backHeight = Math.max(2, Math.min(3, layout.seatHeight * .3));
    return <Group key={seat.key}>
      <Rect x={left + 1} y={top} width={Math.max(2, layout.seatWidth - 2)} height={backHeight} cornerRadius={1}
        fill={colors.stroke} opacity={seat.state === "planned" ? .72 : .48} listening={false} />
      <Rect x={left} y={top + backHeight + 1} width={layout.seatWidth} height={Math.max(2, layout.seatHeight - backHeight - 1)} cornerRadius={2}
        fill={colors.fill} stroke={colors.stroke} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
    </Group>;
  })}</Group>;
}
