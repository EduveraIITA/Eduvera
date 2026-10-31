-- Converge retained Assessment/Results and Events hand-offs onto the
-- responsibility-composed application. Relationship scope is written only when
-- the recipient-to-learner relationship is still proven by authoritative data.

UPDATE notifications
SET link=CASE
      WHEN link ~ '^/principal/(assessments?|results?)(/|\?|$)'
        THEN regexp_replace(link,'^/principal/(assessments?|results?)','/areas/assessments/manage')
      WHEN link ~ '^/teacher/(assessments?|results?)(/|\?|$)'
        THEN regexp_replace(link,'^/teacher/(assessments?|results?)','/areas/assessments/assigned')
      ELSE link
    END
WHERE link ~ '^/(principal|teacher)/(assessments?|results?)(/|\?|$)';

UPDATE notifications notification
SET link=CASE
      WHEN EXISTS (
        SELECT 1 FROM students student
        WHERE student.id=(notification.metadata->>'student_id')::uuid
          AND student.user_id=notification.recipient_id
      ) THEN '/areas/assessments/results?scope=self&student_id='||(notification.metadata->>'student_id')
        ||CASE
          WHEN position('?' IN notification.link)>0
            AND trim(both '&' FROM regexp_replace(split_part(notification.link,'?',2),'(^|&)student_id=[^&]*','','g'))<>''
            THEN '&'||trim(both '&' FROM regexp_replace(split_part(notification.link,'?',2),'(^|&)student_id=[^&]*','','g'))
          WHEN notification.metadata ? 'assessment_id' THEN '&assessment_id='||(notification.metadata->>'assessment_id')
            ||CASE WHEN notification.metadata ? 'publication_id' THEN '&publication_id='||(notification.metadata->>'publication_id') ELSE '' END
          WHEN notification.metadata ? 'report_batch_id' THEN '&report_batch_id='||(notification.metadata->>'report_batch_id')
          ELSE ''
        END
      WHEN EXISTS (
        SELECT 1
        FROM parents guardian
        JOIN guardian_relationships relationship ON relationship.guardian_id=guardian.id
        WHERE guardian.user_id=notification.recipient_id
          AND relationship.school_id=notification.attention_school_id
          AND relationship.student_id=(notification.metadata->>'student_id')::uuid
      ) THEN '/areas/assessments/results?scope=dependent&student_id='||(notification.metadata->>'student_id')
        ||CASE
          WHEN position('?' IN notification.link)>0
            AND trim(both '&' FROM regexp_replace(split_part(notification.link,'?',2),'(^|&)student_id=[^&]*','','g'))<>''
            THEN '&'||trim(both '&' FROM regexp_replace(split_part(notification.link,'?',2),'(^|&)student_id=[^&]*','','g'))
          WHEN notification.metadata ? 'assessment_id' THEN '&assessment_id='||(notification.metadata->>'assessment_id')
            ||CASE WHEN notification.metadata ? 'publication_id' THEN '&publication_id='||(notification.metadata->>'publication_id') ELSE '' END
          WHEN notification.metadata ? 'report_batch_id' THEN '&report_batch_id='||(notification.metadata->>'report_batch_id')
          ELSE ''
        END
      ELSE '/areas/assessments'
    END
WHERE notification.metadata ? 'student_id'
  AND (notification.metadata ? 'assessment_id' OR notification.metadata ? 'report_batch_id')
  AND notification.link ~ '^/(parent|student)/results(?:\?|$)';

UPDATE notifications notification
SET link=CASE
      WHEN notification.link ~ '^/teacher/events(/|\?|$)'
        THEN regexp_replace(
          regexp_replace(notification.link,'^/teacher/events','/areas/events/assigned'),
          '/register([?]|$)',E'/attendance\\1'
        )
      WHEN notification.link ~ '^/principal/events(/|\?|$)'
        THEN regexp_replace(
          regexp_replace(notification.link,'^/principal/events','/areas/events/manage'),
          '/register([?]|$)',E'/attendance\\1'
        )
      WHEN notification.metadata ? 'student_id' AND EXISTS (
        SELECT 1 FROM students student
        WHERE student.id=(notification.metadata->>'student_id')::uuid
          AND student.user_id=notification.recipient_id
      ) THEN '/areas/events/calendar/'||(notification.metadata->>'event_id')
        ||'?scope=self&student_id='||(notification.metadata->>'student_id')
        ||CASE WHEN position('?' IN notification.link)>0
            AND trim(both '&' FROM regexp_replace(split_part(notification.link,'?',2),'(^|&)student_id=[^&]*','','g'))<>''
          THEN '&'||trim(both '&' FROM regexp_replace(split_part(notification.link,'?',2),'(^|&)student_id=[^&]*','','g')) ELSE '' END
      WHEN notification.metadata ? 'student_id' AND EXISTS (
        SELECT 1
        FROM parents guardian
        JOIN guardian_relationships relationship ON relationship.guardian_id=guardian.id
        WHERE guardian.user_id=notification.recipient_id
          AND relationship.school_id=COALESCE(notification.attention_school_id,relationship.school_id)
          AND relationship.student_id=(notification.metadata->>'student_id')::uuid
      ) THEN '/areas/events/calendar/'||(notification.metadata->>'event_id')
        ||'?scope=dependent&student_id='||(notification.metadata->>'student_id')
        ||CASE WHEN position('?' IN notification.link)>0
            AND trim(both '&' FROM regexp_replace(split_part(notification.link,'?',2),'(^|&)student_id=[^&]*','','g'))<>''
          THEN '&'||trim(both '&' FROM regexp_replace(split_part(notification.link,'?',2),'(^|&)student_id=[^&]*','','g')) ELSE '' END
      ELSE '/areas/events'
    END
