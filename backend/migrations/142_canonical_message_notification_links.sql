-- Converge retained conversation notifications onto the responsibility-composed
-- Messages workspace. A student/guardian scope is included only when it is
-- proven by the authoritative people relationship; account role labels do not
-- select a portal or manufacture relationship context.
UPDATE notifications notification
SET link=CASE
      WHEN conversation.context_student_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM students student
        WHERE student.id=conversation.context_student_id
          AND student.school_id=conversation.school_id
          AND student.user_id=notification.recipient_id
      ) THEN '/areas/messages/conversations?scope=self'
        ||'&student_id='||conversation.context_student_id::text
        ||'&conversation='||conversation.id::text
      WHEN conversation.context_student_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM parents guardian
        JOIN guardian_relationships relationship ON relationship.guardian_id=guardian.id
        WHERE guardian.user_id=notification.recipient_id
          AND relationship.school_id=conversation.school_id
          AND relationship.student_id=conversation.context_student_id
      ) THEN '/areas/messages/conversations?scope=dependent'
        ||'&student_id='||conversation.context_student_id::text
        ||'&conversation='||conversation.id::text
      ELSE '/areas/messages/conversations?conversation='||conversation.id::text
    END,
    metadata=COALESCE(notification.metadata,'{}'::jsonb)||jsonb_build_object(
      'conversation_id',conversation.id,
      'student_id',conversation.context_student_id,
      'relationship_scope',CASE
        WHEN conversation.context_student_id IS NOT NULL AND EXISTS (
          SELECT 1
          FROM students student
          WHERE student.id=conversation.context_student_id
            AND student.school_id=conversation.school_id
            AND student.user_id=notification.recipient_id
        ) THEN 'self'
        WHEN conversation.context_student_id IS NOT NULL AND EXISTS (
          SELECT 1
          FROM parents guardian
          JOIN guardian_relationships relationship ON relationship.guardian_id=guardian.id
          WHERE guardian.user_id=notification.recipient_id
            AND relationship.school_id=conversation.school_id
            AND relationship.student_id=conversation.context_student_id
        ) THEN 'dependent'
        ELSE NULL
      END,
      'notification_scope','chat_conversation'
    )
FROM chat_conversations conversation
WHERE notification.metadata->>'notification_scope'='chat_conversation'
  AND conversation.id::text=notification.metadata->>'conversation_id';
