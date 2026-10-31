var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { DatabaseService } from "../database/database.service.js";
let CampusViewRepository = class CampusViewRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async hasActiveAdminMembership(userId, schoolId) {
        const membership = await this.db.selectFrom("school_memberships")
            .select("id")
            .where("school_id", "=", schoolId)
            .where("user_id", "=", userId)
            .where("role", "=", "admin")
            .where("is_active", "=", true)
            .executeTakeFirst();
        return Boolean(membership);
    }
    school(schoolId) {
        return this.db.selectFrom("schools")
            .select(["id", "name", "code", "timezone"])
            .where("id", "=", schoolId)
            .executeTakeFirst();
    }
    campuses(schoolId) {
        return this.db.selectFrom("institution_campuses")
            .select(["id", "name", "code", "campus_type", "is_primary", "timezone", "revision"])
            .where("school_id", "=", schoolId)
            .where("status", "=", "active")
            .orderBy("is_primary", "desc")
            .orderBy("name")
            .execute();
    }
    spaces(schoolId, campusId) {
        return this.db.selectFrom("campus_spaces")
            .select(["id", "campus_id", "parent_space_id", "name", "code", "kind", "capacity", "attributes", "revision"])
            .where("school_id", "=", schoolId)
            .where("campus_id", "=", campusId)
            .where("status", "=", "active")
            .orderBy("name")
            .execute();
    }
    async examSpaceExpectations(schoolId, campusId, asOf) {
        return (await sql `SELECT relationship.id::text,
        target.domain_id AS space_id,
        COALESCE(NULLIF(source.metadata->>'assessment_id',''),relationship.source_record_id) AS assessment_id,
        source.domain_id AS sitting_id,
        COALESCE(NULLIF(source.metadata->>'title',''),source.label) AS title,
        NULLIF(source.metadata->>'class_label','') AS class_label,
        NULLIF(source.metadata->>'subject_label','') AS subject_label,
        CASE WHEN source.metadata->>'expected_count' ~ '^\d+$' THEN (source.metadata->>'expected_count')::int END AS expected_count,
        relationship.effective_from,relationship.effective_until,relationship.source_revision,
        relationship.updated_at AS recorded_at
      FROM campus_model_relationships relationship
      JOIN campus_model_entities source ON source.id=relationship.source_entity_id
        AND source.school_id=relationship.school_id AND source.domain='assessments'
        AND source.kind='exam_sitting' AND source.lifecycle_state='active'
      JOIN campus_model_entities target ON target.id=relationship.target_entity_id
        AND target.school_id=relationship.school_id AND target.domain='campus_topology'
        AND target.kind='space'
      JOIN campus_spaces space ON space.id::text=target.domain_id
        AND space.school_id=relationship.school_id AND space.status='active'
      WHERE relationship.school_id=${schoolId}::uuid AND relationship.source_domain='assessments'
        AND relationship.relation_type='scheduled_in' AND space.campus_id=${campusId}::uuid
        AND relationship.source_revision=source.source_revision
        AND relationship.effective_from<=${asOf}::timestamptz
        AND relationship.effective_until>${asOf}::timestamptz
      ORDER BY relationship.effective_from,relationship.id`.execute(this.db)).rows;
    }
    /**
     * Current-day timetable context for the selected campus. This remains a plan:
     * the responsible teacher and roster size are expectations, not room-presence
     * evidence. Superseded and calendar-cancelled occurrences are excluded. Older
     * projections without a canonical space are admitted only when one, and only
     * one, active campus space declares the room snapshot as an exact alias.
     */
    async dayOccurrences(schoolId, campusId, asOf, timezone) {
        return (await sql `SELECT occurrence.id::text AS id,
        occurrence.logical_occurrence_key AS occurrence_id,
        space.id::text AS space_id,occurrence.title,occurrence.slot_type,
        class_entity.label AS class_label,class_entity.id::text AS class_entity_id,subject_entity.label AS subject_label,
        responsible.id::text AS responsible_agent_id,responsible.label AS teacher_label,
        responsible_person.id::text AS responsible_person_id,
        CASE WHEN occurrence.class_entity_id IS NULL THEN COALESCE(participants.includes_responsible,false)
          ELSE COALESCE(roster.includes_responsible,false) END AS expected_includes_responsible,
        CASE WHEN occurrence.class_entity_id IS NULL THEN COALESCE(participants.expected_count,0)
          ELSE COALESCE(roster.expected_count,0) END::int AS expected_count,
        occurrence.starts_at,occurrence.ends_at,
        source.source_domain,source.source_record_id,source.source_revision,version.planning_origin
      FROM campus_model_schedule_occurrences occurrence
      LEFT JOIN campus_model_entities space_entity ON space_entity.id=occurrence.space_entity_id
        AND space_entity.school_id=occurrence.school_id
        AND space_entity.domain='campus_topology' AND space_entity.kind='space'
      JOIN LATERAL (
        SELECT candidate.id,candidate.name
        FROM campus_spaces candidate
        WHERE candidate.school_id=occurrence.school_id
          AND candidate.campus_id=${campusId}::uuid AND candidate.status='active'
          AND (
            (space_entity.domain_id IS NOT NULL AND candidate.id::text=space_entity.domain_id)
            OR (
              space_entity.domain_id IS NULL AND NULLIF(trim(occurrence.room_snapshot),'') IS NOT NULL
              AND EXISTS(
                SELECT 1 FROM jsonb_array_elements_text(
                  CASE WHEN jsonb_typeof(candidate.attributes->'aliases')='array'
                    THEN candidate.attributes->'aliases' ELSE '[]'::jsonb END
                ) alias(value)
                WHERE lower(trim(alias.value))=lower(trim(occurrence.room_snapshot))
              )
              AND 1=(
                SELECT count(*)
                FROM campus_spaces alias_candidate
                WHERE alias_candidate.school_id=occurrence.school_id
                  AND alias_candidate.campus_id=${campusId}::uuid
                  AND alias_candidate.status='active'
                  AND EXISTS(
                    SELECT 1 FROM jsonb_array_elements_text(
                      CASE WHEN jsonb_typeof(alias_candidate.attributes->'aliases')='array'
                        THEN alias_candidate.attributes->'aliases' ELSE '[]'::jsonb END
                    ) alias(value)
                    WHERE lower(trim(alias.value))=lower(trim(occurrence.room_snapshot))
                  )
              )
            )
          )
        ORDER BY candidate.id LIMIT 1
      ) space ON true
      LEFT JOIN campus_model_entities class_entity ON class_entity.id=occurrence.class_entity_id
        AND class_entity.school_id=occurrence.school_id
      LEFT JOIN campus_model_entities subject_entity ON subject_entity.id=occurrence.subject_entity_id
        AND subject_entity.school_id=occurrence.school_id
      LEFT JOIN campus_model_agents responsible ON responsible.id=occurrence.responsible_agent_id
        AND responsible.school_id=occurrence.school_id AND responsible.status='active'
      LEFT JOIN school_people responsible_person ON responsible_person.id=responsible.person_id
        AND responsible_person.school_id=occurrence.school_id AND responsible_person.retired_at IS NULL
      JOIN campus_model_events source ON source.id=occurrence.change_event_id
        AND source.school_id=occurrence.school_id
      LEFT JOIN schedule_versions version ON version.school_id=occurrence.school_id
        AND source.source_domain='timetable' AND version.id::text=source.source_record_id
      LEFT JOIN LATERAL (
        SELECT count(DISTINCT participant.participant_entity_id)::int AS expected_count,
          bool_or(person_entity.domain='people' AND person_entity.kind='person'
            AND person_entity.domain_id=responsible_person.id::text) AS includes_responsible
        FROM campus_model_occurrence_participants participant
        LEFT JOIN campus_model_entities person_entity ON person_entity.id=participant.participant_entity_id
          AND person_entity.school_id=participant.school_id
          AND person_entity.realm_id=participant.realm_id
          AND person_entity.environment_namespace_id=participant.environment_namespace_id
        WHERE participant.school_id=occurrence.school_id
          AND participant.realm_id=occurrence.realm_id
          AND participant.environment_namespace_id=occurrence.environment_namespace_id
          AND participant.occurrence_id=occurrence.id AND participant.required
      ) participants ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS expected_count,
          bool_or(student.person_id=responsible_person.id) AS includes_responsible
        FROM enrollments enrollment
        LEFT JOIN students student ON student.id=enrollment.student_id AND student.school_id=occurrence.school_id
        WHERE enrollment.class_section_id=class_entity.domain_id::uuid
          AND enrollment.is_active
      ) roster ON true
      WHERE occurrence.school_id=${schoolId}::uuid AND occurrence.state='expected'
        AND occurrence.claim_kind='exclusive'
        AND occurrence.recorded_until IS NULL
        AND occurrence.starts_at<(((${asOf}::timestamptz AT TIME ZONE ${timezone})::date+1)::timestamp AT TIME ZONE ${timezone})
        AND occurrence.ends_at>(((${asOf}::timestamptz AT TIME ZONE ${timezone})::date)::timestamp AT TIME ZONE ${timezone})
      ORDER BY occurrence.starts_at,occurrence.period_number,space.name,occurrence.id
      LIMIT 240`.execute(this.db)).rows;
    }
    /** One bounded private read for occurrence IDs already authorized by dayOccurrences.
     * No account, name, contact, dependent or inferred class roster is selected. */
    async motionParticipants(schoolId, occurrenceIds) {
        if (!occurrenceIds.length)
            return [];
        return (await sql `SELECT DISTINCT occurrence.id::text AS occurrence_id,
        person.id::text AS person_id,occurrence.starts_at
      FROM campus_model_schedule_occurrences occurrence
      JOIN campus_model_occurrence_participants participant ON participant.occurrence_id=occurrence.id
        AND participant.school_id=occurrence.school_id AND participant.realm_id=occurrence.realm_id
        AND participant.environment_namespace_id=occurrence.environment_namespace_id AND participant.required
      JOIN campus_model_entities entity ON entity.id=participant.participant_entity_id
        AND entity.school_id=participant.school_id AND entity.realm_id=participant.realm_id
        AND entity.environment_namespace_id=participant.environment_namespace_id
        AND entity.domain='people' AND entity.kind='person' AND entity.lifecycle_state='active'
      JOIN school_people person ON person.id::text=entity.domain_id
        AND person.school_id=occurrence.school_id AND person.retired_at IS NULL
      WHERE occurrence.school_id=${schoolId}::uuid AND occurrence.id=ANY(${occurrenceIds.slice(0, 240)}::uuid[])
        AND occurrence.state='expected' AND occurrence.claim_kind='exclusive' AND occurrence.recorded_until IS NULL
      ORDER BY occurrence.starts_at,occurrence.id::text,person.id::text
      LIMIT 1025`.execute(this.db)).rows;
    }
    /**
     * Accepted gate observations for the institution's current local day. A gate
     * is attached to a map space only when the recorded gate label exactly matches
     * a configured gate name or code in the selected campus. Unmatched points stay
     * institution-scoped and are never guessed onto the map.
     */
    async gateActivityToday(schoolId, campusId, asOf, timezone) {
        return (await sql `WITH accepted_gate AS (
        SELECT COALESCE(NULLIF(trim(observation.payload->>'gate'),''),'Campus gate') AS gate_label,
          observation.payload->>'direction' AS direction,observation.observed_at
        FROM campus_model_observations observation
        WHERE observation.school_id=${schoolId}::uuid
          AND observation.kind='movement.gate_observed' AND observation.state='accepted'
          AND observation.observed_at<=${asOf}::timestamptz
          AND observation.received_at<=${asOf}::timestamptz
          AND (observation.observed_at AT TIME ZONE ${timezone})::date=
            (${asOf}::timestamptz AT TIME ZONE ${timezone})::date
      )
      SELECT gate.gate_label,matched.id::text AS space_id,
        count(*) FILTER(WHERE gate.direction='in')::int AS entry_count,
        count(*) FILTER(WHERE gate.direction='out')::int AS exit_count,
        count(*)::int AS accepted_count,max(gate.observed_at) AS latest_observed_at
      FROM accepted_gate gate
      LEFT JOIN LATERAL (
        SELECT space.id
        FROM campus_spaces space
        WHERE space.school_id=${schoolId}::uuid AND space.campus_id=${campusId}::uuid
          AND space.status='active' AND space.kind='gate'
          AND (lower(trim(space.name))=lower(gate.gate_label)
            OR lower(trim(space.code))=lower(gate.gate_label)
            OR EXISTS(
              SELECT 1 FROM jsonb_array_elements_text(
                CASE WHEN jsonb_typeof(space.attributes->'aliases')='array'
                  THEN space.attributes->'aliases' ELSE '[]'::jsonb END
              ) alias(value)
              WHERE lower(trim(alias.value))=lower(gate.gate_label)
            ))
        ORDER BY space.id LIMIT 1
      ) matched ON true
      WHERE gate.direction IN ('in','out')
      GROUP BY gate.gate_label,matched.id
      ORDER BY max(gate.observed_at) DESC,gate.gate_label`.execute(this.db)).rows;
    }
    async activeVisitorCount(schoolId, asOf) {
        return (await sql `SELECT count(*)::int AS count
      FROM gate_visitors visitor
      WHERE visitor.school_id=${schoolId}::uuid AND visitor.state='inside'
        AND visitor.checked_in_at<=${asOf}::timestamptz
        AND (visitor.checked_out_at IS NULL OR visitor.checked_out_at>${asOf}::timestamptz)`
            .execute(this.db)).rows[0]?.count ?? 0;
    }
};
CampusViewRepository = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService])
], CampusViewRepository);
export { CampusViewRepository };
//# sourceMappingURL=campus-view.repository.js.map