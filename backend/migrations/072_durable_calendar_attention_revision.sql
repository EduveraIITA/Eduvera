-- Calendar attention must outlive the realtime outbox. Outbox rows are
-- intentionally deleted after their replay window, so they cannot be used as
-- a source of truth for current notification revisions.
CREATE TABLE calendar_attention_topics (
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  date date NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  source_id uuid NOT NULL,
  change_kind varchar(16) NOT NULL CHECK (change_kind IN ('created','removed')),
  record_revision integer NOT NULL CHECK (record_revision > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (school_id,date)
);

-- Preserve any typed calendar notifications created before this durable
-- ledger existed. Notification rows are retained independently of event
-- replay and already carry the producer-owned date and revision contract.
INSERT INTO calendar_attention_topics (
  school_id,date,revision,source_id,change_kind,record_revision,updated_at
)
SELECT DISTINCT ON (notification.attention_school_id,calendar_date.date)
  notification.attention_school_id,
  calendar_date.date,
  notification.attention_source_revision,
  notification.attention_source_id,
  CASE WHEN notification.metadata->>'calendar_change_kind'='removed'
      OR notification.link LIKE '%calendar_change_kind=removed%'
    THEN 'removed' ELSE 'created' END,
  GREATEST(
    1,
    CASE WHEN COALESCE(notification.metadata->>'calendar_record_revision','') ~ '^[1-9][0-9]*$'
      THEN (notification.metadata->>'calendar_record_revision')::integer ELSE 1 END
  ),
  notification.created_at
FROM notifications notification
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN COALESCE(
      notification.metadata->>'date',notification.metadata->>'starts_on'
    ) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    THEN COALESCE(
      notification.metadata->>'date',notification.metadata->>'starts_on'
    )::date
    ELSE NULL
  END AS date
) calendar_date
WHERE notification.attention_eligible
  AND notification.attention_source_kind='calendar_change'
  AND COALESCE(notification.metadata->>'date',notification.metadata->>'starts_on')
    ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
ORDER BY notification.attention_school_id,calendar_date.date,
  notification.attention_source_revision DESC,
  notification.created_at DESC,notification.id DESC
ON CONFLICT (school_id,date) DO NOTHING;

-- Migration 071 wrapped the common authorization function. Keep that prior
-- predicate for every other typed source, while calendar authorization now
-- reads only the durable topic row and current membership.
ALTER FUNCTION notification_attention_is_currently_authorized(uuid,uuid)
  RENAME TO notification_attention_is_currently_authorized_before_durable_calendar;

CREATE FUNCTION notification_attention_is_currently_authorized(
  notification_id uuid,
  actor uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public
AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN notification.attention_source_kind='calendar_change' THEN EXISTS (
        SELECT 1
        FROM users account
        JOIN school_memberships membership
          ON membership.school_id=notification.attention_school_id
          AND membership.user_id=notification.recipient_id
          AND membership.is_active
          AND membership.role::text=CASE notification.attention_portal
            WHEN 'parent' THEN 'guardian'
            WHEN 'teacher' THEN 'staff'
            WHEN 'principal' THEN 'admin'
            ELSE ''
          END
        JOIN calendar_attention_topics topic
          ON topic.school_id=notification.attention_school_id
          AND topic.date=CASE
            WHEN COALESCE(
              notification.metadata->>'date',notification.metadata->>'starts_on'
            ) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            THEN COALESCE(
              notification.metadata->>'date',notification.metadata->>'starts_on'
            )::date
            ELSE NULL
          END
          AND topic.source_id=notification.attention_source_id
          AND topic.revision=notification.attention_source_revision
          AND topic.change_kind=COALESCE(
            NULLIF(notification.metadata->>'calendar_change_kind',''),
            CASE WHEN notification.link LIKE '%calendar_change_kind=removed%'
              THEN 'removed' ELSE 'created' END
          )
        WHERE account.id=notification.recipient_id
          AND account.is_active
          AND notification.recipient_id=actor
          AND notification.attention_eligible
      )
      ELSE notification_attention_is_currently_authorized_before_durable_calendar(
        notification.id,
        actor
      )
    END
    FROM notifications notification
    WHERE notification.id=notification_id
  ),false)
$$;

REVOKE ALL ON FUNCTION notification_attention_is_currently_authorized(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION notification_attention_is_currently_authorized_before_durable_calendar(uuid,uuid) FROM PUBLIC;

DO $$
DECLARE runtime_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO runtime_owner
  FROM pg_class WHERE oid='notifications'::regclass;
  EXECUTE format(
    'ALTER TABLE calendar_attention_topics OWNER TO %I',
    runtime_owner
  );
  EXECUTE format(
    'ALTER FUNCTION notification_attention_is_currently_authorized(uuid,uuid) OWNER TO %I',
    runtime_owner
  );
  EXECUTE format(
    'ALTER FUNCTION notification_attention_is_currently_authorized_before_durable_calendar(uuid,uuid) OWNER TO %I',
    runtime_owner
  );
END $$;

COMMENT ON TABLE calendar_attention_topics IS
  'Durable monotonic per-school/date revision for calendar notification attention; independent of realtime event retention.';
