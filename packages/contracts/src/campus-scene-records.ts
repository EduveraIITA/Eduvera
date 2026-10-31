import type { SceneEvidenceRecord } from "./campus-scenes/sceneEvidence.types";
import type { CampusAssertion, CampusExpectedUse, CampusViewOverlay, CampusViewResponse, CampusViewSpace } from "./campus-view";

const instant = (value?: string | null) => value ? Date.parse(value) : NaN;
const within = (at: number, from?: string | null, until?: string | null) => Number.isFinite(at) && Number.isFinite(instant(from)) && Number.isFinite(instant(until)) && instant(from) <= at && at < instant(until);
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

function mirrorsOccurrence(assertion: CampusAssertion, occurrence: CampusExpectedUse) {
  return assertion.id === occurrence.id || assertion.occurrence_id === occurrence.occurrence_id
    || Boolean(assertion.source_domain && assertion.source_record_id
      && assertion.source_domain === occurrence.source.domain && assertion.source_record_id === occurrence.source.record_id
      && instant(assertion.valid_from) === instant(occurrence.starts_at) && instant(assertion.valid_until) === instant(occurrence.ends_at));
}

/** Current source records for map layers. Day lists remain separate from counts. */
export function campusSceneRecords(data: CampusViewResponse, campusId: string): SceneEvidenceRecord[] {
  const records: SceneEvidenceRecord[] = [], at = instant(data.as_of);
  const spaces = data.spaces.filter(space => space.campus_id === campusId);
  for (const space of spaces) {
    const current = space.expected_now.filter(item => item.space_id === space.id && item.state === "in_progress" && within(at, item.starts_at, item.ends_at));
    for (const item of current) records.push({
      id: `expected:${space.id}:${item.id}`, spaceId: space.id, dimension: "expected", title: item.subject_label || item.title,
      detail: [item.class_label, item.teacher ? `Expected: ${item.teacher.label}` : null, "Expected location only; not physical presence."].filter(Boolean).join(" · "),
      sourceLabel: item.source.label, occurredAt: item.starts_at,
      targetPath: item.source.target_path ?? (item.source.domain === "activities" ? "/areas/activities" : "/areas/timetable/planning"),
      temporal: "current", expectedCount: count(item.expected_count),
    });
    for (const dimension of ["expected", "observed", "accepted"] as const) for (const assertion of space.assertions[dimension]) {
      if (dimension === "expected" && (!within(at, assertion.valid_from, assertion.valid_until) || current.some(item => mirrorsOccurrence(assertion, item)))) continue;
      const bounded = within(at, assertion.valid_from, assertion.valid_until);
      const temporal = dimension === "expected" || assertion.spatial_claim === "bounded_space_presence" && bounded ? "current" : "historical";
      records.push({ id: `assertion:${dimension}:${assertion.id}`, spaceId: space.id, dimension, title: assertion.label,
        detail: [assertion.detail, dimension === "expected" ? "Expected location only; not physical presence." : assertion.spatial_claim === "point_observation_only" ? "Point evidence only; not current location." : null].filter(Boolean).join(" · "),
        sourceLabel: assertion.source_label, occurredAt: assertion.observed_at ?? assertion.valid_from ?? undefined,
        targetPath: assertion.target_path ?? undefined, temporal,
        ...(dimension === "expected" ? { expectedCount: count(assertion.count) } : {}),
      });
    }
    if (space.state_dimension === "unknown" && !current.length && !records.some(record => record.spaceId === space.id && record.temporal === "current")) records.push({
      id: `unknown:${space.id}`, spaceId: space.id, dimension: "unknown", title: "No current assertion", detail: "Missing evidence is not evidence of absence.", sourceLabel: "Campus evidence projection", temporal: "unknown",
    });
  }
  for (const item of data.activity) {
    // A day row may be the only current record for an unlocated assignment.
    // Mirrored occurrences have explicit stable IDs; names never deduplicate.
    if (item.state_dimension === "expected") {
      if (item.state !== "in_progress" || !within(at, item.occurred_at, item.ends_at)) continue;
      const mirrored = spaces.some(space => space.id === item.space_id && space.expected_now.some(occurrence => item.id === `schedule:${occurrence.id}` || item.id === `activity:${occurrence.id}`));
      if (!mirrored) records.push({ id: `activity:${item.id}`, spaceId: item.space_id ?? null, dimension: "expected", title: item.title, detail: item.detail, sourceLabel: item.source_label, occurredAt: item.occurred_at, targetPath: item.target_path ?? undefined, temporal: "current" });
      continue;
    }
    // Gate daily summaries also stay in Activity when point assertions already
    // describe that place; aggregate and point records are never added together.
    if (item.state_dimension !== "unknown" && item.space_id && spaces.find(space => space.id === item.space_id)?.assertions[item.state_dimension].length) continue;
    records.push({ id: `activity:${item.id}`, spaceId: item.space_id ?? null, dimension: item.state_dimension, title: item.title, detail: item.detail, sourceLabel: item.source_label, occurredAt: item.occurred_at, targetPath: item.target_path ?? undefined, temporal: item.state_dimension === "unknown" ? "unknown" : "historical" });
  }
  for (const signal of data.signals) records.push({ id: `signal:${signal.id}`, spaceId: null, dimension: "unknown", title: signal.title || "Campus signal needs review", detail: signal.detail, sourceLabel: "Institution-wide cross-check", occurredAt: signal.occurred_at, targetPath: signal.target_path ?? undefined, temporal: "unknown" });
  return [...new Map(records.map(record => [`${record.dimension}:${record.id}`, record])).values()];
}

export function campusActivityTrail(data: CampusViewResponse, overlay?: CampusViewOverlay | null): CampusViewResponse["activity"] {
  const combined = [...(overlay?.activity ?? []), ...data.activity];
  const activity = [...new Map(combined.map(item => [item.id, item])).values()];
  const items: CampusViewResponse["activity"] = [
    ...data.signals.map(signal => ({ id: `signal:${signal.id}`, occurred_at: signal.occurred_at || data.generated_at, title: signal.title || "Campus signal needs review", detail: signal.detail || "Cross-domain evidence needs an operator review.", state_dimension: "unknown" as const, source_label: "Institution-wide cross-check", target_path: signal.target_path })),
    ...activity,
  ];
  const rank = (item: typeof items[number]) => item.id.startsWith("signal:") ? 0 : item.state === "in_progress" ? 1 : item.state === "upcoming" ? 3 : item.state === "ended" ? 4 : 2;
  return items.sort((left, right) => rank(left) - rank(right) || (left.state === "upcoming" ? instant(left.occurred_at) - instant(right.occurred_at) : instant(right.occurred_at) - instant(left.occurred_at)));
}

export function activeSpaceAssertion(space: CampusViewSpace) {
  return space.assertions.accepted.find(assertion => assertion.freshness === "fresh" && assertion.spatial_claim === "bounded_space_presence")
    ?? space.assertions.observed.find(assertion => assertion.freshness === "fresh" && assertion.spatial_claim === "bounded_space_presence")
    ?? space.assertions.expected[0] ?? space.assertions.accepted[0] ?? space.assertions.observed[0] ?? null;
}

export function campusDateFormatter(timezone?: string | null, includeDate = false) {
  const options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", ...(includeDate ? { day: "numeric", month: "short" } : {}) };
  try { return new Intl.DateTimeFormat("en-IN", { ...options, timeZone: timezone || "UTC" }); }
  catch { return new Intl.DateTimeFormat("en-IN", { ...options, timeZone: "UTC" }); }
}
