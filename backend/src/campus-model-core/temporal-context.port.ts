import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type { CampusTemporalContextQuery, PublishedScheduleProjection } from "./contracts.js";

export const TEMPORAL_CONTEXT_PORT = Symbol("TEMPORAL_CONTEXT_PORT");

export interface ScheduleProjectionReceipt {
  event_id: string;
  schedule_entity_id: string;
  occurrence_count: number;
  replayed: boolean;
}

export interface CampusTemporalAssertion {
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
    event_type: "timetable.schedule_published";
    source_domain: "timetable";
    source_record_id: string;
    source_revision: number;
  };
  certainty: "planned";
  freshness: "current" | "historical";
  contradictions: [];
}

export interface TemporalContextPort {
  recordPublishedSchedule(
    transaction: Transaction<Database>,
    input: PublishedScheduleProjection,
  ): Promise<ScheduleProjectionReceipt>;
  resolveAt(input: CampusTemporalContextQuery): Promise<CampusTemporalAssertion[]>;
}
