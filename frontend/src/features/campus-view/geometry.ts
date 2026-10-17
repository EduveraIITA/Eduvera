import type { CampusFloorOption, CampusPlanElement, CampusViewSpace } from "./types";

export const CAMPUS_VIEW_BOX = { x: 0, y: 0, width: 760, height: 920 } as const;

const FLOOR_NUMBER = /(?:room|classroom|lab(?:oratory)?|floor|level)?\s*[-:]?\s*([1-9])\d{2}\b/iu;

function inferredFloor(space: CampusViewSpace, spacesById: Map<string, CampusViewSpace>) {
  let current = space.parent_space_id ? spacesById.get(space.parent_space_id) : undefined;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.kind === "floor") return { id: current.id, label: current.name };
    current = current.parent_space_id ? spacesById.get(current.parent_space_id) : undefined;
  }
  const number = `${space.name} ${space.code}`.match(FLOOR_NUMBER)?.[1];
  if (number) return { id: `room-series-${number}`, label: `Rooms ${number}00–${number}99` };
  return { id: "campus-level", label: "Campus" };
}

export function floorOptions(spaces: CampusViewSpace[]): CampusFloorOption[] {
  const spacesById = new Map(spaces.map((space) => [space.id, space]));
  const structural = new Set(["building", "wing", "floor"]);
  const result = new Map<string, CampusFloorOption>();
  const overviewSpaces: CampusViewSpace[] = [];
  for (const original of spaces.filter((space) => !structural.has(space.kind))) {
    const floor = original.floor_id && original.floor_label
      ? { id: original.floor_id, label: original.floor_label }
      : inferredFloor(original, spacesById);
    const space = { ...original, floor_id: floor.id, floor_label: floor.label };
    overviewSpaces.push(space);
    const entry = result.get(floor.id) ?? { id: floor.id, label: floor.label, spaces: [] };
    entry.spaces.push(space);
    result.set(floor.id, entry);
  }
  const floors = [...result.values()]
    .map((floor) => ({ ...floor, spaces: floor.spaces.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true })) }))
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));
  return floors.length > 1
    ? [{ id: "campus-overview", label: "Whole campus", spaces: overviewSpaces }, ...floors]
    : floors;
}

export function schematicElements(spaces: CampusViewSpace[]): CampusPlanElement[] {
  if (!spaces.length) return [];
  const top = spaces.filter((_, index) => index % 2 === 0);
  const bottom = spaces.filter((_, index) => index % 2 === 1);
  const startX = 92;
  const endX = 668;
  const gap = 14;
  const row = (items: CampusViewSpace[], y: number, height: number) => {
    const width = Math.min(230, (endX - startX - gap * Math.max(0, items.length - 1)) / Math.max(1, items.length));
    const rowWidth = width * items.length + gap * Math.max(0, items.length - 1);
    const offsetX = startX + Math.max(0, (endX - startX - rowWidth) / 2);
    return items.map((space, index) => ({
      id: `schematic:${space.id}`,
      kind: "space" as const,
      space_id: space.id,
      floor_id: space.floor_id,
      label: space.name,
      x: offsetX + index * (width + gap),
      y,
      width,
      height,
    }));
  };
  return [...row(top, 168, 218), ...row(bottom, 534, 218)];
}

export function activeAssertion(space: CampusViewSpace) {
  return space.assertions.accepted.find((assertion) => assertion.freshness === "fresh")
    ?? space.assertions.observed.find((assertion) => assertion.freshness === "fresh")
    ?? space.assertions.expected[0]
    ?? space.assertions.accepted[0]
    ?? space.assertions.observed[0]
    ?? null;
}

export function strongestDimension(space: CampusViewSpace) {
  if (space.assertions.accepted.some((assertion) => assertion.freshness === "fresh")) return "accepted" as const;
  if (space.assertions.observed.some((assertion) => assertion.freshness === "fresh")) return "observed" as const;
  if (space.assertions.expected.length) return "expected" as const;
  return "unknown" as const;
}

export function mapDisplayDimension(space: CampusViewSpace, overlayDimension?: "expected" | "observed" | "accepted") {
  const evidence = strongestDimension(space);
  return evidence === "unknown" && overlayDimension === "expected" ? "expected" as const : evidence;
}
