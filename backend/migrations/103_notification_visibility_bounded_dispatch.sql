-- Legacy bell rows previously planned every branch of a large SQL CASE,
-- including the entire event-authorization chain, even for personal alerts.
-- Dispatch before planning the selected source query. Preserve recipient,
-- current-account and source authorization; never use a frozen audience grant.
CREATE OR REPLACE FUNCTION notification_is_currently_visible_before_event_optimization(
  notification_id uuid, actor uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public
AS $$
DECLARE
  item notifications%ROWTYPE;
BEGIN
  SELECT notification.* INTO item
  FROM notifications notification
  JOIN users account ON account.id=notification.recipient_id AND account.is_active
  WHERE notification.id=notification_id AND notification.recipient_id=actor;
  IF NOT FOUND THEN RETURN false; END IF;

  IF item.attention_eligible THEN
    RETURN COALESCE(notification_attention_is_currently_authorized(item.id,actor),false);
  END IF;
  IF item.dedupe_key ~* '^event:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN EXISTS (
      SELECT 1 FROM event_outbox event
      WHERE event.id=substring(item.dedupe_key FROM 7)::uuid
        AND event_user_is_authorized(event.school_id,event.event_type,event.payload,actor)
    );
  END IF;
  IF item.metadata ? 'notice_recipient_id' THEN
    RETURN EXISTS (
      SELECT 1 FROM school_notice_recipients recipient
      JOIN school_memberships membership ON membership.school_id=recipient.school_id
        AND membership.user_id=actor AND membership.is_active
        AND membership.role::text=recipient.recipient_role
      WHERE recipient.id::text=item.metadata->>'notice_recipient_id'
        AND recipient.user_id=actor
        AND (recipient.recipient_role<>'guardian' OR EXISTS (
          SELECT 1 FROM parents guardian
          JOIN guardian_relationships relationship ON relationship.guardian_id=guardian.id
            AND relationship.school_id=recipient.school_id
            AND relationship.student_id=recipient.student_id
          WHERE guardian.user_id=actor AND guardian.id=recipient.guardian_id
        ))
    );
  END IF;
  -- Review scope takes precedence over conversation participation.
  IF item.metadata->>'notification_scope'='chat_report_review'
    OR (item.metadata ? 'report_id' AND item.link ~ '^/(teacher|principal)/safeguarding([?/#]|$)') THEN
    IF item.metadata->>'report_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RETURN COALESCE(notification_chat_report_is_current_reviewer((item.metadata->>'report_id')::uuid,actor),false);
    END IF;
    RETURN false;
  END IF;
  IF item.metadata ? 'conversation_id' THEN
    RETURN EXISTS (
      SELECT 1 FROM chat_conversations conversation
      WHERE conversation.id::text=item.metadata->>'conversation_id'
        AND chat_actor_is_current_participant(conversation.school_id,actor,'messages.view',conversation.id)
    );
  END IF;
  IF item.metadata ? 'publication_id' THEN
    RETURN EXISTS (
      SELECT 1 FROM assessment_publications publication
      JOIN assessment_publication_results result ON result.publication_id=publication.id
      WHERE publication.id::text=item.metadata->>'publication_id'
        AND result.student_id::text=item.metadata->>'student_id'
        AND notification_actor_has_current_student_scope(result.student_id,actor)
    );
  END IF;
  IF item.metadata ? 'report_batch_id' THEN
    RETURN EXISTS (
      SELECT 1 FROM grading_report_batches batch
      JOIN grading_report_students report ON report.batch_id=batch.id
      WHERE batch.id::text=item.metadata->>'report_batch_id' AND batch.status='published'
        AND report.student_id::text=item.metadata->>'student_id'
        AND notification_actor_has_current_student_scope(report.student_id,actor)
    );
  END IF;
  IF item.metadata ? 'leave_request_id' THEN
    RETURN EXISTS (
      SELECT 1 FROM leave_requests request
      WHERE request.id::text=item.metadata->>'leave_request_id'
        AND request.student_id::text=item.metadata->>'student_id'
        AND notification_actor_has_current_student_scope(request.student_id,actor)
    );
  END IF;
  IF item.metadata ? 'student_id' THEN
    RETURN EXISTS (
      SELECT 1 FROM students student WHERE student.id::text=item.metadata->>'student_id'
        AND notification_actor_has_current_student_scope(student.id,actor)
    );
  END IF;
  RETURN true;
END
$$;

-- CREATE OR REPLACE retains the existing owner/ACL and stable function identity.
REVOKE ALL ON FUNCTION notification_is_currently_visible_before_event_optimization(uuid,uuid) FROM PUBLIC;
