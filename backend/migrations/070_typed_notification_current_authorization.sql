-- Typed notification delivery is a durable hint, not a permanent grant. Bell
-- reads, attention projection and acknowledgement all call this one predicate
-- so membership, guardian scope, delegated access and source state cannot drift.
CREATE FUNCTION notification_attention_is_currently_authorized(
  notification_id uuid,
  actor uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM notifications notification
    JOIN users account
      ON account.id=notification.recipient_id
      AND account.is_active
    JOIN school_memberships membership
      ON membership.school_id=notification.attention_school_id
      AND membership.user_id=notification.recipient_id
      AND membership.is_active
      AND membership.role::text=CASE notification.attention_portal
        WHEN 'parent' THEN 'guardian'
        WHEN 'teacher' THEN 'staff'
        WHEN 'principal' THEN 'admin'
        ELSE ''
      END
    WHERE notification.id=notification_id
      AND notification.recipient_id=actor
      AND notification.attention_eligible
      AND (
        notification.attention_portal<>'parent'
        OR notification.attention_student_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM students selected_student
          JOIN guardian_relationships relationship
            ON relationship.student_id=selected_student.id
            AND relationship.school_id=selected_student.school_id
          JOIN parents guardian ON guardian.id=relationship.guardian_id
          WHERE selected_student.id=notification.attention_student_id
            AND selected_student.school_id=notification.attention_school_id
            AND guardian.user_id=notification.recipient_id
        )
      )
      AND (
        notification.attention_portal<>'parent'
        OR notification.attention_class_section_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM enrollments enrollment
          WHERE enrollment.student_id=notification.attention_student_id
            AND enrollment.class_section_id=notification.attention_class_section_id
            AND enrollment.is_active
        )
      )
      AND CASE notification.attention_source_kind
        WHEN 'student_leave_decision' THEN notification.attention_portal='parent' AND EXISTS (
          SELECT 1
          FROM leave_requests request
          JOIN students student ON student.id=request.student_id
          WHERE request.id=notification.attention_source_id
            AND request.student_id=notification.attention_student_id
            AND student.school_id=notification.attention_school_id
            AND request.status IN ('school_approved','school_rejected')
        )
        WHEN 'staff_leave_decision' THEN notification.attention_portal='teacher' AND EXISTS (
          SELECT 1
          FROM staff_leave_requests request
          JOIN staff_profiles profile ON profile.id=request.staff_profile_id
          WHERE request.id=notification.attention_source_id
            AND request.school_id=notification.attention_school_id
            AND request.status IN ('approved','rejected')
            AND request.revision=notification.attention_source_revision
            AND profile.user_id=notification.recipient_id
        )
        WHEN 'assessment_publication' THEN notification.attention_portal='parent' AND EXISTS (
          SELECT 1
          FROM assessment_publications publication
          JOIN assessment_publication_results result ON result.publication_id=publication.id
          WHERE publication.id=notification.attention_source_id
            AND publication.school_id=notification.attention_school_id
            AND publication.sequence=notification.attention_source_revision
            AND result.student_id=notification.attention_student_id
            AND NOT EXISTS (
              SELECT 1
              FROM assessment_publications newer
              JOIN assessment_publication_results newer_result ON newer_result.publication_id=newer.id
              WHERE newer.assessment_id=publication.assessment_id
                AND newer.sequence>publication.sequence
                AND newer_result.student_id=notification.attention_student_id
            )
        )
        WHEN 'report_publication' THEN notification.attention_portal='parent' AND EXISTS (
          SELECT 1
          FROM grading_report_batches batch
          JOIN grading_report_students report ON report.batch_id=batch.id
          WHERE batch.id=notification.attention_source_id
            AND batch.school_id=notification.attention_school_id
            AND batch.status='published'
            AND batch.sequence=notification.attention_source_revision
            AND report.student_id=notification.attention_student_id
            AND NOT EXISTS (
              SELECT 1
              FROM grading_report_batches newer
              JOIN grading_report_students newer_report ON newer_report.batch_id=newer.id
              WHERE newer.scheme_id=batch.scheme_id
                AND newer.status='published'
                AND newer.sequence>batch.sequence
                AND newer_report.student_id=notification.attention_student_id
            )
        )
        WHEN 'day_plan_publication' THEN EXISTS (
          SELECT 1
          FROM day_plans plan
          WHERE plan.id=notification.attention_source_id
            AND plan.school_id=notification.attention_school_id
            AND plan.class_section_id=notification.attention_class_section_id
            AND plan.published_version=notification.attention_source_revision
            AND (
              notification.attention_portal<>'teacher'
              OR staff_has_class_permission(
                notification.attention_school_id,
                notification.recipient_id,
                'timetable.view',
                plan.class_section_id,
                plan.date
              )
            )
        )
        WHEN 'timetable_publication' THEN EXISTS (
          SELECT 1
          FROM schedule_versions version
          WHERE version.id=notification.attention_source_id
            AND version.school_id=notification.attention_school_id
            AND version.class_section_id=notification.attention_class_section_id
            AND version.state='published'
            AND version.revision=notification.attention_source_revision
            AND (
              notification.attention_portal<>'teacher'
              OR staff_has_class_permission(
                notification.attention_school_id,
                notification.recipient_id,
                'timetable.view',
                version.class_section_id,
                version.starts_on
              )
            )
        )
        WHEN 'calendar_change' THEN EXISTS (
          SELECT 1
          FROM event_outbox event
          WHERE event.school_id=notification.attention_school_id
            AND event.aggregate_id=notification.attention_source_id
            AND event.event_type='calendar.updated'
            AND NOT EXISTS (
              SELECT 1
              FROM event_outbox newer
              WHERE newer.school_id=event.school_id
                AND newer.event_type='calendar.updated'
                AND COALESCE(newer.payload->>'date',newer.payload->>'starts_on')
                  =COALESCE(notification.metadata->>'date',notification.metadata->>'starts_on')
                AND (newer.created_at,newer.id)>(event.created_at,event.id)
            )
        )
        WHEN 'attendance_outcome' THEN notification.attention_portal='parent' AND EXISTS (
          SELECT 1
          FROM attendance_records record
          JOIN students student ON student.id=record.student_id
          WHERE record.id=notification.attention_source_id
            AND record.student_id=notification.attention_student_id
            AND student.school_id=notification.attention_school_id
            AND record.revision=notification.attention_source_revision
            AND (record.status<>'present' OR notification.metadata->>'previous_status' IS NOT NULL)
        )
        WHEN 'event_cancellation' THEN notification.attention_portal='parent' AND EXISTS (
          SELECT 1
          FROM campus_events event
          JOIN campus_event_participants participant
            ON participant.event_id=event.id
            AND participant.school_id=event.school_id
          WHERE event.id=notification.attention_source_id
            AND event.school_id=notification.attention_school_id
            AND event.status='cancelled'
            AND event.revision=notification.attention_source_revision
            AND participant.student_id=notification.attention_student_id
        )
        WHEN 'event_withdrawal' THEN notification.attention_portal='parent' AND EXISTS (
          SELECT 1
          FROM campus_event_participant_withdrawals withdrawal
          WHERE withdrawal.id=notification.attention_source_id
            AND withdrawal.school_id=notification.attention_school_id
            AND withdrawal.student_id=notification.attention_student_id
        )
        WHEN 'event_refund' THEN notification.attention_portal='parent' AND EXISTS (
          SELECT 1
          FROM fee_refunds refund
          WHERE refund.id=notification.attention_source_id
            AND refund.school_id=notification.attention_school_id
            AND refund.student_id=notification.attention_student_id
        )
        WHEN 'fee_review_decision' THEN notification.attention_portal='parent' AND EXISTS (
          SELECT 1
          FROM fee_review_decisions decision
          JOIN fee_review_requests request
            ON request.id=decision.request_id
            AND request.school_id=decision.school_id
          JOIN fee_invoices invoice
            ON invoice.id=request.invoice_id
            AND invoice.school_id=request.school_id
          WHERE decision.id=notification.attention_source_id
            AND decision.school_id=notification.attention_school_id
            AND request.submitted_by=notification.recipient_id
            AND invoice.student_id=notification.attention_student_id
        )
        WHEN 'guardian_leave_authority' THEN notification.attention_portal='parent' AND EXISTS (
          SELECT 1
          FROM guardian_leave_authority_commands command
          JOIN guardian_relationships relationship
            ON relationship.id=command.relationship_id
            AND relationship.school_id=command.school_id
          JOIN parents guardian ON guardian.id=relationship.guardian_id
          WHERE command.id=notification.attention_source_id
            AND command.school_id=notification.attention_school_id
            AND relationship.student_id=notification.attention_student_id
            AND relationship.authority_revision=notification.attention_source_revision
            AND guardian.user_id=notification.recipient_id
        )
        WHEN 'restricted_care_update' THEN notification.attention_portal IN ('teacher','principal') AND EXISTS (
          SELECT 1
          FROM restricted_care_cases care
          JOIN restricted_care_case_assignments assignment
            ON assignment.case_id=care.id
            AND assignment.school_id=care.school_id
          WHERE care.id=notification.attention_source_id
            AND care.school_id=notification.attention_school_id
            AND care.revision=notification.attention_source_revision
            AND assignment.user_id=notification.recipient_id
            AND assignment.revoked_at IS NULL
        )
        WHEN 'policy_publication' THEN notification.attention_portal IN ('parent','teacher') AND EXISTS (
          SELECT 1
          FROM institution_policy_versions version
          WHERE version.id=notification.attention_source_id
            AND version.school_id=notification.attention_school_id
            AND version.status='published'
            AND version.revision=notification.attention_source_revision
            AND CASE notification.attention_portal
              WHEN 'parent' THEN 'guardian'=ANY(version.audience_roles)
              WHEN 'teacher' THEN 'staff'=ANY(version.audience_roles)
              ELSE false
            END
        )
        WHEN 'departure_request_decision' THEN notification.attention_portal='parent' AND EXISTS (
          SELECT 1
          FROM departure_change_requests request
          WHERE request.id=notification.attention_source_id
            AND request.school_id=notification.attention_school_id
            AND request.student_id=notification.attention_student_id
            AND request.revision=notification.attention_source_revision
            AND request.status IN ('approved','rejected')
            AND (
              request.requester_user_id=notification.recipient_id
              OR EXISTS (
                SELECT 1
                FROM guardian_relationships relationship
                JOIN parents guardian ON guardian.id=relationship.guardian_id
                JOIN guardian_school_profiles profile
                  ON profile.school_id=relationship.school_id
                  AND profile.guardian_id=relationship.guardian_id
                WHERE relationship.school_id=request.school_id
                  AND relationship.student_id=request.student_id
                  AND guardian.user_id=notification.recipient_id
                  AND profile.person_id=request.requester_person_id
              )
            )
        )
        WHEN 'transport_trip_cancellation' THEN notification.attention_portal='parent' AND EXISTS (
          SELECT 1
          FROM transport_trips trip
          JOIN transport_trip_roster rider ON rider.trip_id=trip.id
          WHERE trip.id=notification.attention_source_id
            AND trip.school_id=notification.attention_school_id
            AND trip.state='cancelled'
            AND trip.revision=notification.attention_source_revision
            AND rider.student_id=notification.attention_student_id
        )
        WHEN 'transport_rider_exception' THEN notification.attention_portal='parent' AND EXISTS (
          SELECT 1
          FROM transport_trips trip
          JOIN transport_trip_roster rider ON rider.trip_id=trip.id
          WHERE trip.id=notification.attention_source_id
            AND trip.school_id=notification.attention_school_id
            AND rider.student_id=notification.attention_student_id
            AND rider.state='exception'
            AND rider.revision=notification.attention_source_revision
        )
        WHEN 'departure_handover_exception' THEN notification.attention_portal='parent' AND EXISTS (
          SELECT 1
          FROM departure_plans plan
          WHERE plan.id=notification.attention_source_id
            AND plan.school_id=notification.attention_school_id
            AND plan.student_id=notification.attention_student_id
            AND plan.is_current
            AND plan.state='exception'
            AND plan.revision=notification.attention_source_revision
        )
        ELSE false
      END
  )
$$;

REVOKE ALL ON FUNCTION notification_attention_is_currently_authorized(uuid,uuid) FROM PUBLIC;

DO $$
DECLARE runtime_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO runtime_owner
  FROM pg_class WHERE oid='notifications'::regclass;
  EXECUTE format(
    'ALTER FUNCTION notification_attention_is_currently_authorized(uuid,uuid) OWNER TO %I',
    runtime_owner
  );
END $$;

COMMENT ON FUNCTION notification_attention_is_currently_authorized(uuid,uuid) IS
  'Rechecks current account, membership, relationship, delegated permission and durable source state for typed notification reads.';
