-- Revision-aware notice attention and replay authorization.
ALTER TABLE school_notice_recipients
  ADD COLUMN last_seen_notice_revision integer NOT NULL DEFAULT 0
  CHECK (last_seen_notice_revision >= 0);

-- Preserve the meaning of opens recorded before revision-aware attention existed.
UPDATE school_notice_recipients recipient
SET last_seen_notice_revision=notice.revision
FROM school_notices notice
WHERE notice.id=recipient.notice_id
  AND recipient.opened_at IS NOT NULL;

CREATE INDEX school_notice_recipients_attention_user_idx
  ON school_notice_recipients(user_id, notice_id, last_seen_notice_revision)
  WHERE user_id IS NOT NULL;

CREATE INDEX school_notice_recipients_attention_guardian_idx
  ON school_notice_recipients(guardian_id, student_id, notice_id, last_seen_notice_revision)
  WHERE guardian_id IS NOT NULL;

-- Notice events are content-free invalidations, but durable replay still rechecks
-- the current recipient relationship or manager authority instead of accepting a
-- stale audience snapshot on its own.
ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid)
  RENAME TO event_user_is_authorized_before_notice_attention;

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
        membership.role='admin'
        OR (membership.role='staff' AND notice.created_by=membership.user_id)
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
  ) ELSE event_user_is_authorized_before_notice_attention(
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
    'ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO %I',
    runtime_owner
  );
END $$;
