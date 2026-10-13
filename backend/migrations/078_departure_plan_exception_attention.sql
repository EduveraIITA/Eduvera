-- A departure plan can remain unsafe after the bell has been opened (for
-- example, a revoked collector or cancelled bus journey). Model that durable
-- state independently from the informational transition that created it.
ALTER TABLE notifications
  DROP CONSTRAINT notifications_typed_attention_contract_ck,
  ADD CONSTRAINT notifications_typed_attention_contract_ck CHECK (
    (
      NOT attention_eligible
      AND attention_school_id IS NULL
      AND attention_student_id IS NULL
      AND attention_class_section_id IS NULL
      AND attention_portal IS NULL
      AND attention_module IS NULL
      AND attention_source_kind IS NULL
      AND attention_source_id IS NULL
      AND attention_source_revision IS NULL
      AND attention_topic_key IS NULL
    ) OR (
      attention_eligible
      AND attention_school_id IS NOT NULL
      AND attention_portal IN ('parent','teacher','principal')
      AND attention_module IN (
        'leave','results','calendar','timetable','attendance','events',
        'fees','safeguarding','policies','departure'
      )
      AND attention_source_kind IN (
        'student_leave_decision','staff_leave_decision',
        'assessment_publication','report_publication','day_plan_publication',
        'timetable_publication','calendar_change','attendance_outcome',
        'event_cancellation','event_withdrawal','event_refund',
        'fee_review_decision','guardian_leave_authority',
        'restricted_care_update','policy_publication',
        'departure_request_decision','transport_trip_cancellation',
        'transport_rider_exception','departure_handover_exception',
        'departure_plan_exception'
      )
      AND attention_source_id IS NOT NULL
      AND attention_source_revision >= 1
      AND length(trim(attention_topic_key)) BETWEEN 1 AND 255
      AND CASE attention_source_kind
        WHEN 'student_leave_decision' THEN attention_portal='parent' AND attention_module='leave'
        WHEN 'staff_leave_decision' THEN attention_portal='teacher' AND attention_module='leave'
        WHEN 'assessment_publication' THEN attention_portal='parent' AND attention_module='results'
        WHEN 'report_publication' THEN attention_portal='parent' AND attention_module='results'
        WHEN 'day_plan_publication' THEN attention_portal IN ('parent','teacher','principal') AND attention_module='timetable'
        WHEN 'timetable_publication' THEN attention_portal IN ('parent','teacher','principal') AND attention_module='timetable'
        WHEN 'calendar_change' THEN attention_portal IN ('parent','teacher','principal') AND attention_module='calendar'
        WHEN 'attendance_outcome' THEN attention_portal='parent' AND attention_module='attendance' AND attention_student_id IS NOT NULL
        WHEN 'event_cancellation' THEN attention_module='events' AND (
          (attention_portal='parent' AND attention_student_id IS NOT NULL)
          OR (attention_portal IN ('teacher','principal') AND attention_student_id IS NULL)
        )
        WHEN 'event_withdrawal' THEN attention_portal='parent' AND attention_module='events' AND attention_student_id IS NOT NULL
        WHEN 'event_refund' THEN attention_portal='parent' AND attention_module='events' AND attention_student_id IS NOT NULL
        WHEN 'fee_review_decision' THEN attention_portal='parent' AND attention_module='fees' AND attention_student_id IS NOT NULL
        WHEN 'guardian_leave_authority' THEN attention_portal='parent' AND attention_module='leave' AND attention_student_id IS NOT NULL
        WHEN 'restricted_care_update' THEN attention_portal IN ('teacher','principal') AND attention_module='safeguarding' AND attention_student_id IS NULL
        WHEN 'policy_publication' THEN attention_portal IN ('parent','teacher') AND attention_module='policies' AND attention_student_id IS NULL
        WHEN 'departure_request_decision' THEN attention_portal='parent' AND attention_module='departure' AND attention_student_id IS NOT NULL
        WHEN 'transport_trip_cancellation' THEN attention_portal='parent' AND attention_module='departure' AND attention_student_id IS NOT NULL
        WHEN 'transport_rider_exception' THEN attention_portal='parent' AND attention_module='departure' AND attention_student_id IS NOT NULL
        WHEN 'departure_handover_exception' THEN attention_portal='parent' AND attention_module='departure' AND attention_student_id IS NOT NULL
        WHEN 'departure_plan_exception' THEN attention_portal='parent' AND attention_module='departure' AND attention_student_id IS NOT NULL
        ELSE false
      END
    )
  );

