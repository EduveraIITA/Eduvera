-- Route legacy conversation alerts to the existing current chat authority
-- without planning the unrelated legacy source checks for each chat alert.
CREATE OR REPLACE FUNCTION notification_is_currently_visible(
  notification_id uuid,
  actor uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=public
AS $$
DECLARE
  notification_dedupe text;
  notification_attention boolean;
  notification_source_kind text;
  notification_event text;
  notification_metadata jsonb;
  notification_link text;
  notification_conversation text;
BEGIN
  SELECT notification.dedupe_key,notification.attention_eligible,
    notification.attention_source_kind,notification.metadata,notification.link
    INTO notification_dedupe,notification_attention,notification_source_kind,notification_metadata,notification_link
  FROM notifications notification
  JOIN users account
    ON account.id=notification.recipient_id
    AND account.is_active
  WHERE notification.id=notification_id
    AND notification.recipient_id=actor;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF notification_attention THEN
    IF notification_source_kind='departure_plan_exception' THEN
      RETURN notification_departure_plan_exception_is_currently_authorized(
        notification_id,
        actor
      );
    ELSIF notification_source_kind IN (
      'responsibility_offer','responsibility_response','responsibility_revocation',
      'coverage_offer','coverage_response','staff_leave_review',
      'transport_swap','transport_swap_approval','transport_swap_response',
      'transport_swap_decision'
    ) THEN
      RETURN notification_staff_workflow_is_currently_authorized(
        notification_id,
        actor
      );
    END IF;
    RETURN notification_attention_is_currently_authorized(
      notification_id,
      actor
    );
  END IF;

  IF notification_dedupe ~*
    '^event:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    notification_event := substring(notification_dedupe FROM 7);
    RETURN notification_event_is_currently_visible(notification_event::uuid,actor);
  END IF;

  -- This is the exact legacy conversation branch. Notice and safeguarding
  -- review sources keep their precedence. The UUID check retains the former
  -- canonical lowercase text match while letting the lookup use the PK.
  IF notification_metadata ? 'conversation_id'
    AND NOT (notification_metadata ? 'notice_recipient_id')
    AND (notification_metadata->>'notification_scope'='chat_report_review'
      OR (notification_metadata ? 'report_id' AND notification_link ~ '^/(teacher|principal)/safeguarding([?/#]|$)')) IS NOT TRUE
  THEN
    notification_conversation := notification_metadata->>'conversation_id';
    IF notification_conversation IS NULL OR notification_conversation !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN false;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM chat_conversations conversation
      WHERE conversation.id=notification_conversation::uuid
        AND chat_actor_is_current_participant(conversation.school_id,actor,'messages.view',conversation.id)
    );
  END IF;

  RETURN notification_is_currently_visible_before_event_optimization(
    notification_id,
    actor
  );
END
$$;