WHERE notification.metadata ? 'event_id'
  AND notification.link ~ '^/(events|parent/events|student/events|teacher/events|principal/events)(/|\?|$)';

-- Only unpublished outbox rows can still create a notification. Published rows
-- remain immutable delivery evidence.
UPDATE event_outbox event
SET notification_payload=jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(event.notification_payload,'{link}',to_jsonb('/areas/events'::text),true),
            '{staff_link}',
            to_jsonb(regexp_replace(
              regexp_replace(COALESCE(event.notification_payload->>'staff_link','/areas/events/assigned'),'^/teacher/events','/areas/events/assigned'),
              '/register([?]|$)',E'/attendance\\1'
            )::text),
            true
          ),
          '{admin_link}',
          to_jsonb(regexp_replace(
            regexp_replace(COALESCE(event.notification_payload->>'admin_link','/areas/events/manage'),'^/principal/events','/areas/events/manage'),
            '/register([?]|$)',E'/attendance\\1'
          )::text),
          true
        ),
        '{student_link}',
        -- One retained outbox payload can fan out to several accounts and does not retain per-recipient learner authority.
        -- Family links remain neutral instead of inferring self/dependent scope from account role.
        to_jsonb('/areas/events'::text),
        true
      ),
      '{parent_link}',
      to_jsonb('/areas/events'::text),
      true
    )
WHERE event.published_at IS NULL
  AND event.notification_payload ? 'event_id';

UPDATE campus_model_operational_messages message
SET payload=jsonb_set(
      message.payload,
      '{action_path}',
      to_jsonb(CASE
        WHEN message.payload->>'action_path' ~ '^/teacher/assessments?(/|\?|$)'
          THEN regexp_replace(message.payload->>'action_path','^/teacher/assessments?','/areas/assessments/assigned')
        WHEN message.payload->>'action_path' ~ '^/principal/assessments?(/|\?|$)'
          THEN regexp_replace(message.payload->>'action_path','^/principal/assessments?','/areas/assessments/manage')
        WHEN message.payload->>'action_path' ~ '^/teacher/events?(/|\?|$)'
          THEN regexp_replace(message.payload->>'action_path','^/teacher/events?','/areas/events/assigned')
        WHEN message.payload->>'action_path' ~ '^/principal/events?(/|\?|$)'
          THEN regexp_replace(message.payload->>'action_path','^/principal/events?','/areas/events/manage')
        ELSE message.payload->>'action_path'
      END::text),
      false
    ),
    updated_at=now()
WHERE message.state IN ('queued','delivered','acknowledged')
  AND message.payload->>'action_path' ~ '^/(teacher|principal)/(assessments?|events?)(/|\?|$)';

UPDATE progressive_onboarding_goal_catalog
SET destination=CASE goal_key
      WHEN 'examinations' THEN '/areas/assessments/manage'
      WHEN 'performance' THEN '/areas/assessments/manage'
      ELSE destination
    END
WHERE goal_key IN ('examinations','performance');

UPDATE progressive_onboarding_workspaces
SET resume_path=CASE
      WHEN resume_path LIKE '/principal/assessments%' THEN regexp_replace(resume_path,'^/principal/assessments','/areas/assessments/manage')
      WHEN resume_path LIKE '/teacher/assessments%' THEN regexp_replace(resume_path,'^/teacher/assessments','/areas/assessments/assigned')
      WHEN resume_path LIKE '/principal/events%' THEN regexp_replace(resume_path,'^/principal/events','/areas/events/manage')
      WHEN resume_path LIKE '/teacher/events%' THEN regexp_replace(resume_path,'^/teacher/events','/areas/events/assigned')
      ELSE resume_path
    END,
    updated_at=now()
WHERE resume_path ~ '^/(principal|teacher)/(assessments|events)(/|\?|$)';
