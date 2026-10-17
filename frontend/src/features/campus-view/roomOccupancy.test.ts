import { describe, expect, it } from "vitest";
import { plannedHeadcount, roomCapacityPresentation, supportsSeatPattern } from "./roomOccupancy";

describe("room occupancy presentation", () => {
  it("renders expected headcount as planned, never as physical occupancy", () => {
    const result = roomCapacityPresentation("room-401", 40, 25);

    expect(result?.compactLabel).toBe("25 expected · 40 seats");
    expect(result?.accessibleSummary).toContain("plan, not physical occupancy");
    expect(result?.seats.filter((seat) => seat.state === "planned")).toHaveLength(25);
    expect(result?.seats.filter((seat) => seat.state === "unconfirmed")).toHaveLength(15);
  });

  it("flags planned demand above capacity without creating extra seat identities", () => {
    const result = roomCapacityPresentation("room-301", 40, 45);

    expect(result?.compactLabel).toBe("45 expected · 40 seats · 5 over");
    expect(result?.overflowCount).toBe(5);
    expect(result?.seats).toHaveLength(40);
  });

  it("keeps capacity-only rooms unconfirmed and bounds dense visual matrices", () => {
    const result = roomCapacityPresentation("auditorium", 250);

    expect(result?.compactLabel).toBe("250 seats · current use unknown");
    expect(result?.seats).toHaveLength(60);
    expect(result?.seats.every((seat) => seat.state === "unconfirmed")).toBe(true);
  });

  it("omits the matrix when capacity has not been configured", () => {
    expect(roomCapacityPresentation("room-x", null)).toBeNull();
  });

  it("scales a dense representative matrix instead of implying the first sixty places are all planned", () => {
    const result = roomCapacityPresentation("auditorium", 250, 120);

    expect(result?.seats).toHaveLength(60);
    expect(result?.seats.filter((seat) => seat.state === "planned")).toHaveLength(29);
    expect(result?.compactLabel).toBe("120 expected · 250 seats");
  });

  it("keeps an explicit zero-person plan distinct from missing headcount", () => {
    expect(roomCapacityPresentation("room-101", 40, 0)?.compactLabel).toBe("0 expected · 40 seats");
    expect(roomCapacityPresentation("room-101", 40)?.compactLabel).toContain("current use unknown");
  });

  it("prefers the current development overlay and skips absent assertion counts", () => {
    expect(plannedHeadcount([undefined, null, 25], 27)).toBe(27);
    expect(plannedHeadcount([undefined, null, 25], null)).toBe(25);
  });

  it("limits seat patterns to spaces where seats communicate useful room capacity", () => {
    expect(supportsSeatPattern("classroom")).toBe(true);
    expect(supportsSeatPattern("laboratory")).toBe(true);
    expect(supportsSeatPattern("auditorium")).toBe(true);
    expect(supportsSeatPattern("gate")).toBe(false);
    expect(supportsSeatPattern("outdoor_area")).toBe(false);
    expect(supportsSeatPattern("sports_area")).toBe(false);
  });
});
