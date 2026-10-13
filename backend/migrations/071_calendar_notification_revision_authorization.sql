-- Calendar create/remove notifications can share one aggregate id. Wrap the
-- common typed-notification policy so only the latest date-level revision is
-- visible or acknowledgeable; otherwise the earlier alert would become a
-- permanently unread link to a state that no longer exists.
ALTER FUNCTION notification_attention_is_currently_authorized(uuid,uuid)
  RENAME TO notification_attention_is_currently_authorized_before_calendar_revision;

CREATE FUNCTION notification_attention_is_currently_authorized(
  notification_id uuid,
  actor uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public
AS $$
  SELECT notification_attention_is_currently_authorized_before_calendar_revision(
    notification_id,
    actor
  ) AND EXISTS (
    SELECT 1
    FROM notifications notification
    WHERE notification.id=notification_id
      AND (
        notification.attention_source_kind<>'calendar_change'
        OR notification.attention_source_revision=(
          SELECT count(*)::integer
          FROM event_outbox event
          WHERE event.school_id=notification.attention_school_id
            AND event.event_type='calendar.updated'
            AND COALESCE(event.payload->>'date',event.payload->>'starts_on')
              =COALESCE(notification.metadata->>'date',notification.metadata->>'starts_on')
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION notification_attention_is_currently_authorized(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION notification_attention_is_currently_authorized_before_calendar_revision(uuid,uuid) FROM PUBLIC;

DO $$
DECLARE runtime_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO runtime_owner
  FROM pg_class WHERE oid='notifications'::regclass;
  EXECUTE format(
    'ALTER FUNCTION notification_attention_is_currently_authorized(uuid,uuid) OWNER TO %I',
    runtime_owner
  );
  EXECUTE format(
    'ALTER FUNCTION notification_attention_is_currently_authorized_before_calendar_revision(uuid,uuid) OWNER TO %I',
    runtime_owner
  );
END $$;