CREATE FUNCTION notification_departure_plan_exception_is_currently_authorized(
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
      AND account.role='parent'
    JOIN school_memberships membership
      ON membership.school_id=notification.attention_school_id
      AND membership.user_id=notification.recipient_id
      AND membership.role='guardian'
      AND membership.is_active
    JOIN departure_plans plan
      ON plan.id=notification.attention_source_id
      AND plan.school_id=notification.attention_school_id
      AND plan.student_id=notification.attention_student_id
      AND plan.is_current
      AND plan.state='exception'
      AND plan.revision=notification.attention_source_revision
    JOIN guardian_relationships relationship
      ON relationship.school_id=plan.school_id
      AND relationship.student_id=plan.student_id
    JOIN parents guardian
      ON guardian.id=relationship.guardian_id
      AND guardian.user_id=notification.recipient_id
    WHERE notification.id=notification_id
      AND notification.recipient_id=actor
      AND notification.attention_eligible
      AND notification.attention_portal='parent'
      AND notification.attention_module='departure'
      AND notification.attention_source_kind='departure_plan_exception'
  )
$$;

REVOKE ALL ON FUNCTION notification_departure_plan_exception_is_currently_authorized(uuid,uuid) FROM PUBLIC;

-- Bell reads and acknowledgement use the same current-source predicate as the
-- attention projection. Retain the optimized generic-event path unchanged.
CREATE OR REPLACE FUNCTION notification_is_currently_visible(
  notification_id uuid,
  actor uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=public
AS $$
DECLARE
  notification_dedupe text;
  notification_attention boolean;
  notification_source_kind text;
  notification_event text;
BEGIN
  SELECT notification.dedupe_key,notification.attention_eligible,
    notification.attention_source_kind
    INTO notification_dedupe,notification_attention,notification_source_kind
  FROM notifications notification
  JOIN users account
    ON account.id=notification.recipient_id
    AND account.is_active
  WHERE notification.id=notification_id
    AND notification.recipient_id=actor;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF notification_attention THEN
    IF notification_source_kind='departure_plan_exception' THEN
      RETURN notification_departure_plan_exception_is_currently_authorized(
        notification_id,
        actor
      );
    END IF;
    RETURN notification_attention_is_currently_authorized(
      notification_id,
      actor
    );
  END IF;

  IF notification_dedupe ~*
    '^event:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    notification_event := substring(notification_dedupe FROM 7);
    RETURN notification_event_is_currently_visible(notification_event::uuid,actor);
  END IF;

  RETURN notification_is_currently_visible_before_event_optimization(
    notification_id,
    actor
  );
END
$$;

REVOKE ALL ON FUNCTION notification_is_currently_visible(uuid,uuid) FROM PUBLIC;

DO $$
DECLARE runtime_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO runtime_owner
  FROM pg_class WHERE oid='notifications'::regclass;
  EXECUTE format(
    'ALTER FUNCTION notification_departure_plan_exception_is_currently_authorized(uuid,uuid) OWNER TO %I',
    runtime_owner
  );
  EXECUTE format(
    'ALTER FUNCTION notification_is_currently_visible(uuid,uuid) OWNER TO %I',
    runtime_owner
  );
END $$;

COMMENT ON FUNCTION notification_departure_plan_exception_is_currently_authorized(uuid,uuid) IS
  'Keeps a parent departure-plan exception visible only while the exact current plan revision remains unresolved and the guardian relationship is active.';

-- Backfill only current/future authoritative exception plans. This does not
-- infer state from notification copy, audit text or historical messages.
INSERT INTO notifications (
  recipient_id,kind,title,body,link,metadata,dedupe_key,
  attention_eligible,attention_school_id,attention_student_id,
  attention_portal,attention_module,attention_source_kind,
  attention_source_id,attention_source_revision,attention_topic_key
)
SELECT DISTINCT guardian.user_id,'general','Departure plan needs attention',
  'The current departure arrangement needs school and family review before collection.',
  '/parent/departure?student_id='||plan.student_id::text||
    '&date='||plan.service_date::text||'&plan_id='||plan.id::text||
    '&plan_revision='||plan.revision::text,
  jsonb_build_object(
    'student_id',plan.student_id,
    'notification_scope','departure_plan_exception'
  ),
  'attention:departure-plan-exception:'||plan.id::text||':'||plan.revision::text,
  true,plan.school_id,plan.student_id,'parent','departure',
  'departure_plan_exception',plan.id,plan.revision,'departure-plan:'||plan.id::text
FROM departure_plans plan
JOIN schools school ON school.id=plan.school_id
JOIN guardian_relationships relationship
  ON relationship.school_id=plan.school_id
  AND relationship.student_id=plan.student_id
JOIN parents guardian ON guardian.id=relationship.guardian_id
JOIN users account
  ON account.id=guardian.user_id
  AND account.is_active
  AND account.role='parent'
JOIN school_memberships membership
  ON membership.school_id=plan.school_id
  AND membership.user_id=guardian.user_id
  AND membership.role='guardian'
  AND membership.is_active
WHERE plan.is_current
  AND plan.state='exception'
  AND plan.service_date >= (now() AT TIME ZONE school.timezone)::date
ON CONFLICT (recipient_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
