import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type {
  CalendarClosureProjection,
  CampusTemporalContextQuery,
  PublishedDayPlanProjection,
  PublishedScheduleProjection,
} from "./contracts.js";

export const TEMPORAL_CONTEXT_PORT = Symbol("TEMPORAL_CONTEXT_PORT");

export interface ScheduleProjectionReceipt {
  event_id: string;
  schedule_entity_id: string;
  occurrence_count: number;
  replayed: boolean;
}

export interface PlanReconciliationReceipt {
  event_id: string;
  affected_occurrence_count: number;
  replacement_occurrence_count: number;
  replayed: boolean;
}

export interface ExpectedTemporalAssertion {
  assertion_id: string;
  dimension: "expected";
  assertion_type: "scheduled_context";
  subject: {
    type: "entity" | "human_agent";
    id: string;
    label: string;
  };
  context: {
    occurrence_id: string;
    schedule_version_id: string;
    class_entity_id: string;
    class_label: string;
    subject_entity_id: string | null;
    subject_label: string | null;
    space_entity_id: string | null;
    space_label: string | null;
    title: string;
    slot_type: "class" | "break" | "activity";
  };
  valid_from: Date | string;
  valid_until: Date | string;
  recorded_at: Date | string;
  source: {
    event_id: string;
    event_type: "timetable.schedule_published" | "timetable.day_plan_published";
    source_domain: "timetable" | "day_plan";
    source_record_id: string;
    source_revision: number;
  };
  certainty: "planned";
  freshness: "current" | "historical";
  contradictions: [];
}

export interface ObservedTemporalAssertion {
  assertion_id: string;
  dimension: "observed" | "accepted";
  assertion_type: "direct_observation";
  subject: {
    type: "entity";
    id: string;
    label: string;
    kind: string;
  };
  context: {
    entity_id: string;
    label: string;
    kind: string;
  } | null;
  observation: {
    kind: string;
    state: "pending" | "accepted" | "quarantined";
    payload: unknown;
  };
  observed_at: Date | string;
  recorded_at: Date | string;
  source: {
    observation_id: string;
    source_type: string;
    source_ref: string | null;
    source_record_id: string;
    captured_by_agent_id: string;
    captured_by_kind: "human" | "team" | "device" | "integration" | "software";
    captured_by_label: string;
  };
  certainty: "observed" | "accepted" | "unverified";
  freshness: "point_in_time";
  contradictions: [];
}

export type CampusTemporalAssertion = ExpectedTemporalAssertion | ObservedTemporalAssertion;

export interface TemporalContextPort {
  recordPublishedSchedule(
    transaction: Transaction<Database>,
    input: PublishedScheduleProjection,
  ): Promise<ScheduleProjectionReceipt>;
  recordCalendarClosure(
    transaction: Transaction<Database>,
    input: CalendarClosureProjection,
  ): Promise<PlanReconciliationReceipt>;
  recordPublishedDayPlan(
    transaction: Transaction<Database>,
    input: PublishedDayPlanProjection,
  ): Promise<PlanReconciliationReceipt>;
  resolveAt(input: CampusTemporalContextQuery): Promise<CampusTemporalAssertion[]>;
}
