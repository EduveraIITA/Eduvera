-- A membership revocation must reach the affected account's already-open event
-- stream so the client can refresh its authority immediately. The payload is a
-- minimal self-scoped signal; ordinary school events still require current
-- membership through the preceding authorization function.

ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid)
  RENAME TO event_user_is_authorized_before_membership_access;

CREATE FUNCTION event_user_is_authorized(
  event_school_id uuid,
  event_name text,
  event_payload jsonb,
  candidate_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public
AS $$
  SELECT CASE
    WHEN event_name='staff.access.updated'
      AND event_payload ? 'affected_user_id'
      AND event_payload->>'affected_user_id'=candidate_user_id::text
    THEN EXISTS (
      SELECT 1
      FROM users account
      JOIN school_memberships membership
        ON membership.user_id=account.id
        AND membership.school_id=event_school_id
      WHERE account.id=candidate_user_id
        AND account.is_active
    )
    ELSE event_user_is_authorized_before_membership_access(
      event_school_id,event_name,event_payload,candidate_user_id
    )
  END
$$;

REVOKE ALL ON FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) FROM PUBLIC;

DO $$
DECLARE runtime_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO runtime_owner
  FROM pg_class WHERE oid='event_outbox'::regclass;
  EXECUTE format(
    'ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO %I',
    runtime_owner
  );
END $$;

