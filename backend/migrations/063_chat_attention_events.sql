-- Content-free chat invalidations keep unread conversation attention current.
-- Delivery always rechecks that the user is still an active participant with
-- an active school membership; the frozen audience is only a routing hint.
ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid)
  RENAME TO event_user_is_authorized_before_chat_attention;

CREATE FUNCTION event_user_is_authorized(
  event_school_id uuid,
  event_name text,
  event_payload jsonb,
  candidate_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public
AS $$
  SELECT CASE WHEN event_name='chat.updated' THEN EXISTS (
    SELECT 1
    FROM chat_conversations conversation
    JOIN chat_participants participant
      ON participant.conversation_id=conversation.id
      AND participant.user_id=candidate_user_id
      AND participant.is_active
    JOIN school_memberships membership
      ON membership.school_id=conversation.school_id
      AND membership.user_id=participant.user_id
      AND membership.is_active
    JOIN users account
      ON account.id=membership.user_id
      AND account.is_active
    WHERE conversation.school_id=event_school_id
      AND conversation.id::text=event_payload->>'conversation_id'
      AND (
        membership.role<>'staff'
        OR staff_has_conversation_permission(
          conversation.school_id,
          membership.user_id,
          'messages.view',
          conversation.id
        )
      )
  ) ELSE event_user_is_authorized_before_chat_attention(
    event_school_id,event_name,event_payload,candidate_user_id
  ) END
$$;

REVOKE ALL ON FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) FROM PUBLIC;

DO $$
DECLARE runtime_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO runtime_owner
  FROM pg_class WHERE oid='chat_conversations'::regclass;
  EXECUTE format(
    'ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO %I',
    runtime_owner
  );
END $$;
