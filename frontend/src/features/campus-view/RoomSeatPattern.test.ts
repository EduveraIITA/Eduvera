import { describe, expect, it } from "vitest";
import { representativeSeatsForDisplay, seatGridLayout } from "./RoomSeatPattern";

describe("campus room seat layout", () => {
  it("uses a quiet eight-column classroom grid with a central aisle", () => {
    const layout = seatGridLayout(40, 16, 80, 220, 48);

    expect(layout).toMatchObject({ columns: 8, rows: 5, aisleAfterColumn: 4 });
    expect(layout?.aisleWidth).toBeGreaterThan(layout?.gap ?? 0);
  });

  it("keeps the representative seats inside the supplied map area", () => {
    const layout = seatGridLayout(40, 16, 80, 220, 48);
    expect(layout).not.toBeNull();
    if (!layout) return;

    const lastColumn = layout.columns - 1;
    const lastRow = layout.rows - 1;
    const lastRight = layout.originX
      + lastColumn * (layout.seatWidth + layout.gap)
      + layout.aisleWidth
      + layout.seatWidth;
    const lastBottom = layout.originY + lastRow * (layout.seatHeight + layout.gap) + layout.seatHeight;

    expect(lastRight).toBeLessThanOrEqual(236);
    expect(lastBottom).toBeLessThanOrEqual(128);
  });

  it("does not create a layout when the room has no representative seats", () => {
    expect(seatGridLayout(0, 0, 0, 100, 40)).toBeNull();
  });

  it("limits a dense room to sixteen quiet chair glyphs while preserving the planned ratio", () => {
    const seats = Array.from({ length: 40 }, (_, index) => ({
      key: `seat-${index}`,
      state: index < 26 ? "planned" as const : "unconfirmed" as const,
    }));

    const visible = representativeSeatsForDisplay(seats);

    expect(visible).toHaveLength(16);
    expect(visible.filter((seat) => seat.state === "planned")).toHaveLength(10);
    expect(seatGridLayout(visible.length, 0, 0, 160, 36)).toMatchObject({ columns: 8, rows: 2 });
  });
});
