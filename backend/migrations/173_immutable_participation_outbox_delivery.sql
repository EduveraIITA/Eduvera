-- Source identity is immutable evidence. Delivery metadata is retryable state.
-- Retained pre-170 malformed envelopes must not poison an entire claim UPDATE,
-- nor become deliverable simply because their cached audience once had access.
CREATE FUNCTION event_source_is_valid(institution uuid,event_name text,aggregate_kind text,aggregate uuid,event_payload jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE WHEN event_name='attendance.participation.updated' THEN
    aggregate_kind='attendance_register'
    AND aggregate::text=event_payload->>'register_id'
    AND EXISTS(SELECT 1 FROM activity_attendance_registers register
      WHERE register.school_id=institution AND register.id=aggregate
        AND register.occurrence_id::text=event_payload->>'occurrence_id')
  ELSE true END
$$;
COMMENT ON FUNCTION event_source_is_valid(uuid,text,text,uuid,jsonb) IS
  'Delivery source-integrity predicate only; current recipient authorization is checked separately and is never granted by this function.';

CREATE OR REPLACE FUNCTION validate_participation_event_source() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD.event_type='attendance.participation.updated' OR NEW.event_type='attendance.participation.updated' THEN
      IF ROW(NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload,
          NEW.audience_user_ids,NEW.notification_user_ids,NEW.notification_payload,NEW.idempotency_key,NEW.created_at)
        IS DISTINCT FROM
        ROW(OLD.school_id,OLD.event_type,OLD.aggregate_type,OLD.aggregate_id,OLD.payload,
          OLD.audience_user_ids,OLD.notification_user_ids,OLD.notification_payload,OLD.idempotency_key,OLD.created_at) THEN
        RAISE EXCEPTION 'Participation event envelopes are immutable; publish a new authoritative event' USING ERRCODE='23514';
      END IF;
      -- Claim, retry and quarantine do not manufacture a new source. The
      -- publisher/read delivery boundaries still fail closed for old bad data.
      RETURN NEW;
    END IF;
  END IF;
  IF NOT COALESCE(event_source_is_valid(NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload),false) THEN
    RAISE EXCEPTION 'Participation event does not match its authoritative register' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

-- Retain exactly what was published/queued; do not fabricate a corrected source,
-- recipient list or accepted attendance decision during an upgrade.
UPDATE event_outbox SET dead_lettered_at=COALESCE(dead_lettered_at,clock_timestamp()),claim_expires_at=NULL,
  last_error='Retained participation envelope has no matching authoritative register; delivery quarantined.'
WHERE event_type='attendance.participation.updated'
  AND NOT COALESCE(event_source_is_valid(school_id,event_type,aggregate_type,aggregate_id,payload),false);

REVOKE ALL ON FUNCTION event_source_is_valid(uuid,text,text,uuid,jsonb),validate_participation_event_source() FROM PUBLIC;
DO $$ DECLARE owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='event_outbox'::regclass;
  EXECUTE format('ALTER FUNCTION event_source_is_valid(uuid,text,text,uuid,jsonb) OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION validate_participation_event_source() OWNER TO %I',owner_name);
END $$;
