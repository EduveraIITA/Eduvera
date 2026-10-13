-- Bell reads evaluate current authorization row by row. Keep the durable
-- event authorization chain as the compatibility fallback, but fast-path the
-- high-volume notification producers against their live source records. A
-- PL/pgSQL dispatcher also prevents PostgreSQL from planning every unrelated
-- CASE branch for each bell row.

ALTER FUNCTION notification_is_currently_visible(uuid,uuid)
  RENAME TO notification_is_currently_visible_before_event_optimization;

CREATE FUNCTION notification_event_is_currently_visible(
  notification_event uuid,
  actor uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=public
AS $$
DECLARE
  source event_outbox%ROWTYPE;
  actor_role text;
  source_status text;
BEGIN
  SELECT event.* INTO source
  FROM event_outbox event
  WHERE event.id=notification_event;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT membership.role::text INTO actor_role
  FROM school_memberships membership
  JOIN users account
    ON account.id=membership.user_id
    AND account.is_active
  WHERE membership.school_id=source.school_id
    AND membership.user_id=actor
    AND membership.is_active;
  IF actor_role IS NULL THEN
    RETURN false;
  END IF;

  -- Attendance outcome notifications are emitted only for the learner and
  -- their guardians. Re-check that relationship rather than trusting the
  -- frozen outbox audience.
  IF source.event_type='attendance.updated' THEN
    IF COALESCE(source.payload->>'student_id','') !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RETURN false;
    END IF;
    RETURN notification_actor_has_current_student_scope(
      (source.payload->>'student_id')::uuid,
      actor
    );
  END IF;

  -- Overdue-register alerts remain visible only to a current administrator or
  -- the teacher responsible for that exact scheduled class occurrence.
  IF source.event_type='attendance.register.overdue' THEN
    IF actor_role='admin' THEN
      RETURN true;
    END IF;
    IF actor_role<>'staff'
      OR COALESCE(source.payload->>'class_section_id','') !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR COALESCE(source.payload->>'term_id','') !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR COALESCE(source.payload->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RETURN false;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM effective_school_schedule(
        source.school_id,
        (source.payload->>'date')::date
      ) slot
      WHERE slot.class_section_id=(source.payload->>'class_section_id')::uuid
        AND slot.term_id=(source.payload->>'term_id')::uuid
        AND slot.teacher_user_id=actor
        AND slot.slot_type IN ('class','activity')
        AND NOT slot.cancelled
        AND slot.coverage_status IN ('not_required','accepted')
    );
  END IF;

  IF source.event_type='staff.leave.submitted' THEN
    RETURN actor_role='admin' AND EXISTS (
      SELECT 1 FROM staff_leave_requests request
      WHERE request.school_id=source.school_id
        AND request.id=source.aggregate_id
        AND request.status='submitted'
    );
  END IF;

  IF source.event_type IN ('staff.leave.approved','staff.leave.rejected') THEN
    source_status := split_part(source.event_type,'.',3);
    RETURN actor_role='staff' AND EXISTS (
      SELECT 1
      FROM staff_leave_requests request
      JOIN staff_profiles profile
        ON profile.id=request.staff_profile_id
        AND profile.school_id=request.school_id
      WHERE request.school_id=source.school_id
        AND request.id=source.aggregate_id
        AND request.status=source_status
        AND profile.status='active'
        AND profile.user_id=actor
    );
  END IF;

  IF source.event_type='staff.responsibility.offered' THEN
    RETURN actor_role='staff' AND EXISTS (
      SELECT 1
      FROM staff_responsibility_assignments assignment
      JOIN staff_profiles profile
        ON profile.id=assignment.staff_profile_id
        AND profile.school_id=assignment.school_id
      WHERE assignment.school_id=source.school_id
        AND assignment.id=source.aggregate_id
        AND assignment.status='offered'
        AND profile.status='active'
        AND profile.user_id=actor
    );
  END IF;

  IF source.event_type IN (
    'staff.responsibility.accepted',
    'staff.responsibility.declined'
  ) THEN
    source_status := split_part(source.event_type,'.',3);
    RETURN actor_role='admin' AND EXISTS (
      SELECT 1 FROM staff_responsibility_assignments assignment
      WHERE assignment.school_id=source.school_id
        AND assignment.id=source.aggregate_id
        AND assignment.status=source_status
    );
  END IF;

  IF source.event_type='staff.coverage.offered' THEN
    RETURN actor_role='staff' AND EXISTS (
      SELECT 1
      FROM staff_coverage_tasks task
      JOIN staff_profiles profile
        ON profile.id=task.replacement_staff_profile_id
        AND profile.school_id=task.school_id
      WHERE task.school_id=source.school_id
        AND task.id=source.aggregate_id
        AND task.status='offered'
        AND profile.status='active'
        AND profile.user_id=actor
    );
  END IF;

  IF source.event_type IN ('staff.coverage.accepted','staff.coverage.declined') THEN
    source_status := split_part(source.event_type,'.',3);
    RETURN actor_role='admin' AND EXISTS (
      SELECT 1 FROM staff_coverage_tasks task
      WHERE task.school_id=source.school_id
        AND task.id=source.aggregate_id
        AND task.status=source_status
    );
  END IF;

  IF source.event_type='governance.policy.submitted' THEN
    RETURN actor_role='admin' AND EXISTS (
      SELECT 1 FROM institution_policy_versions version
      WHERE version.school_id=source.school_id
        AND version.id=source.aggregate_id
        AND version.status='in_review'
    );
  END IF;

  -- Other established event producers retain the canonical current-scope
  -- policy assembled by their domain migrations. The frozen audience is never
  -- used as authorization.
  RETURN event_user_is_authorized(
    source.school_id,
    source.event_type,
    source.payload,
    actor
  );
END
$$;

CREATE FUNCTION notification_is_currently_visible(
  notification_id uuid,
  actor uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=public
AS $$
DECLARE
  notification_dedupe text;
  notification_event text;
BEGIN
  SELECT notification.dedupe_key INTO notification_dedupe
  FROM notifications notification
  JOIN users account
    ON account.id=notification.recipient_id
    AND account.is_active
  WHERE notification.id=notification_id
    AND notification.recipient_id=actor;
  IF NOT FOUND THEN
    RETURN false;
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

REVOKE ALL ON FUNCTION notification_event_is_currently_visible(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION notification_is_currently_visible(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION notification_is_currently_visible_before_event_optimization(uuid,uuid) FROM PUBLIC;

DO $$
DECLARE runtime_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO runtime_owner
  FROM pg_class WHERE oid='notifications'::regclass;
  EXECUTE format(
    'ALTER FUNCTION notification_event_is_currently_visible(uuid,uuid) OWNER TO %I',
    runtime_owner
  );
  EXECUTE format(
    'ALTER FUNCTION notification_is_currently_visible(uuid,uuid) OWNER TO %I',
    runtime_owner
  );
  EXECUTE format(
    'ALTER FUNCTION notification_is_currently_visible_before_event_optimization(uuid,uuid) OWNER TO %I',
    runtime_owner
  );
END $$;
