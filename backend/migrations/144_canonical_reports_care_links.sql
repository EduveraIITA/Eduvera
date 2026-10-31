-- Converge retained Reports and protected-care destinations onto the
-- responsibility-composed application. This changes navigation only; current
-- domain authorization still rechecks every record when it is opened.

UPDATE notifications notification
SET link=CASE
      WHEN notification.link ~ '^/(teacher|principal)/report-cards([?/#]|$)'
        THEN regexp_replace(notification.link,'^/(teacher|principal)/report-cards','/areas/reports/remarks')
      WHEN notification.link ~ '^/(teacher|principal)/safeguarding([?/#]|$)'
        THEN regexp_replace(notification.link,'^/(teacher|principal)/safeguarding','/areas/care/concerns')
      ELSE notification.link
    END
WHERE notification.link ~ '^/(teacher|principal)/(report-cards|safeguarding)([?/#]|$)';

UPDATE event_outbox event
SET notification_payload=jsonb_set(
      event.notification_payload,
      '{staff_link}',
      to_jsonb(regexp_replace(event.notification_payload->>'staff_link','^/teacher/(report-cards|safeguarding)',
        CASE
          WHEN event.notification_payload->>'staff_link' LIKE '/teacher/report-cards%' THEN '/areas/reports/remarks'
          ELSE '/areas/care/concerns'
        END)::text),
      true
    )
WHERE event.published_at IS NULL
  AND event.notification_payload->>'staff_link' ~ '^/teacher/(report-cards|safeguarding)([?/#]|$)';

UPDATE event_outbox event
SET notification_payload=jsonb_set(
      event.notification_payload,
      '{admin_link}',
      to_jsonb(regexp_replace(event.notification_payload->>'admin_link','^/principal/(report-cards|safeguarding)',
        CASE
          WHEN event.notification_payload->>'admin_link' LIKE '/principal/report-cards%' THEN '/areas/reports/remarks'
          ELSE '/areas/care/concerns'
        END)::text),
      true
    )
WHERE event.published_at IS NULL
  AND event.notification_payload->>'admin_link' ~ '^/principal/(report-cards|safeguarding)([?/#]|$)';

UPDATE event_outbox event
SET notification_payload=jsonb_set(
      event.notification_payload,
      '{link}',
      to_jsonb(CASE
        WHEN event.notification_payload->>'link' ~ '^/(teacher|principal)/report-cards([?/#]|$)'
          THEN regexp_replace(event.notification_payload->>'link','^/(teacher|principal)/report-cards','/areas/reports/remarks')
        ELSE regexp_replace(event.notification_payload->>'link','^/(teacher|principal)/safeguarding','/areas/care/concerns')
      END::text),
      true
    )
WHERE event.published_at IS NULL
  AND event.notification_payload->>'link' ~ '^/(teacher|principal)/(report-cards|safeguarding)([?/#]|$)';
