-- A notification is a delivery hint, not an enduring authorization grant.
-- Re-check the current source relationship for both typed attention and older
-- bell rows. Unknown source-free rows remain valid personal/account messages;
-- every known school source fails closed when its relationship is revoked.

CREATE FUNCTION notification_actor_has_current_student_scope(
  notification_student uuid,
  actor uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM students student
    JOIN school_memberships membership
      ON membership.school_id=student.school_id
      AND membership.user_id=actor
      AND membership.is_active
    JOIN users account
      ON account.id=membership.user_id
      AND account.is_active
    WHERE student.id=notification_student
      AND (
        (membership.role='student' AND student.user_id=membership.user_id)
        OR (
          membership.role='guardian'
          AND EXISTS (
            SELECT 1
            FROM parents guardian
            JOIN guardian_relationships relationship
              ON relationship.guardian_id=guardian.id
              AND relationship.school_id=student.school_id
              AND relationship.student_id=student.id
            WHERE guardian.user_id=membership.user_id
          )
        )
      )
  )
$$;

CREATE FUNCTION notification_chat_report_is_current_reviewer(
  notification_report uuid,
  actor uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM chat_message_reports report
    JOIN chat_messages message ON message.id=report.message_id
    JOIN chat_conversations conversation ON conversation.id=message.conversation_id
    JOIN school_memberships membership
      ON membership.school_id=conversation.school_id
      AND membership.user_id=actor
      AND membership.is_active
    JOIN users account
      ON account.id=membership.user_id
      AND account.is_active
    WHERE report.id=notification_report
      AND report.status IN ('open','under_review')
      AND (
        membership.role='admin'
        OR (
          membership.role='staff'
          AND report.assigned_to=membership.user_id
          AND EXISTS (
            SELECT 1
            FROM staff_role_bindings binding
            WHERE binding.school_id=conversation.school_id
              AND binding.user_id=membership.user_id
              AND binding.role_active
              AND binding.status='active'
              AND 'safeguarding.review'=ANY(binding.permissions)
              AND binding.starts_on<=current_date
              AND (binding.ends_on IS NULL OR binding.ends_on>=current_date)
          )
        )
      )
  )
$$;

