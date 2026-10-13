-- Typed attention rows also originate in the event outbox and therefore carry
-- an event dedupe key. Their exact durable source contract is stricter than the
-- generic event policy and must retain precedence in the optimized dispatcher.

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
  notification_event text;
BEGIN
  SELECT notification.dedupe_key,notification.attention_eligible
    INTO notification_dedupe,notification_attention
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
    RETURN notification_is_currently_visible_before_event_optimization(
      notification_id,
      actor
    );
  END IF;

  IF notification_dedupe ~*
    '^event:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    notification_event := substring(notification_dedupe FROM 7);
    RETURN notification_event_is_currently_visible(notification_event::uuid,actor);
  END IF;

  RETURN notification_is_currently_visible_before_event_optimization(
    notification_id,
    actor
  );
END
$$;

REVOKE ALL ON FUNCTION notification_is_currently_visible(uuid,uuid) FROM PUBLIC;

DO $$
DECLARE runtime_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO runtime_owner
  FROM pg_class WHERE oid='notifications'::regclass;
  EXECUTE format(
    'ALTER FUNCTION notification_is_currently_visible(uuid,uuid) OWNER TO %I',
    runtime_owner
  );
END $$;
