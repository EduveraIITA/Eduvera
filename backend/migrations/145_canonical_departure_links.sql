-- Converge retained transport and departure navigation onto responsibility-
-- composed workspaces. Domain authorization still rechecks every record.

UPDATE notifications notification
SET link=CASE
      WHEN notification.link ~ '^/parent/departure\?'
        THEN regexp_replace(notification.link,'^/parent/departure\?','/areas/departure/plan?scope=dependent&')
      WHEN notification.link ~ '^/parent/departure([/#]|$)'
        THEN regexp_replace(notification.link,'^/parent/departure','/areas/departure/plan?scope=dependent')
      WHEN notification.link ~ '^/teacher/transport([?/#]|$)'
        THEN regexp_replace(notification.link,'^/teacher/transport','/areas/departure/operate')
      WHEN notification.link ~ '^/principal/departure/journeys([?/#]|$)'
        THEN regexp_replace(notification.link,'^/principal/departure/journeys','/areas/departure/manage/journeys')
      WHEN notification.link ~ '^/principal/departure([?/#]|$)'
        THEN regexp_replace(notification.link,'^/principal/departure','/areas/departure/manage')
      ELSE notification.link
    END
WHERE notification.link ~ '^/(parent/departure|teacher/transport|principal/departure)([?/#]|$)';

UPDATE event_outbox event
SET notification_payload=jsonb_set(
      event.notification_payload,
      '{link}',
      to_jsonb(CASE
        WHEN event.notification_payload->>'link' ~ '^/parent/departure\?'
          THEN regexp_replace(event.notification_payload->>'link','^/parent/departure\?','/areas/departure/plan?scope=dependent&')
        WHEN event.notification_payload->>'link' ~ '^/parent/departure([/#]|$)'
          THEN regexp_replace(event.notification_payload->>'link','^/parent/departure','/areas/departure/plan?scope=dependent')
        WHEN event.notification_payload->>'link' ~ '^/teacher/transport([?/#]|$)'
          THEN regexp_replace(event.notification_payload->>'link','^/teacher/transport','/areas/departure/operate')
        WHEN event.notification_payload->>'link' ~ '^/principal/departure/journeys([?/#]|$)'
          THEN regexp_replace(event.notification_payload->>'link','^/principal/departure/journeys','/areas/departure/manage/journeys')
        ELSE regexp_replace(event.notification_payload->>'link','^/principal/departure','/areas/departure/manage')
      END::text),
      true
    )
WHERE event.published_at IS NULL
  AND event.notification_payload->>'link' ~ '^/(parent/departure|teacher/transport|principal/departure)([?/#]|$)';

UPDATE campus_model_operational_messages message
SET payload=jsonb_set(
      message.payload,
      '{action_path}',
      to_jsonb(CASE
        WHEN message.payload->>'action_path' ~ '^/teacher/transport([?/#]|$)'
          THEN regexp_replace(message.payload->>'action_path','^/teacher/transport','/areas/departure/operate')
        WHEN message.payload->>'action_path' ~ '^/principal/departure/journeys([?/#]|$)'
          THEN regexp_replace(message.payload->>'action_path','^/principal/departure/journeys','/areas/departure/manage/journeys')
        ELSE regexp_replace(message.payload->>'action_path','^/principal/departure','/areas/departure/manage')
      END::text),
      true
    )
WHERE message.payload->>'action_path' ~ '^/(teacher/transport|principal/departure)([?/#]|$)';
