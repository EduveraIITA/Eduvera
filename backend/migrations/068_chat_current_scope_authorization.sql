-- Child-scoped chat access is derived from current school relationships, never
-- from a participant row or a client-supplied student filter alone.
CREATE FUNCTION chat_actor_has_student_scope(
  tenant uuid,
  actor uuid,
  action text,
  student uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public
AS $$
  SELECT action=ANY(ARRAY['messages.view','messages.send','groups.create']) AND EXISTS (
    SELECT 1
    FROM students context_student
    JOIN school_memberships membership
      ON membership.school_id=context_student.school_id
      AND membership.user_id=actor
      AND membership.is_active
    JOIN users account
      ON account.id=membership.user_id
      AND account.is_active
    WHERE context_student.school_id=tenant
      AND context_student.id=student
      AND (
        membership.role='admin'
        OR (
          membership.role='staff'
          AND staff_has_student_permission(tenant,actor,action,context_student.id)
        )
        OR (
          membership.role='student'
          AND context_student.user_id=membership.user_id
        )
        OR (
          membership.role='guardian'
          AND EXISTS (
            SELECT 1
            FROM parents guardian
            JOIN guardian_relationships relationship
              ON relationship.guardian_id=guardian.id
              AND relationship.school_id=context_student.school_id
              AND relationship.student_id=context_student.id
            WHERE guardian.user_id=membership.user_id
          )
        )
      )
  )
$$;

CREATE FUNCTION chat_actor_is_current_participant(
  tenant uuid,
  actor uuid,
  action text,
  conversation uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public
AS $$
  SELECT action=ANY(ARRAY['messages.view','messages.send']) AND EXISTS (
    SELECT 1
    FROM chat_conversations thread
    JOIN chat_participants participant
      ON participant.conversation_id=thread.id
      AND participant.user_id=actor
      AND participant.is_active
    JOIN school_memberships membership
      ON membership.school_id=thread.school_id
      AND membership.user_id=participant.user_id
      AND membership.is_active
    JOIN users account
      ON account.id=membership.user_id
      AND account.is_active
    WHERE thread.school_id=tenant
      AND thread.id=conversation
      AND (
        membership.role<>'staff'
        OR staff_has_conversation_permission(
          thread.school_id,membership.user_id,action,thread.id
        )
      )
      AND (
        thread.context_student_id IS NULL
        OR chat_actor_has_student_scope(
          thread.school_id,membership.user_id,action,thread.context_student_id
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION chat_actor_has_student_scope(uuid,uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION chat_actor_is_current_participant(uuid,uuid,text,uuid) FROM PUBLIC;

-- Keep the existing single-column FK's delete behavior, and add tenant
-- integrity without rewriting existing rows. Validation makes deployment fail
-- closed if historical data contains a cross-school child reference.
ALTER TABLE chat_conversations
  ADD CONSTRAINT chat_conversation_context_student_school_fk
  FOREIGN KEY(school_id,context_student_id)
  REFERENCES students(school_id,id)
  NOT VALID;
ALTER TABLE chat_conversations
  VALIDATE CONSTRAINT chat_conversation_context_student_school_fk;

-- Durable chat replay applies the same current participant policy as request
-- handling. The frozen event audience remains only a delivery hint.
ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid)
  RENAME TO event_user_is_authorized_before_chat_current_scope;

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
    FROM chat_conversations thread
    WHERE thread.school_id=event_school_id
      AND thread.id::text=event_payload->>'conversation_id'
      AND chat_actor_is_current_participant(
        thread.school_id,
        candidate_user_id,
        'messages.view',
        thread.id
      )
  )
  ELSE event_user_is_authorized_before_chat_current_scope(
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
    'ALTER FUNCTION chat_actor_has_student_scope(uuid,uuid,text,uuid) OWNER TO %I',
    runtime_owner
  );
  EXECUTE format(
    'ALTER FUNCTION chat_actor_is_current_participant(uuid,uuid,text,uuid) OWNER TO %I',
    runtime_owner
  );
  EXECUTE format(
    'ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO %I',
    runtime_owner
  );
END $$;
