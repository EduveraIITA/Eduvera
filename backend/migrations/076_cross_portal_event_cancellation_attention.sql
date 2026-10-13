-- Event cancellation is a material operational change for assigned staff and
-- administrators as well as families. Extend the existing typed contract
-- without turning routine event publication or completion into attention.
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
        'transport_rider_exception','departure_handover_exception'
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
        ELSE false
      END
    )
  );

-- Safely promote retained cancellation bells created before this migration.
-- The authoritative outbox kind and exact aggregate revision are required;
-- titles or body copy are never used to infer attention semantics.
WITH cancellation_candidates AS (
  SELECT notification.id,event.id AS event_id,event.school_id,event.revision,recipient.role
  FROM notifications notification
  JOIN event_outbox source ON notification.dedupe_key='event:'||source.id::text
  JOIN campus_events event
    ON event.school_id=source.school_id
    AND event.id=source.aggregate_id
    AND event.status='cancelled'
    AND event.revision=CASE
      WHEN COALESCE(source.payload->>'revision','') ~ '^[1-9][0-9]*$'
      THEN (source.payload->>'revision')::integer ELSE NULL END
  JOIN users recipient ON recipient.id=notification.recipient_id AND recipient.is_active
  JOIN school_memberships membership
    ON membership.school_id=event.school_id
    AND membership.user_id=recipient.id
    AND membership.is_active
    AND membership.role::text=recipient.role
  WHERE NOT notification.attention_eligible
    AND source.event_type='campus_event.updated'
    AND source.payload->>'change_kind'='cancelled'
    AND recipient.role IN ('staff','admin')
    AND (
      recipient.role='admin'
      OR EXISTS (
        SELECT 1
        FROM staff_role_bindings binding
        WHERE binding.school_id=event.school_id
          AND binding.user_id=recipient.id
          AND binding.context_kind='event'
          AND binding.scope_id=event.id
          AND binding.role_active
          AND (binding.source_kind='event_assignment' OR binding.status='active')
          AND 'events.view'=ANY(binding.permissions)
          AND binding.starts_on<=current_date
          AND (binding.ends_on IS NULL OR binding.ends_on>=current_date)
      )
    )
)
UPDATE notifications notification
SET link='/'||CASE candidate.role WHEN 'staff' THEN 'teacher' ELSE 'principal' END
      ||'/events/'||candidate.event_id::text
      ||'?focus=status&event_revision='||candidate.revision::text,
    metadata=COALESCE(notification.metadata,'{}'::jsonb)||jsonb_build_object(
      'event_id',candidate.event_id,
      'attention_eligible',true,
      'attention_module','events',
      'attention_source_kind','event_cancellation',
      'attention_source_id',candidate.event_id,
      'attention_source_revision',candidate.revision,
      'attention_topic_key','event-cancellation:'||candidate.event_id::text
    ),
    attention_eligible=true,
    attention_school_id=candidate.school_id,
    attention_portal=CASE candidate.role WHEN 'staff' THEN 'teacher' ELSE 'principal' END,
    attention_module='events',
    attention_source_kind='event_cancellation',
    attention_source_id=candidate.event_id,
    attention_source_revision=candidate.revision,
    attention_topic_key='event-cancellation:'||candidate.event_id::text
FROM cancellation_candidates candidate
WHERE notification.id=candidate.id;

-- Keep every established typed source on the existing authorization chain.
-- Only the newly widened event-cancellation portal scope is handled here.
ALTER FUNCTION notification_attention_is_currently_authorized(uuid,uuid)
  RENAME TO notification_attention_authorized_before_event_portals;

CREATE FUNCTION notification_attention_is_currently_authorized(
  notification_id uuid,
  actor uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public
AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN notification.attention_source_kind<>'event_cancellation'
        OR notification.attention_portal='parent'
      THEN notification_attention_authorized_before_event_portals(
        notification.id,
        actor
      )
      WHEN notification.attention_portal IN ('teacher','principal') THEN EXISTS (
        SELECT 1
        FROM users account
        JOIN school_memberships membership
          ON membership.school_id=notification.attention_school_id
          AND membership.user_id=notification.recipient_id
          AND membership.is_active
          AND membership.role::text=CASE notification.attention_portal
            WHEN 'teacher' THEN 'staff'
            WHEN 'principal' THEN 'admin'
            ELSE ''
          END
        JOIN campus_events event
          ON event.id=notification.attention_source_id
          AND event.school_id=notification.attention_school_id
          AND event.status='cancelled'
          AND event.revision=notification.attention_source_revision
        WHERE account.id=notification.recipient_id
          AND account.is_active
          AND notification.recipient_id=actor
          AND notification.attention_eligible
          AND notification.attention_student_id IS NULL
          AND (
            notification.attention_portal='principal'
            OR EXISTS (
              SELECT 1
              FROM staff_role_bindings binding
              WHERE binding.school_id=event.school_id
                AND binding.user_id=notification.recipient_id
                AND binding.context_kind='event'
                AND binding.scope_id=event.id
                AND binding.role_active
                AND (binding.source_kind='event_assignment' OR binding.status='active')
                AND 'events.view'=ANY(binding.permissions)
                AND binding.starts_on<=current_date
                AND (binding.ends_on IS NULL OR binding.ends_on>=current_date)
            )
          )
      )
      ELSE false
    END
    FROM notifications notification
    WHERE notification.id=notification_id
  ),false)
$$;

-- SQL functions bind referenced function OIDs when they are parsed. The
-- legacy visibility fallback therefore still points at the authorization
-- function that existed before this migration. Recreate the outer dispatcher
-- so typed rows always call the widened current-authorization contract, while
-- generic outbox rows and source-free legacy alerts keep their existing paths.
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
  notification_event text;
BEGIN
  SELECT notification.dedupe_key,notification.attention_eligible
    INTO notification_dedupe,notification_attention
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

REVOKE ALL ON FUNCTION notification_attention_is_currently_authorized(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION notification_attention_authorized_before_event_portals(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION notification_is_currently_visible(uuid,uuid) FROM PUBLIC;

DO $$
DECLARE runtime_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO runtime_owner
  FROM pg_class WHERE oid='notifications'::regclass;
  EXECUTE format(
    'ALTER FUNCTION notification_attention_is_currently_authorized(uuid,uuid) OWNER TO %I',
    runtime_owner
  );
  EXECUTE format(
    'ALTER FUNCTION notification_attention_authorized_before_event_portals(uuid,uuid) OWNER TO %I',
    runtime_owner
  );
  EXECUTE format(
    'ALTER FUNCTION notification_is_currently_visible(uuid,uuid) OWNER TO %I',
    runtime_owner
  );
END $$;

COMMENT ON FUNCTION notification_attention_is_currently_authorized(uuid,uuid) IS
  'Rechecks the current source, membership, guardian relationship and assigned event access for typed notification reads.';
