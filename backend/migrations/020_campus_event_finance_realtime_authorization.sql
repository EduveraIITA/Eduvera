-- A staff member with the explicit fees.manage grant is included in the
-- finance outbox audience even when they are not assigned to the event. Keep
-- live delivery and durable replay authorization consistent with that scope.
CREATE OR REPLACE FUNCTION event_user_is_authorized(
  event_school_id uuid,
  event_name text,
  event_payload jsonb,
  candidate_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public
AS $$
  SELECT CASE WHEN event_name='campus_event.updated' THEN EXISTS (
    SELECT 1 FROM campus_events event
    JOIN school_memberships membership ON membership.school_id=event.school_id
      AND membership.user_id=candidate_user_id AND membership.is_active
    JOIN users account ON account.id=membership.user_id AND account.is_active
    WHERE event.school_id=event_school_id AND event.id::text=event_payload->>'event_id'
      AND (
        membership.role='admin'
        OR (membership.role='staff' AND (
          EXISTS (
            SELECT 1 FROM campus_event_staff staff
            WHERE staff.event_id=event.id AND staff.school_id=event.school_id
              AND staff.user_id=membership.user_id
          )
          OR (
            event_payload->>'change_kind' IN ('participant_withdrawn','refund_recorded')
            AND EXISTS (
              SELECT 1 FROM school_permission_grants permission
              WHERE permission.school_id=event.school_id
                AND permission.user_id=membership.user_id
                AND permission.permission='fees.manage'
            )
          )
        ))
        OR (membership.role='student' AND event.status<>'draft' AND EXISTS (
          SELECT 1 FROM campus_event_participants participant
          JOIN students student ON student.id=participant.student_id
          WHERE participant.event_id=event.id AND participant.school_id=event.school_id
            AND student.user_id=membership.user_id
        ))
        OR (membership.role='guardian' AND event.status<>'draft' AND EXISTS (
          SELECT 1 FROM campus_event_participants participant
          JOIN guardian_relationships relationship ON relationship.student_id=participant.student_id
            AND relationship.school_id=participant.school_id
          JOIN parents parent ON parent.id=relationship.guardian_id
          WHERE participant.event_id=event.id AND participant.school_id=event.school_id
            AND parent.user_id=membership.user_id
        ))
      )
  ) ELSE event_user_is_authorized_before_campus_events(
    event_school_id,event_name,event_payload,candidate_user_id
  ) END
$$;

REVOKE ALL ON FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) FROM PUBLIC;

DO $$ DECLARE owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='students'::regclass;
  EXECUTE format(
    'ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO %I',
    owner_name
  );
END $$;
