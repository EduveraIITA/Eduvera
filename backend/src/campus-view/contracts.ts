import { createHash } from "node:crypto";
import { z } from "zod";
import type { CampusTemporalAssertion } from "../campus-model-core/temporal-context.port.js";

export const campusViewQuerySchema = z.object({
  school_id: z.string().uuid(),
  campus_id: z.string().uuid().optional(),
  at: z.string().datetime({ offset: true }).optional(),
}).strict();

export type CampusViewQuery = z.infer<typeof campusViewQuerySchema>;

export interface CampusViewSpaceRecord {
  id: string;
  campus_id: string;
  parent_space_id: string | null;
  name: string;
  code: string;
  kind: string;
  capacity: number | null;
  attributes?: unknown;
  revision: number;
}

export interface CampusViewFloorRef {
  floor_id: string | null;
  floor_label: string | null;
}

export type CampusViewDimension = "expected" | "observed" | "accepted" | "unknown";

export interface CampusViewAssertion {
  assertion_id: string;
  dimension: Exclude<CampusViewDimension, "unknown">;
  assertion_type: "scheduled_context" | "direct_observation";
  subject: CampusTemporalAssertion["subject"];
  context: unknown;
  certainty: string;
  valid_from: string | null;
  valid_until: string | null;
  observed_at: string | null;
  recorded_at: string;
  source: {
    kind: "domain_plan" | "domain_observation";
    label: string;
    domain: string;
    record_id: string;
    revision: number | null;
    evidence_id: string;
    captured_by: string | null;
  };
  freshness: {
    status: "current_at_as_of" | "point_in_time";
    as_of: string;
    age_seconds: number | null;
    expires_at: string | null;
  };
  /**
   * This projection never upgrades a plan or point observation into a live
   * location. Consumers must keep this qualifier beside every marker.
   */
  spatial_claim: "expected_context_only" | "point_observation_only";
  target_path?: string;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function observationSourceLabel(assertion: Extract<CampusTemporalAssertion, { assertion_type: "direct_observation" }>): string {
  if (assertion.source.source_type === "gate.movement") return "Gate observation";
  if (assertion.source.source_type === "attendance.capture") return "Attendance observation";
  return "Recorded observation";
}

export function projectTemporalAssertion(assertion: CampusTemporalAssertion, asOf: string): CampusViewAssertion {
  if (assertion.dimension === "expected") {
    return {
      assertion_id: assertion.assertion_id,
      dimension: "expected",
      assertion_type: "scheduled_context",
      subject: assertion.subject,
      context: assertion.context,
      certainty: assertion.certainty,
      valid_from: iso(assertion.valid_from),
      valid_until: iso(assertion.valid_until),
      observed_at: null,
      recorded_at: iso(assertion.recorded_at),
      source: {
        kind: "domain_plan",
        label: assertion.source.event_type === "timetable.day_plan_published" ? "Published day plan" : "Published timetable",
        domain: assertion.source.source_domain,
        record_id: assertion.source.source_record_id,
        revision: assertion.source.source_revision,
        evidence_id: assertion.source.event_id,
        captured_by: null,
      },
      freshness: {
        status: "current_at_as_of",
        as_of: asOf,
        age_seconds: null,
        expires_at: iso(assertion.valid_until),
      },
      spatial_claim: "expected_context_only",
    };
  }

  const observedAt = iso(assertion.observed_at);
  return {
    assertion_id: assertion.assertion_id,
    dimension: assertion.dimension,
    assertion_type: "direct_observation",
    subject: assertion.subject,
    context: assertion.context,
    certainty: assertion.certainty,
    valid_from: null,
    valid_until: null,
    observed_at: observedAt,
    recorded_at: iso(assertion.recorded_at),
    source: {
      kind: "domain_observation",
      label: observationSourceLabel(assertion),
      domain: assertion.source.source_type,
      record_id: assertion.source.source_record_id,
      revision: null,
      evidence_id: assertion.source.observation_id,
      captured_by: assertion.source.captured_by_label,
    },
    freshness: {
      status: "point_in_time",
      as_of: asOf,
      age_seconds: Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(observedAt)) / 1_000)),
      expires_at: null,
    },
    spatial_claim: "point_observation_only",
  };
}

export function strongestDimension(assertions: CampusViewAssertion[]): CampusViewDimension {
  // A point observation remains inspectable evidence, but it does not become a
  // live room state without an explicit, rule-driven validity window.
  if (assertions.some((item) => item.dimension === "accepted" && item.freshness.status === "current_at_as_of")) return "accepted";
  if (assertions.some((item) => item.dimension === "observed" && item.freshness.status === "current_at_as_of")) return "observed";
  if (assertions.some((item) => item.dimension === "expected")) return "expected";
  return "unknown";
}

