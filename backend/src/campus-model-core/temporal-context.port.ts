import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type {
  AcceptedScheduleSubstitutionProjection,
  CancelledScheduleSubstitutionProjection,
  CalendarClosureProjection,
  CampusTemporalContextQuery,
  PublishedDayPlanProjection,
  PublishedScheduleProjection,
  ImportedAcceptedScheduleSubstitutionProjection,
  LegacyTimetableSlotChangeProjection,
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

export interface SubstitutionProjectionReceipt extends PlanReconciliationReceipt {
  projection_status: "applied" | "awaiting_source_projection" | "source_closed" | "source_mismatch";
}

export type SubstitutionInvalidationReceipt = PlanReconciliationReceipt & (
  | {
    projection_status: "applied_original_teacher";
    successor_assignment: "original_teacher";
  }
  | {
    projection_status: "applied_unassigned";
    successor_assignment: "unassigned";
  }
  | {
    projection_status: "source_replaced";
    successor_assignment: "unchanged_later_source";
  }
  | {
    projection_status: "source_mismatch";
    successor_assignment: null;
  }
);

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
    occurrence_revision_id: string;
    schedule_version_id: string;
    period_number: number;
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
    event_type:
      | "timetable.schedule_published"
      | "timetable.day_plan_published"
      | "timetable.schedule_projection_backfilled"
      | "timetable.legacy_slot_imported"
      | "timetable.legacy_slot_created"
      | "timetable.legacy_slot_updated"
      | "timetable.legacy_slot_deleted";
    source_domain: "timetable" | "day_plan";
    source_record_id: string;
    source_revision: number;
    journal_sequence: string;
    change: {
      event_id: string;
      event_type: string;
      source_domain: string;
      source_record_id: string;
      source_revision: number;
      journal_sequence: string;
      change_kind:
        | "published"
        | "overridden"
        | "closure_cancelled"
        | "closure_restored"
        | "day_plan_cancelled"
        | "substituted"
        | "substitution_cancelled"
        | "source_changed"
        | "source_removed"
        | "projection_backfill";
    };
    condition: {
      event_id: string;
      event_type: string;
      source_domain: string;
      source_record_id: string;
      source_revision: number;
      journal_sequence: string;
    } | null;
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

export interface CampusOperatingDayOccurrence {
  id: string;
  occurrence_id: string;
  occurrence_date: string;
  period_number: number;
  class_entity_id: string;
  class_domain_id: string;
  class_label: string;
  period_domain_id: string;
  subject_entity_id: string | null;
  subject_label: string | null;
  space_entity_id: string | null;
  space_label: string | null;
  responsible_agent_id: string | null;
  responsible_agent_label: string | null;
  title: string;
  slot_type: "class" | "break" | "activity";
  starts_at: Date | string;
  ends_at: Date | string;
  source_domain: "timetable" | "day_plan";
  source_record_id: string;
  source_revision: number;
  change_kind:
    | "published"
    | "overridden"
    | "closure_cancelled"
    | "closure_restored"
    | "day_plan_cancelled"
    | "substituted"
    | "substitution_cancelled"
    | "source_changed"
    | "source_removed"
    | "projection_backfill";
}

export interface CampusOperatingDayQuery {
  school_id: string;
  date: string;
  recorded_as_of: string;
  responsible_agent_id?: string;
}

export interface TemporalContextPort {
  listOperatingDay(input: CampusOperatingDayQuery): Promise<CampusOperatingDayOccurrence[]>;
  recordPublishedSchedule(
    transaction: Transaction<Database>,
    input: PublishedScheduleProjection,
  ): Promise<ScheduleProjectionReceipt>;
  recordLegacyTimetableSlotChange(
    transaction: Transaction<Database>,
    input: LegacyTimetableSlotChangeProjection,
  ): Promise<PlanReconciliationReceipt>;
  recordCalendarClosure(
    transaction: Transaction<Database>,
    input: CalendarClosureProjection,
  ): Promise<PlanReconciliationReceipt>;
  recordPublishedDayPlan(
    transaction: Transaction<Database>,
    input: PublishedDayPlanProjection,
  ): Promise<PlanReconciliationReceipt>;
  recordAcceptedScheduleSubstitution(
    transaction: Transaction<Database>,
    input: AcceptedScheduleSubstitutionProjection,
  ): Promise<SubstitutionProjectionReceipt>;
  recordImportedAcceptedScheduleSubstitution(
    transaction: Transaction<Database>,
    input: ImportedAcceptedScheduleSubstitutionProjection,
  ): Promise<SubstitutionProjectionReceipt>;
  recordCancelledScheduleSubstitution(
    transaction: Transaction<Database>,
    input: CancelledScheduleSubstitutionProjection,
  ): Promise<SubstitutionInvalidationReceipt>;
  resolveAt(input: CampusTemporalContextQuery): Promise<CampusTemporalAssertion[]>;
}
