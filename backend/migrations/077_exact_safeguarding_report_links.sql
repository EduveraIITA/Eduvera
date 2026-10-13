-- Align retained moderation alerts with the single route contract consumed by
-- RestrictedCarePage and ModerationDialog. The report id comes from the
-- authoritative report row; notification copy is not trusted as an access
-- grant and current visibility continues to recheck reviewer assignment.
UPDATE notifications notification
SET link='/'||CASE recipient.role
      WHEN 'staff' THEN 'teacher'
      WHEN 'admin' THEN 'principal'
    END||'/safeguarding?section=message_reports&report='||report.id::text,
    metadata=COALESCE(notification.metadata,'{}'::jsonb)||jsonb_build_object(
      'report_id',report.id,
      'conversation_id',conversation.id,
      'notification_scope','chat_report_review'
    )
FROM users recipient, chat_message_reports report
JOIN chat_messages message ON message.id=report.message_id
JOIN chat_conversations conversation ON conversation.id=message.conversation_id
WHERE notification.recipient_id=recipient.id
  AND report.id::text=notification.metadata->>'report_id'
  AND recipient.role IN ('staff','admin')
  AND (
    notification.metadata->>'notification_scope'='chat_report_review'
    OR notification.link ~ '^/(teacher|principal)/safeguarding([?/#]|$)'
  );