export function floorForSpace(
  space: CampusViewSpaceRecord,
  spacesById: ReadonlyMap<string, CampusViewSpaceRecord>,
): CampusViewFloorRef {
  let current: CampusViewSpaceRecord | undefined = space;
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.kind === "floor") return { floor_id: current.id, floor_label: current.name };
    current = current.parent_space_id ? spacesById.get(current.parent_space_id) : undefined;
  }
  return { floor_id: null, floor_label: null };
}

export interface GeneratedPlanElement extends CampusViewFloorRef {
  id: string;
  kind: "space";
  space_kind: string;
  space_id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function schematicHint(attributes: unknown) {
  if (!attributes || typeof attributes !== "object") return null;
  const raw = (attributes as { schematic?: unknown }).schematic;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const x = typeof value.x === "number" ? value.x : Number.NaN;
  const y = typeof value.y === "number" ? value.y : Number.NaN;
  const width = typeof value.width === "number" ? value.width : Number.NaN;
  const height = typeof value.height === "number" ? value.height : Number.NaN;
  if (![x, y, width, height].every(Number.isFinite)
    || x < 0 || y < 0 || width < 24 || height < 24
    || x + width > 5_000 || y + height > 5_000) return null;
  return { x, y, width, height };
}

export function generatedSchematic(campus: { id: string; name: string; revision: number }, spaces: CampusViewSpaceRecord[]) {
  const spacesById = new Map(spaces.map((space) => [space.id, space]));
  const parentIds = new Set(spaces.flatMap((space) => space.parent_space_id ? [space.parent_space_id] : []));
  const renderable = spaces.filter((space) => !parentIds.has(space.id) || !["building", "wing", "floor"].includes(space.kind));
  const grouped = new Map<string, Array<CampusViewSpaceRecord & CampusViewFloorRef>>();
  for (const space of renderable) {
    const floor = floorForSpace(space, spacesById);
    const key = floor.floor_id ?? "unassigned";
    const group = grouped.get(key) ?? [];
    group.push({ ...space, ...floor });
    grouped.set(key, group);
  }

  const margin = 32;
  const gap = 18;
  const roomWidth = 220;
  const roomHeight = 136;
  const elements: GeneratedPlanElement[] = [];
  let maximumColumns = 1;
  let maximumRows = 1;
  for (const group of [...grouped.values()].sort((left, right) => (left[0]?.floor_label ?? "").localeCompare(right[0]?.floor_label ?? ""))) {
    group.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    const columns = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(group.length))));
    const rows = Math.max(1, Math.ceil(group.length / columns));
    maximumColumns = Math.max(maximumColumns, columns);
    maximumRows = Math.max(maximumRows, rows);
    group.forEach((space, index) => elements.push({
      id: `space:${space.id}`,
      kind: "space",
      space_kind: space.kind,
      space_id: space.id,
      label: space.name,
      floor_id: space.floor_id,
      floor_label: space.floor_label,
      ...(schematicHint(space.attributes) ?? {
        x: margin + (index % columns) * (roomWidth + gap),
        y: margin + Math.floor(index / columns) * (roomHeight + gap),
        width: roomWidth,
        height: roomHeight,
      }),
    }));
  }

  const versionInput = [campus.id, campus.revision, ...spaces
    .map((space) => `${space.id}:${space.revision}:${space.parent_space_id ?? "-"}:${JSON.stringify(schematicHint(space.attributes))}`)
    .sort()]
    .join("|");
  const version = createHash("sha256").update(versionInput).digest("hex").slice(0, 16);
  const hinted = elements.some((element) => schematicHint(spacesById.get(element.space_id)?.attributes));
  const contentWidth = hinted ? Math.max(...elements.map((element) => element.x + element.width), 1) + margin : null;
  const contentHeight = hinted ? Math.max(...elements.map((element) => element.y + element.height), 1) + margin : null;
  return {
    id: `generated-schematic:${campus.id}`,
    version,
    label: `${campus.name} schematic`,
    source_kind: "generated_schematic" as const,
    placement_kind: hinted ? "configured_schematic" as const : "generated_grid" as const,
    surveyed: false,
    explanation: hinted
      ? "Generated from configured campus spaces and schematic placement hints. This is not a surveyed floor plan."
      : "Generated from configured campus spaces. This is a schematic, not a surveyed floor plan.",
    view_box: {
      x: 0,
      y: 0,
      width: contentWidth ?? margin * 2 + maximumColumns * roomWidth + (maximumColumns - 1) * gap,
      height: contentHeight ?? margin * 2 + maximumRows * roomHeight + (maximumRows - 1) * gap,
    },
    elements,
  };
}
