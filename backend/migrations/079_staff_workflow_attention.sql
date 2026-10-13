-- Durable, exact attention contracts for staff work, leave review and
-- transport duty-swap lifecycles. Source tables remain authoritative: copied
-- notification text never grants visibility or an action.
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
        'fees','safeguarding','policies','departure','staff',
        'responsibilities','transport'
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
        'departure_plan_exception','responsibility_offer',
        'responsibility_response','responsibility_revocation',
        'coverage_offer','coverage_response','staff_leave_review',
        'transport_swap','transport_swap_approval','transport_swap_response',
        'transport_swap_decision'
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
        WHEN 'responsibility_offer' THEN attention_portal='teacher' AND attention_module='responsibilities' AND attention_student_id IS NULL
        WHEN 'responsibility_response' THEN attention_portal='principal' AND attention_module='staff' AND attention_student_id IS NULL
        WHEN 'responsibility_revocation' THEN attention_portal='teacher' AND attention_module='responsibilities' AND attention_student_id IS NULL
        WHEN 'coverage_offer' THEN attention_portal='teacher' AND attention_module='responsibilities' AND attention_student_id IS NULL
        WHEN 'coverage_response' THEN attention_portal='principal' AND attention_module='staff' AND attention_student_id IS NULL
        WHEN 'staff_leave_review' THEN attention_portal='principal' AND attention_module='staff' AND attention_student_id IS NULL
        WHEN 'transport_swap' THEN attention_portal='teacher' AND attention_module='transport' AND attention_student_id IS NULL
        WHEN 'transport_swap_approval' THEN attention_portal='principal' AND attention_module='departure' AND attention_student_id IS NULL
        WHEN 'transport_swap_response' THEN attention_portal='teacher' AND attention_module='transport' AND attention_student_id IS NULL
        WHEN 'transport_swap_decision' THEN attention_portal='teacher' AND attention_module='transport' AND attention_student_id IS NULL
        ELSE false
      END
    )
  );

