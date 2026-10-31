-- Converge retained school-calendar links onto the Timetable area's dated
-- calendar view. Role-labelled legacy paths are transport history only; the
-- destination resolves current responsibility/relationship evidence again.

UPDATE notifications notification
SET link=CASE
      WHEN notification.link ~ '^/parent/calendar\?'
        THEN regexp_replace(notification.link,'^/parent/calendar\?','/areas/timetable/calendar?scope=dependent&')
      WHEN notification.link ~ '^/parent/calendar([/#]|$)'
        THEN regexp_replace(notification.link,'^/parent/calendar','/areas/timetable/calendar?scope=dependent')
      WHEN notification.link ~ '^/student/calendar\?'
        THEN regexp_replace(notification.link,'^/student/calendar\?','/areas/timetable/calendar?scope=self&')
      WHEN notification.link ~ '^/student/calendar([/#]|$)'
        THEN regexp_replace(notification.link,'^/student/calendar','/areas/timetable/calendar?scope=self')
      WHEN notification.link ~ '^/teacher/calendar\?'
        THEN regexp_replace(notification.link,'^/teacher/calendar\?','/areas/timetable/calendar?surface=assigned&')
      WHEN notification.link ~ '^/teacher/calendar([/#]|$)'
        THEN regexp_replace(notification.link,'^/teacher/calendar','/areas/timetable/calendar?surface=assigned')
      WHEN notification.link ~ '^/principal/calendar\?'
        THEN regexp_replace(notification.link,'^/principal/calendar\?','/areas/timetable/calendar?surface=manage&')
      WHEN notification.link ~ '^/principal/calendar([/#]|$)'
        THEN regexp_replace(notification.link,'^/principal/calendar','/areas/timetable/calendar?surface=manage')
      ELSE notification.link
    END
WHERE notification.link ~ '^/(parent|student|teacher|principal)/calendar([?/#]|$)';

UPDATE event_outbox event
SET notification_payload=jsonb_set(
      event.notification_payload,
      '{parent_link}',
      to_jsonb(CASE
        WHEN event.notification_payload->>'parent_link' ~ '^/parent/calendar\?'
          THEN regexp_replace(event.notification_payload->>'parent_link','^/parent/calendar\?','/areas/timetable/calendar?scope=dependent&')
        ELSE regexp_replace(event.notification_payload->>'parent_link','^/parent/calendar','/areas/timetable/calendar?scope=dependent')
      END::text),
      true
    )
WHERE event.published_at IS NULL
  AND event.notification_payload->>'parent_link' ~ '^/parent/calendar([?/#]|$)';

UPDATE event_outbox event
SET notification_payload=jsonb_set(
      event.notification_payload,
      '{student_link}',
      to_jsonb(CASE
        WHEN event.notification_payload->>'student_link' ~ '^/student/calendar\?'
          THEN regexp_replace(event.notification_payload->>'student_link','^/student/calendar\?','/areas/timetable/calendar?scope=self&')
        ELSE regexp_replace(event.notification_payload->>'student_link','^/student/calendar','/areas/timetable/calendar?scope=self')
      END::text),
      true
    )
WHERE event.published_at IS NULL
  AND event.notification_payload->>'student_link' ~ '^/student/calendar([?/#]|$)';

UPDATE event_outbox event
SET notification_payload=jsonb_set(
      event.notification_payload,
      '{staff_link}',
      to_jsonb(CASE
        WHEN event.notification_payload->>'staff_link' ~ '^/teacher/calendar\?'
          THEN regexp_replace(event.notification_payload->>'staff_link','^/teacher/calendar\?','/areas/timetable/calendar?surface=assigned&')
        ELSE regexp_replace(event.notification_payload->>'staff_link','^/teacher/calendar','/areas/timetable/calendar?surface=assigned')
      END::text),
      true
    )
WHERE event.published_at IS NULL
  AND event.notification_payload->>'staff_link' ~ '^/teacher/calendar([?/#]|$)';

UPDATE event_outbox event
SET notification_payload=jsonb_set(
      event.notification_payload,
      '{admin_link}',
      to_jsonb(CASE
        WHEN event.notification_payload->>'admin_link' ~ '^/principal/calendar\?'
          THEN regexp_replace(event.notification_payload->>'admin_link','^/principal/calendar\?','/areas/timetable/calendar?surface=manage&')
        ELSE regexp_replace(event.notification_payload->>'admin_link','^/principal/calendar','/areas/timetable/calendar?surface=manage')
      END::text),
      true
    )
WHERE event.published_at IS NULL
  AND event.notification_payload->>'admin_link' ~ '^/principal/calendar([?/#]|$)';

UPDATE campus_model_operational_messages message
SET payload=jsonb_set(
      message.payload,
      '{action_path}',
      to_jsonb(CASE
        WHEN message.payload->>'action_path' ~ '^/teacher/calendar\?'
          THEN regexp_replace(message.payload->>'action_path','^/teacher/calendar\?','/areas/timetable/calendar?surface=assigned&')
        WHEN message.payload->>'action_path' ~ '^/principal/calendar\?'
          THEN regexp_replace(message.payload->>'action_path','^/principal/calendar\?','/areas/timetable/calendar?surface=manage&')
        WHEN message.payload->>'action_path' ~ '^/teacher/calendar([/#]|$)'
          THEN regexp_replace(message.payload->>'action_path','^/teacher/calendar','/areas/timetable/calendar?surface=assigned')
        ELSE regexp_replace(message.payload->>'action_path','^/principal/calendar','/areas/timetable/calendar?surface=manage')
      END::text),
      true
    )
WHERE message.payload->>'action_path' ~ '^/(teacher|principal)/calendar([?/#]|$)';
