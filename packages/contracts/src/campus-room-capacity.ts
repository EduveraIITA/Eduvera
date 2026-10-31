export type RepresentativeSeatState = "planned" | "unconfirmed";

export interface RepresentativeSeat {
  key: string;
  state: RepresentativeSeatState;
}

export interface RoomCapacityPresentation {
  compactLabel: string;
  accessibleSummary: string;
  seats: RepresentativeSeat[];
  overflowCount: number;
}

const MAX_RENDERED_PLACES = 60;

const SEAT_PATTERN_SPACE_KINDS = new Set([
  "auditorium",
  "classroom",
  "laboratory",
  "library",
  "staff_room",
  "workshop",
]);

export function supportsSeatPattern(spaceKind: string) {
  return SEAT_PATTERN_SPACE_KINDS.has(spaceKind.trim().toLowerCase());
}

function count(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function plannedHeadcount(assertionCounts: Array<number | null | undefined>, overlayCount?: number | null) {
  if (typeof overlayCount === "number" && Number.isFinite(overlayCount)) return count(overlayCount);
  const assertionCount = assertionCounts.find((value) => typeof value === "number" && Number.isFinite(value));
  return assertionCount === undefined ? null : count(assertionCount);
}

export function roomCapacityPresentation(spaceId: string, capacityValue: number | null, plannedCountValue?: number | null): RoomCapacityPresentation | null {
  const capacity = capacityValue === null ? null : count(capacityValue);
  if (capacity === null || capacity <= 0) return null;
  const hasPlannedCount = typeof plannedCountValue === "number" && Number.isFinite(plannedCountValue);
  const plannedCount = count(plannedCountValue);
  const planned = Math.min(capacity, plannedCount);
  const overflowCount = Math.max(0, plannedCount - capacity);
  const rendered = Math.min(capacity, MAX_RENDERED_PLACES);
  const renderedPlanned = capacity > rendered ? Math.round((planned / capacity) * rendered) : planned;
  const seats = Array.from({ length: rendered }, (_, index): RepresentativeSeat => {
    const state: RepresentativeSeatState = index < renderedPlanned ? "planned" : "unconfirmed";
    return { key: `${spaceId}:capacity-place:${index + 1}`, state };
  });
  if (hasPlannedCount) {
    const compactLabel = overflowCount
      ? `${plannedCount} expected · ${capacity} seats · ${overflowCount} over`
      : `${plannedCount} expected · ${capacity} seats`;
    return {
      compactLabel,
      accessibleSummary: `${plannedCount} people are expected for a capacity of ${capacity}. This representative pattern is a plan, not physical occupancy.${overflowCount ? ` The plan is ${overflowCount} over capacity.` : ` The remaining ${Math.max(0, capacity - plannedCount)} places are unconfirmed.`}`,
      seats,
      overflowCount,
    };
  }

  return {
    compactLabel: `${capacity} seats · current use unknown`,
    accessibleSummary: `Capacity is ${capacity}. Current room use is unknown, so every representative place is unconfirmed.`,
    seats,
    overflowCount: 0,
  };
}
