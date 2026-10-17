import { describe, expect, it } from "vitest";
import { floorOptions, mapDisplayDimension, schematicElements, strongestDimension } from "./geometry";
import type { CampusViewSpace } from "./types";

const room = (id: string, name: string, overrides: Partial<CampusViewSpace> = {}): CampusViewSpace => ({
  id,
  campus_id: "campus-1",
  parent_space_id: null,
  floor_id: "",
  floor_label: "",
  name,
  code: name.replace(/\s/gu, "-"),
  kind: "classroom",
  capacity: 30,
  assertions: { expected: [], observed: [], accepted: [] },
  expected_now: [],
  day_activity_count: 0,
  gate_activity_today: null,
  state_dimension: "unknown",
  signal_count: 0,
  ...overrides,
});

describe("campus view schematic projection", () => {
  it("groups rooms by explicit floor and otherwise labels only the room-number series", () => {
    const floors = floorOptions([
      room("room-201", "Classroom 201"),
      room("room-202", "Classroom 202"),
      room("room-library", "Library", { floor_id: "floor-ground", floor_label: "Ground floor" }),
    ]);
    expect(floors.map((floor) => [floor.label, floor.spaces.map((space) => space.id)])).toEqual([
      ["Whole campus", ["room-201", "room-202", "room-library"]],
      ["Ground floor", ["room-library"]],
      ["Rooms 200–299", ["room-201", "room-202"]],
    ]);
  });

  it("creates one stable, selectable room shape per real space", () => {
    const spaces = [room("room-201", "Classroom 201"), room("room-202", "Classroom 202")];
    const elements = schematicElements(spaces);
    expect(elements).toHaveLength(2);
    expect(new Set(elements.map((element) => element.space_id))).toEqual(new Set(["room-201", "room-202"]));
    expect(elements.every((element) => element.width > 0 && element.height > 0)).toBe(true);
  });

  it("never upgrades expected activity into an observation", () => {
    const expected = room("room-201", "Classroom 201", { assertions: { expected: [{ id: "slot", dimension: "expected", label: "Mathematics", source_label: "Timetable", freshness: "not_applicable" }], observed: [], accepted: [] } });
    expect(strongestDimension(expected)).toBe("expected");
  });

  it("keeps point-in-time evidence historical until a rule makes it current", () => {
    const historical = room("gate", "North gate", { assertions: { expected: [], observed: [], accepted: [{ id: "scan", dimension: "accepted", label: "Gate entry", source_label: "Gate reader", freshness: "historical" }] } });
    expect(strongestDimension(historical)).toBe("unknown");
  });

  it("keeps a development expectation additive instead of masking current evidence", () => {
    const observed = room("room-201", "Classroom 201", { assertions: { expected: [], observed: [{ id: "sensor", dimension: "observed", label: "Room sensor", source_label: "Registered sensor", freshness: "fresh", spatial_claim: "bounded_space_presence" }], accepted: [] } });
    expect(mapDisplayDimension(observed, "expected")).toBe("observed");
    expect(mapDisplayDimension(room("room-202", "Classroom 202"), "expected")).toBe("expected");
  });
});
