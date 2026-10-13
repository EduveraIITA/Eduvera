-- Notice authorship is provenance, not a permanent authorization grant. Keep
-- manager reads, writes and durable replay on the same current-scope policy.
CREATE FUNCTION notice_actor_is_current_manager(
  tenant uuid,
  notice_id uuid,
  actor uuid,
  action text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public
AS $$
  SELECT action=ANY(ARRAY['messages.view','messages.send']) AND EXISTS (
    SELECT 1
    FROM school_notices notice
    JOIN school_memberships membership
      ON membership.school_id=notice.school_id
      AND membership.user_id=actor
      AND membership.is_active
    JOIN users account
      ON account.id=membership.user_id
      AND account.is_active
    WHERE notice.school_id=tenant
      AND notice.id=notice_id
      AND (
        membership.role='admin'
        OR (
          membership.role='staff'
          AND notice.created_by=actor
          AND EXISTS (
            SELECT 1 FROM school_notice_audiences audience
            WHERE audience.notice_id=notice.id
              AND audience.school_id=notice.school_id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM school_notice_audiences audience
            WHERE audience.notice_id=notice.id
              AND audience.school_id=notice.school_id
              AND (
                audience.audience_kind<>'class_guardians'
                OR audience.class_section_id IS NULL
                OR NOT staff_has_class_permission(
                  notice.school_id,
                  actor,
                  action,
                  audience.class_section_id
                )
              )
          )
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION notice_actor_is_current_manager(uuid,uuid,uuid,text) FROM PUBLIC;

-- Replace only the notice branch at the head of the replay-authorization chain.
-- Other event domains continue through the previously installed policy.
ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid)
  RENAME TO event_user_is_authorized_before_notice_scope;

CREATE FUNCTION event_user_is_authorized(
  event_school_id uuid,
  event_name text,
  event_payload jsonb,
  candidate_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public
AS $$
  SELECT CASE WHEN event_name='notice.updated' THEN EXISTS (
    SELECT 1
    FROM school_notices notice
    JOIN school_memberships membership
      ON membership.school_id=notice.school_id
      AND membership.user_id=candidate_user_id
      AND membership.is_active
    JOIN users account
      ON account.id=membership.user_id
      AND account.is_active
    WHERE notice.school_id=event_school_id
      AND notice.id::text=event_payload->>'notice_id'
      AND (
        notice_actor_is_current_manager(
          notice.school_id,
          notice.id,
          candidate_user_id,
          'messages.view'
        )
        OR EXISTS (
          SELECT 1
          FROM school_notice_recipients recipient
          WHERE recipient.notice_id=notice.id
            AND recipient.school_id=notice.school_id
            AND recipient.user_id=membership.user_id
            AND (
              NOT (event_payload ? 'recipient_id')
              OR recipient.id::text=event_payload->>'recipient_id'
            )
            AND (
              recipient.recipient_role IN ('staff','admin')
              OR (
                recipient.recipient_role='guardian'
                AND EXISTS (
                  SELECT 1
                  FROM parents guardian
                  JOIN guardian_relationships relationship
                    ON relationship.guardian_id=guardian.id
                    AND relationship.school_id=recipient.school_id
                    AND relationship.student_id=recipient.student_id
                  WHERE guardian.user_id=membership.user_id
                    AND guardian.id=recipient.guardian_id
                )
              )
            )
        )
      )
  ) ELSE event_user_is_authorized_before_notice_scope(
    event_school_id,event_name,event_payload,candidate_user_id
  ) END
$$;

REVOKE ALL ON FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) FROM PUBLIC;

DO $$
DECLARE runtime_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO runtime_owner
  FROM pg_class WHERE oid='school_notice_recipients'::regclass;
  EXECUTE format(
    'ALTER FUNCTION notice_actor_is_current_manager(uuid,uuid,uuid,text) OWNER TO %I',
    runtime_owner
  );
  EXECUTE format(
    'ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO %I',
    runtime_owner
  );
END $$;