CREATE FUNCTION notification_is_currently_visible(
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
    WHERE notification.id=notification_id
      AND notification.recipient_id=actor
      AND CASE
        WHEN notification.attention_eligible THEN
          notification_attention_is_currently_authorized(notification.id,actor)

        -- Event-backed bell rows inherit the same current authorization used
        -- for durable replay. The event UUID is server-authored in dedupe_key.
        WHEN notification.dedupe_key ~* '^event:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN EXISTS (
          SELECT 1
          FROM event_outbox event
          WHERE event.id::text=substring(notification.dedupe_key FROM 7)
            AND event_user_is_authorized(
              event.school_id,
              event.event_type,
              event.payload,
              actor
            )
        )

        WHEN notification.metadata ? 'notice_recipient_id' THEN EXISTS (
          SELECT 1
          FROM school_notice_recipients recipient
          JOIN school_memberships membership
            ON membership.school_id=recipient.school_id
            AND membership.user_id=actor
            AND membership.is_active
            AND membership.role::text=recipient.recipient_role
          WHERE recipient.id::text=notification.metadata->>'notice_recipient_id'
            AND recipient.user_id=actor
            AND (
              recipient.recipient_role<>'guardian'
              OR EXISTS (
                SELECT 1
                FROM parents guardian
                JOIN guardian_relationships relationship
                  ON relationship.guardian_id=guardian.id
                  AND relationship.school_id=recipient.school_id
                  AND relationship.student_id=recipient.student_id
                WHERE guardian.user_id=actor
                  AND guardian.id=recipient.guardian_id
              )
            )
        )

        -- Review alerts stay only with a current administrator or the
        -- currently assigned safeguarding reviewer. This branch precedes the
        -- conversation branch because reviewers need not be participants.
        WHEN notification.metadata->>'notification_scope'='chat_report_review'
          OR (
            notification.metadata ? 'report_id'
            AND notification.link ~ '^/(teacher|principal)/safeguarding([?/#]|$)'
          ) THEN CASE
            WHEN notification.metadata->>'report_id'
              ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN notification_chat_report_is_current_reviewer(
              (notification.metadata->>'report_id')::uuid,
              actor
            )
            ELSE false
          END

        WHEN notification.metadata ? 'conversation_id' THEN EXISTS (
          SELECT 1
          FROM chat_conversations conversation
          WHERE conversation.id::text=notification.metadata->>'conversation_id'
            AND chat_actor_is_current_participant(
              conversation.school_id,
              actor,
              'messages.view',
              conversation.id
            )
        )

        WHEN notification.metadata ? 'publication_id' THEN EXISTS (
          SELECT 1
          FROM assessment_publications publication
          JOIN assessment_publication_results result
            ON result.publication_id=publication.id
          WHERE publication.id::text=notification.metadata->>'publication_id'
            AND result.student_id::text=notification.metadata->>'student_id'
            AND notification_actor_has_current_student_scope(result.student_id,actor)
        )

        WHEN notification.metadata ? 'report_batch_id' THEN EXISTS (
          SELECT 1
          FROM grading_report_batches batch
          JOIN grading_report_students report ON report.batch_id=batch.id
          WHERE batch.id::text=notification.metadata->>'report_batch_id'
            AND batch.status='published'
            AND report.student_id::text=notification.metadata->>'student_id'
            AND notification_actor_has_current_student_scope(report.student_id,actor)
        )

        WHEN notification.metadata ? 'leave_request_id' THEN EXISTS (
          SELECT 1
          FROM leave_requests request
          WHERE request.id::text=notification.metadata->>'leave_request_id'
            AND request.student_id::text=notification.metadata->>'student_id'
            AND notification_actor_has_current_student_scope(request.student_id,actor)
        )

        WHEN notification.metadata ? 'student_id' THEN EXISTS (
          SELECT 1
          FROM students student
          WHERE student.id::text=notification.metadata->>'student_id'
            AND notification_actor_has_current_student_scope(student.id,actor)
        )

        -- Source-free alerts are personal/account notifications. Do not break
        -- them merely because they predate school-source metadata contracts.
        ELSE true
      END
  )
$$;

-- Repair already-created restriction notices so the bell can open a safe,
-- exact read-only conversation destination instead of remaining stuck unread.
UPDATE notifications notification
SET link='/'||CASE recipient.role
      WHEN 'parent' THEN 'parent'
      WHEN 'student' THEN 'student'
      WHEN 'staff' THEN 'teacher'
      ELSE 'principal'
    END||'/messages?conversation='||conversation.id::text
      ||CASE WHEN recipient.role='parent' AND conversation.context_student_id IS NOT NULL
        THEN '&student_id='||conversation.context_student_id::text ELSE '' END,
    metadata=notification.metadata||jsonb_build_object(
      'conversation_id',conversation.id,
      'notification_scope','chat_conversation'
    )
FROM chat_message_reports report
JOIN chat_messages message ON message.id=report.message_id
JOIN chat_conversations conversation ON conversation.id=message.conversation_id
JOIN users recipient ON recipient.id=message.sender_id
WHERE notification.recipient_id=recipient.id
  AND notification.title='Messaging temporarily restricted'
  AND notification.link=''
  AND notification.metadata->>'report_id'=report.id::text;

REVOKE ALL ON FUNCTION notification_actor_has_current_student_scope(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION notification_chat_report_is_current_reviewer(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION notification_is_currently_visible(uuid,uuid) FROM PUBLIC;

DO $$
DECLARE runtime_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO runtime_owner
  FROM pg_class WHERE oid='notifications'::regclass;
  EXECUTE format(
    'ALTER FUNCTION notification_actor_has_current_student_scope(uuid,uuid) OWNER TO %I',
    runtime_owner
  );
  EXECUTE format(
    'ALTER FUNCTION notification_chat_report_is_current_reviewer(uuid,uuid) OWNER TO %I',
    runtime_owner
  );
  EXECUTE format(
    'ALTER FUNCTION notification_is_currently_visible(uuid,uuid) OWNER TO %I',
    runtime_owner
  );
END $$;
