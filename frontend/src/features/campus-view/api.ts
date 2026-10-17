import { apiFetch } from "../../lib/api";
import type { CampusAssertion, CampusExpectedUse, CampusGateActivityToday, CampusTruthDimension, CampusViewResponse } from "./types";

interface RawAssertion {
  assertion_id: string;
  dimension: "expected" | "observed" | "accepted";
  context: unknown;
  valid_from: string | null;
  valid_until: string | null;
  observed_at: string | null;
  source: { label: string; domain: string };
  freshness: { status: "current_at_as_of" | "point_in_time"; expires_at: string | null };
  spatial_claim: "expected_context_only" | "point_observation_only" | "bounded_space_presence";
  target_path?: string | null;
}

interface RawCampusViewResponse extends Omit<CampusViewResponse, "spaces" | "activity" | "signals"> {
  spaces: Array<{
    id: string; campus_id: string; parent_space_id: string | null; name: string; code: string; kind: string; capacity: number | null;
    floor_id: string | null; floor_label: string | null; state_dimension: CampusTruthDimension; expected_activity?: string | null;
    expected_now?: CampusExpectedUse[]; day_activity_count?: number; gate_activity_today?: CampusGateActivityToday | null;
    assertions: { expected: RawAssertion[]; observed: RawAssertion[]; accepted: RawAssertion[] };
  }>;
  activity: Array<{ id: string; occurred_at: string; kind: string; action: string; subject_label: string | null; item_count: number; state: string; actor_label: string; source: { label: string } }>;
  day_activity?: CampusViewResponse["activity"];
  signals: Array<Record<string, unknown> & { id: string; severity: "review" | "important"; person_label?: string; class_label?: string; activity_label?: string; owner?: string }>;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function contextDetails(context: unknown) {
  if (!context || typeof context !== "object") return { title: null, detail: null, count: null };
  const values = context as Record<string, unknown>;
  const title = text(values.title) ?? text(values.subject_name) ?? text(values.subject_label) ?? text(values.activity_label);
  const details = [text(values.class_label), text(values.teacher_label), text(values.period_label)].filter(Boolean);
  const rawCount = values.expected_count ?? values.student_count ?? values.participant_count;
  return { title, detail: details.join(" · ") || null, count: typeof rawCount === "number" ? rawCount : null };
}

function assertionPath(assertion: RawAssertion) {
  if (assertion.target_path) return assertion.target_path;
  if (assertion.source.domain === "assessments") {
    const assessmentId = assertion.context && typeof assertion.context === "object"
      ? (assertion.context as Record<string, unknown>).assessment_id
      : null;
    if (typeof assessmentId === "string" && assessmentId) return `/principal/assessments?assessment=${encodeURIComponent(assessmentId)}`;
  }
  if (assertion.dimension === "expected") return "/principal/timetable";
  return assertion.source.domain.includes("gate") ? "/principal/gate" : "/principal/attendance";
}

function normalizeAssertion(assertion: RawAssertion, fallbackTitle?: string | null): CampusAssertion {
  const context = contextDetails(assertion.context);
  return {
    id: assertion.assertion_id,
    dimension: assertion.dimension,
    label: context.title ?? fallbackTitle ?? (assertion.dimension === "expected" ? "Scheduled activity" : "Recorded observation"),
    detail: context.detail,
    source_label: assertion.source.label,
    valid_from: assertion.valid_from,
    valid_until: assertion.valid_until,
    observed_at: assertion.observed_at,
    expires_at: assertion.freshness.expires_at,
    freshness: assertion.freshness.status === "current_at_as_of"
      ? assertion.dimension === "expected" ? "not_applicable" : "fresh"
      : "historical",
    spatial_claim: assertion.spatial_claim,
    count: context.count,
    target_path: assertionPath(assertion),
  };
}

function activityTitle(action: string, subject: string | null) {
  if (subject) return subject;
  return action.split(".").map((part) => part.replaceAll("_", " ")).join(" · ");
}

export function activityTruthDimension(kind: string, state: string): CampusTruthDimension {
  if (state === "accepted") return "accepted";
  // A pending attendance item is a captured observation awaiting its domain
  // decision. Other pending/review command states are protocol records, not
  // observations and not accepted campus truth.
  if (kind === "attendance" && state === "pending") return "observed";
  return "unknown";
}

function normalize(data: RawCampusViewResponse): CampusViewResponse {
  return {
    ...data,
    spaces: data.spaces.map((space) => {
      const assertions = {
        expected: space.assertions.expected.map((item) => normalizeAssertion(item, space.expected_activity)),
        observed: space.assertions.observed.map((item) => normalizeAssertion(item)),
        accepted: space.assertions.accepted.map((item) => normalizeAssertion(item)),
      };
      const state_dimension = assertions.accepted.some((item) => item.freshness === "fresh")
        ? "accepted"
        : assertions.observed.some((item) => item.freshness === "fresh")
          ? "observed"
          : assertions.expected.length ? "expected" : "unknown";
      return {
        ...space,
        floor_id: space.floor_id ?? "",
        floor_label: space.floor_label ?? "",
        expected_now: space.expected_now ?? [],
        day_activity_count: space.day_activity_count ?? 0,
        gate_activity_today: space.gate_activity_today ?? null,
        state_dimension,
        signal_count: 0,
        assertions,
      };
    }),
    activity: [
      ...(data.day_activity ?? []),
      ...data.activity.map((item) => ({
        id: item.id,
        occurred_at: item.occurred_at,
        title: activityTitle(item.action, item.subject_label),
        detail: `${item.actor_label}${item.item_count ? ` · ${item.item_count} records` : ""} · ${item.state.replaceAll("_", " ")}`,
        state_dimension: activityTruthDimension(item.kind, item.state),
        source_label: item.source.label,
        target_path: item.kind === "attendance" ? "/principal/attendance" : item.kind === "examination" ? "/principal/assessments" : "/principal/administration?section=campus",
      })),
    ],
    signals: data.signals.map((item) => ({
      id: item.id,
      severity: item.severity,
      title: item.person_label ? `${item.person_label} needs a cross-check` : "Campus signal needs review",
      detail: [item.class_label, item.activity_label].filter(Boolean).join(" · "),
      occurred_at: text(item.gate_observed_at) ?? data.generated_at,
      target_path: item.owner === "attendance" ? "/principal/attendance" : "/principal/gate",
    })),
  };
}

export async function getCampusView(schoolId: string, campusId?: string, signal?: AbortSignal) {
  const query = new URLSearchParams();
  if (campusId) query.set("campus_id", campusId);
  const suffix = query.size ? `?${query.toString()}` : "";
  const data = await apiFetch<RawCampusViewResponse>(`/api/v1/schools/${encodeURIComponent(schoolId)}/campus-view/${suffix}`, { signal });
  return normalize(data);
}