CREATE FUNCTION notification_staff_workflow_is_currently_authorized(
  notification_id uuid,
  actor uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=public
AS $$
DECLARE
  source_kind text;
  source_id uuid;
  source_revision integer;
  source_school uuid;
BEGIN
  SELECT notification.attention_source_kind,notification.attention_source_id,
    notification.attention_source_revision,notification.attention_school_id
    INTO source_kind,source_id,source_revision,source_school
  FROM notifications notification
  JOIN users account
    ON account.id=notification.recipient_id
    AND account.is_active
    AND (
      (notification.attention_portal='teacher' AND account.role='staff')
      OR (notification.attention_portal='principal' AND account.role='admin')
    )
  JOIN school_memberships membership
    ON membership.school_id=notification.attention_school_id
    AND membership.user_id=notification.recipient_id
    AND membership.is_active
    AND membership.role=CASE notification.attention_portal
      WHEN 'teacher' THEN 'staff'
      WHEN 'principal' THEN 'admin'
    END
  WHERE notification.id=notification_id
    AND notification.recipient_id=actor
    AND notification.attention_eligible
    AND notification.attention_source_kind IN (
      'responsibility_offer','responsibility_response','responsibility_revocation',
      'coverage_offer','coverage_response','staff_leave_review',
      'transport_swap','transport_swap_approval','transport_swap_response',
      'transport_swap_decision'
    );
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  CASE source_kind
    WHEN 'responsibility_offer' THEN
      RETURN EXISTS (
        SELECT 1 FROM staff_responsibility_assignments assignment
        JOIN staff_profiles profile ON profile.id=assignment.staff_profile_id
        WHERE assignment.id=source_id AND assignment.school_id=source_school
          AND assignment.status='offered' AND assignment.revision=source_revision
          AND profile.school_id=source_school AND profile.status='active'
          AND profile.user_id=actor
      );
    WHEN 'responsibility_response' THEN
      RETURN EXISTS (
        SELECT 1 FROM staff_responsibility_assignments assignment
        WHERE assignment.id=source_id AND assignment.school_id=source_school
          AND assignment.status IN ('active','declined')
          AND assignment.revision=source_revision
      );
    WHEN 'responsibility_revocation' THEN
      RETURN EXISTS (
        SELECT 1 FROM staff_responsibility_assignments assignment
        JOIN staff_profiles profile ON profile.id=assignment.staff_profile_id
        WHERE assignment.id=source_id AND assignment.school_id=source_school
          AND assignment.status='revoked' AND assignment.revision=source_revision
          AND profile.school_id=source_school AND profile.user_id=actor
      );
    WHEN 'coverage_offer' THEN
      RETURN EXISTS (
        SELECT 1 FROM staff_coverage_tasks task
        JOIN staff_profiles profile ON profile.id=task.replacement_staff_profile_id
        WHERE task.id=source_id AND task.school_id=source_school
          AND task.status='offered' AND task.revision=source_revision
          AND profile.school_id=source_school AND profile.status='active'
          AND profile.user_id=actor
      );
    WHEN 'coverage_response' THEN
      RETURN EXISTS (
        SELECT 1 FROM staff_coverage_tasks task
        WHERE task.id=source_id AND task.school_id=source_school
          AND task.status IN ('accepted','declined')
          AND task.revision=source_revision
      );
    WHEN 'staff_leave_review' THEN
      RETURN EXISTS (
        SELECT 1 FROM staff_leave_requests request
        WHERE request.id=source_id AND request.school_id=source_school
          AND request.status='submitted' AND request.revision=source_revision
      );
    WHEN 'transport_swap' THEN
      RETURN EXISTS (
        SELECT 1
        FROM transport_duty_swap_requests swap
        JOIN transport_trips requester_trip ON requester_trip.id=swap.requester_trip_id
          AND requester_trip.school_id=swap.school_id
        JOIN schools school ON school.id=swap.school_id
        LEFT JOIN transport_trips target_trip ON target_trip.id=swap.target_trip_id
          AND target_trip.school_id=swap.school_id
        WHERE swap.id=source_id AND swap.school_id=source_school
          AND swap.status='submitted' AND swap.revision=source_revision
          AND swap.target_user_id=actor
          AND requester_trip.assigned_collector_user_id=swap.requester_user_id
          AND requester_trip.state='planned' AND requester_trip.roster_frozen_at IS NULL
          AND requester_trip.revision=swap.requester_trip_revision
          AND now()<((requester_trip.service_date+requester_trip.scheduled_departure_time)
            AT TIME ZONE school.timezone)-interval '30 minutes'
          AND (
            swap.request_type='cover'
            OR (
              target_trip.id IS NOT NULL
              AND target_trip.assigned_collector_user_id=swap.target_user_id
              AND target_trip.state='planned' AND target_trip.roster_frozen_at IS NULL
              AND target_trip.revision=swap.target_trip_revision
              AND now()<((target_trip.service_date+target_trip.scheduled_departure_time)
                AT TIME ZONE school.timezone)-interval '30 minutes'
            )
          )
      );
    WHEN 'transport_swap_approval' THEN
      RETURN EXISTS (
        SELECT 1
        FROM transport_duty_swap_requests swap
        JOIN transport_trips requester_trip ON requester_trip.id=swap.requester_trip_id
          AND requester_trip.school_id=swap.school_id
        JOIN schools school ON school.id=swap.school_id
        LEFT JOIN transport_trips target_trip ON target_trip.id=swap.target_trip_id
          AND target_trip.school_id=swap.school_id
        WHERE swap.id=source_id AND swap.school_id=source_school
          AND swap.status='accepted' AND swap.revision=source_revision
          AND requester_trip.assigned_collector_user_id=swap.requester_user_id
          AND requester_trip.state='planned' AND requester_trip.roster_frozen_at IS NULL
          AND requester_trip.revision=swap.requester_trip_revision
          AND now()<((requester_trip.service_date+requester_trip.scheduled_departure_time)
            AT TIME ZONE school.timezone)-interval '30 minutes'
          AND (
            swap.request_type='cover'
            OR (
              target_trip.id IS NOT NULL
              AND target_trip.assigned_collector_user_id=swap.target_user_id
              AND target_trip.state='planned' AND target_trip.roster_frozen_at IS NULL
              AND target_trip.revision=swap.target_trip_revision
              AND now()<((target_trip.service_date+target_trip.scheduled_departure_time)
                AT TIME ZONE school.timezone)-interval '30 minutes'
            )
          )
      );
    WHEN 'transport_swap_response' THEN
      RETURN EXISTS (
        SELECT 1 FROM transport_duty_swap_requests swap
        WHERE swap.id=source_id AND swap.school_id=source_school
          AND swap.status IN ('accepted','rejected')
          AND swap.revision=source_revision
          AND swap.requester_user_id=actor
      );
    WHEN 'transport_swap_decision' THEN
      RETURN EXISTS (
        SELECT 1 FROM transport_duty_swap_requests swap
        WHERE swap.id=source_id AND swap.school_id=source_school
          AND swap.status IN ('approved','declined_by_school')
          AND swap.revision=source_revision
          AND actor IN (swap.requester_user_id,swap.target_user_id)
      );
    ELSE
      RETURN false;
  END CASE;
END
$$;

REVOKE ALL ON FUNCTION notification_staff_workflow_is_currently_authorized(uuid,uuid) FROM PUBLIC;

-- Keep the departure-plan exception's dedicated fail-closed path, and route
-- only the newly introduced staff workflow kinds through the helper above.
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
    ELSIF notification_source_kind IN (
      'responsibility_offer','responsibility_response','responsibility_revocation',
      'coverage_offer','coverage_response','staff_leave_review',
      'transport_swap','transport_swap_approval','transport_swap_response',
      'transport_swap_decision'
    ) THEN
      RETURN notification_staff_workflow_is_currently_authorized(
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
    'ALTER FUNCTION notification_staff_workflow_is_currently_authorized(uuid,uuid) OWNER TO %I',
    runtime_owner
  );
  EXECUTE format(
    'ALTER FUNCTION notification_is_currently_visible(uuid,uuid) OWNER TO %I',
    runtime_owner
  );
END $$;

COMMENT ON FUNCTION notification_staff_workflow_is_currently_authorized(uuid,uuid) IS
  'Authorizes exact staff responsibility, coverage, leave-review and transport-swap attention against current membership, recipient, status, revision, assignment and response-window state.';

-- Backfill only live, authoritative obligations. Historical outcomes are not
-- reconstructed from prose or audit copy.
INSERT INTO notifications (
  recipient_id,kind,title,body,link,metadata,dedupe_key,
  attention_eligible,attention_school_id,attention_portal,attention_module,
  attention_source_kind,attention_source_id,attention_source_revision,
  attention_topic_key
)
SELECT profile.user_id,'general','New work assignment',
  responsibility.name||' needs your response.',
  '/teacher/responsibilities?assignment='||assignment.id::text||
    '&assignment_revision='||assignment.revision::text,
  jsonb_build_object('attention_subject_label',responsibility.name),
  'attention:responsibility-offer:'||assignment.id::text||':'||assignment.revision::text,
  true,assignment.school_id,'teacher','responsibilities','responsibility_offer',
  assignment.id,assignment.revision,'staff-responsibility:'||assignment.id::text
FROM staff_responsibility_assignments assignment
JOIN staff_responsibility_types responsibility ON responsibility.id=assignment.responsibility_type_id
JOIN staff_profiles profile ON profile.id=assignment.staff_profile_id
JOIN users account ON account.id=profile.user_id AND account.is_active AND account.role='staff'
JOIN school_memberships membership ON membership.school_id=assignment.school_id
  AND membership.user_id=profile.user_id AND membership.role='staff' AND membership.is_active
WHERE assignment.status='offered' AND profile.status='active'
ON CONFLICT DO NOTHING;

INSERT INTO notifications (
  recipient_id,kind,title,body,link,metadata,dedupe_key,
  attention_eligible,attention_school_id,attention_portal,attention_module,
  attention_source_kind,attention_source_id,attention_source_revision,
  attention_topic_key
)
SELECT profile.user_id,'general','Cover duty offered',
  task.title||' on '||task.duty_date::text||' needs your response.',
  '/teacher/responsibilities?coverage='||task.id::text||
    '&coverage_revision='||task.revision::text,
  jsonb_build_object('attention_subject_label',task.title),
  'attention:coverage-offer:'||task.id::text||':'||task.revision::text,
  true,task.school_id,'teacher','responsibilities','coverage_offer',
  task.id,task.revision,'staff-coverage:'||task.id::text
FROM staff_coverage_tasks task
JOIN staff_profiles profile ON profile.id=task.replacement_staff_profile_id
JOIN users account ON account.id=profile.user_id AND account.is_active AND account.role='staff'
JOIN school_memberships membership ON membership.school_id=task.school_id
  AND membership.user_id=profile.user_id AND membership.role='staff' AND membership.is_active
WHERE task.status='offered' AND profile.status='active'
ON CONFLICT DO NOTHING;

INSERT INTO notifications (
  recipient_id,kind,title,body,link,metadata,dedupe_key,
  attention_eligible,attention_school_id,attention_portal,attention_module,
  attention_source_kind,attention_source_id,attention_source_revision,
  attention_topic_key
)
SELECT membership.user_id,'leave','Staff leave needs review',
  trim(concat_ws(' ',profile.first_name,profile.last_name))||' requested leave.',
  '/principal/staff?section=leave&request='||request.id::text||
    '&request_revision='||request.revision::text,
  jsonb_build_object('attention_subject_label',trim(concat_ws(' ',profile.first_name,profile.last_name))),
  'attention:staff-leave-review:'||request.id::text||':'||request.revision::text||':'||membership.user_id::text,
  true,request.school_id,'principal','staff','staff_leave_review',
  request.id,request.revision,'staff-leave-review:'||request.id::text
FROM staff_leave_requests request
JOIN staff_profiles profile ON profile.id=request.staff_profile_id
JOIN school_memberships membership ON membership.school_id=request.school_id
  AND membership.role='admin' AND membership.is_active
JOIN users account ON account.id=membership.user_id AND account.is_active AND account.role='admin'
WHERE request.status='submitted'
ON CONFLICT DO NOTHING;

INSERT INTO notifications (
  recipient_id,kind,title,body,link,metadata,dedupe_key,
  attention_eligible,attention_school_id,attention_portal,attention_module,
  attention_source_kind,attention_source_id,attention_source_revision,
  attention_topic_key
)
SELECT swap.target_user_id,'general','Duty change needs your response',
  CASE swap.request_type WHEN 'exchange' THEN 'A colleague requested a journey exchange.'
    ELSE 'A colleague asked you to cover a journey.' END,
  '/teacher/transport?swap='||swap.id::text||'&swap_revision='||swap.revision::text,
  '{}'::jsonb,
  'attention:transport-swap:'||swap.id::text||':'||swap.revision::text||':teacher',
  true,swap.school_id,'teacher','transport','transport_swap',swap.id,swap.revision,
  'transport-duty-swap:'||swap.id::text
FROM transport_duty_swap_requests swap
JOIN transport_trips requester_trip ON requester_trip.id=swap.requester_trip_id
  AND requester_trip.school_id=swap.school_id
JOIN schools school ON school.id=swap.school_id
JOIN users account ON account.id=swap.target_user_id AND account.is_active AND account.role='staff'
JOIN school_memberships membership ON membership.school_id=swap.school_id
  AND membership.user_id=swap.target_user_id AND membership.role='staff' AND membership.is_active
LEFT JOIN transport_trips target_trip ON target_trip.id=swap.target_trip_id
  AND target_trip.school_id=swap.school_id
WHERE swap.status='submitted'
  AND requester_trip.assigned_collector_user_id=swap.requester_user_id
  AND requester_trip.state='planned' AND requester_trip.roster_frozen_at IS NULL
  AND requester_trip.revision=swap.requester_trip_revision
  AND now()<((requester_trip.service_date+requester_trip.scheduled_departure_time)
    AT TIME ZONE school.timezone)-interval '30 minutes'
  AND (swap.request_type='cover' OR (
    target_trip.id IS NOT NULL
    AND target_trip.assigned_collector_user_id=swap.target_user_id
    AND target_trip.state='planned' AND target_trip.roster_frozen_at IS NULL
    AND target_trip.revision=swap.target_trip_revision
    AND now()<((target_trip.service_date+target_trip.scheduled_departure_time)
      AT TIME ZONE school.timezone)-interval '30 minutes'
  ))
ON CONFLICT DO NOTHING;

INSERT INTO notifications (
  recipient_id,kind,title,body,link,metadata,dedupe_key,
  attention_eligible,attention_school_id,attention_portal,attention_module,
  attention_source_kind,attention_source_id,attention_source_revision,
  attention_topic_key
)
SELECT membership.user_id,'general','Duty change needs approval',
  'Two staff members agreed a transport duty change. Review it before the journey.',
  '/principal/departure?section=roster&swap='||swap.id::text||'&swap_revision='||swap.revision::text,
  '{}'::jsonb,
  'attention:transport-swap-approval:'||swap.id::text||':'||swap.revision::text||':'||membership.user_id::text,
  true,swap.school_id,'principal','departure','transport_swap_approval',swap.id,swap.revision,
  'transport-duty-swap:'||swap.id::text
FROM transport_duty_swap_requests swap
JOIN transport_trips requester_trip ON requester_trip.id=swap.requester_trip_id
  AND requester_trip.school_id=swap.school_id
JOIN schools school ON school.id=swap.school_id
JOIN school_memberships membership ON membership.school_id=swap.school_id
  AND membership.role='admin' AND membership.is_active
JOIN users account ON account.id=membership.user_id AND account.is_active AND account.role='admin'
LEFT JOIN transport_trips target_trip ON target_trip.id=swap.target_trip_id
  AND target_trip.school_id=swap.school_id
WHERE swap.status='accepted'
  AND requester_trip.assigned_collector_user_id=swap.requester_user_id
  AND requester_trip.state='planned' AND requester_trip.roster_frozen_at IS NULL
  AND requester_trip.revision=swap.requester_trip_revision
  AND now()<((requester_trip.service_date+requester_trip.scheduled_departure_time)
    AT TIME ZONE school.timezone)-interval '30 minutes'
  AND (swap.request_type='cover' OR (
    target_trip.id IS NOT NULL
    AND target_trip.assigned_collector_user_id=swap.target_user_id
    AND target_trip.state='planned' AND target_trip.roster_frozen_at IS NULL
    AND target_trip.revision=swap.target_trip_revision
    AND now()<((target_trip.service_date+target_trip.scheduled_departure_time)
      AT TIME ZONE school.timezone)-interval '30 minutes'
  ))
ON CONFLICT DO NOTHING;
