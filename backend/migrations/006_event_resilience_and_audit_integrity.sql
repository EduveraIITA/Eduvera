-- Failure isolation for the event worker and database-enforced immutable
-- attendance correction links.

ALTER TABLE event_outbox
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_sequence bigint;

-- Insert-time identity values are not safe SSE cursors: concurrent business
-- transactions can commit out of order. The publisher reserves a committed,
-- monotonically increasing range from this singleton row instead.
CREATE TABLE IF NOT EXISTS event_delivery_cursor (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  replay_floor bigint NOT NULL DEFAULT 0 CHECK (replay_floor >= 0)
);
ALTER TABLE event_delivery_cursor
  ADD COLUMN IF NOT EXISTS replay_floor bigint NOT NULL DEFAULT 0;

-- Maintenance leases must not share the publication cursor's single hot row.
-- Otherwise every overdue scan briefly blocks every event publisher.
CREATE TABLE IF NOT EXISTS event_maintenance_leases (
  task_name text PRIMARY KEY,
  last_claimed_at timestamptz
);
INSERT INTO event_maintenance_leases (task_name, last_claimed_at)
VALUES
  ('attendance_register_overdue_scan', NULL),
  ('event_retention_cleanup', NULL)
ON CONFLICT (task_name) DO NOTHING;

WITH baseline AS (
  SELECT COALESCE(max(delivery_sequence), 0) AS value FROM event_outbox
), numbered AS (
  SELECT event.id,
    baseline.value + row_number() OVER (
      ORDER BY event.published_at, event.sequence, event.id
    ) AS delivery_sequence
  FROM event_outbox event CROSS JOIN baseline
  WHERE event.published_at IS NOT NULL AND event.delivery_sequence IS NULL
)
UPDATE event_outbox event
SET delivery_sequence=numbered.delivery_sequence
FROM numbered
WHERE event.id=numbered.id;

INSERT INTO event_delivery_cursor(singleton, last_sequence)
SELECT true, COALESCE(max(delivery_sequence), 0) FROM event_outbox
ON CONFLICT (singleton) DO UPDATE
SET last_sequence=GREATEST(event_delivery_cursor.last_sequence, EXCLUDED.last_sequence);

-- Keep a rolling deployment compatible with the publisher from the previous
-- release. That publisher only sets published_at and still uses the legacy
-- insert-time sequence. Once this migration commits, the trigger below assigns
-- the new commit-ordered cursor even while an old API instance is draining.
CREATE OR REPLACE FUNCTION assign_event_delivery_sequence()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  reserved_sequence bigint;
BEGIN
  IF NEW.published_at IS NOT NULL AND NEW.delivery_sequence IS NULL THEN
    UPDATE event_delivery_cursor cursor
    SET last_sequence=cursor.last_sequence + 1
    WHERE cursor.singleton
    RETURNING cursor.last_sequence INTO reserved_sequence;

    IF reserved_sequence IS NULL THEN
      RAISE EXCEPTION 'Event delivery cursor is not initialized'
        USING ERRCODE='55000';
    END IF;
    NEW.delivery_sequence=reserved_sequence;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS assign_event_delivery_sequence_on_insert ON event_outbox;
CREATE TRIGGER assign_event_delivery_sequence_on_insert
  BEFORE INSERT ON event_outbox
  FOR EACH ROW EXECUTE FUNCTION assign_event_delivery_sequence();

DROP TRIGGER IF EXISTS assign_event_delivery_sequence_on_publish ON event_outbox;
CREATE TRIGGER assign_event_delivery_sequence_on_publish
  BEFORE UPDATE OF published_at ON event_outbox
  FOR EACH ROW EXECUTE FUNCTION assign_event_delivery_sequence();

CREATE UNIQUE INDEX IF NOT EXISTS event_outbox_delivery_sequence_idx
  ON event_outbox(delivery_sequence)
  WHERE delivery_sequence IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_outbox_delivery_replay_idx
  ON event_outbox(delivery_sequence, created_at)
  WHERE published_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_outbox_expiry_cleanup_idx
  ON event_outbox(expires_at, delivery_sequence)
  WHERE published_at IS NOT NULL;

-- Schools own their operational deadline. The worker evaluates this in each
-- school's timezone instead of relying on the database/server timezone.
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS attendance_submission_cutoff time NOT NULL DEFAULT '10:30';

CREATE INDEX IF NOT EXISTS event_outbox_deliverable_idx
  ON event_outbox(available_at, created_at, id)
  WHERE published_at IS NULL AND dead_lettered_at IS NULL;

CREATE INDEX IF NOT EXISTS event_outbox_dead_letter_idx
  ON event_outbox(dead_lettered_at DESC)
  WHERE dead_lettered_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_recipient_page_idx
  ON notifications(recipient_id, created_at DESC, id DESC);

-- The frozen audience is a routing optimization, never the final authorization
-- decision. Re-check the current membership/child/class relationship both when
-- creating a persistent notification and immediately before live delivery.
DROP FUNCTION IF EXISTS event_user_is_authorized(uuid, jsonb, uuid);
CREATE OR REPLACE FUNCTION event_user_is_authorized(
  event_school_id uuid,
  event_name text,
  event_payload jsonb,
  candidate_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM school_memberships membership
    JOIN users account ON account.id=membership.user_id AND account.is_active
    WHERE membership.user_id=candidate_user_id
      AND membership.school_id=event_school_id
      AND membership.is_active
      AND (
        membership.role='admin'
        OR (membership.role='staff' AND CASE
          -- Timetable removal/reassignment must invalidate stale staff caches,
          -- including for the teacher who just lost the slot.
          WHEN event_name='timetable.updated' THEN true
          WHEN event_payload ? 'class_section_id' THEN EXISTS (
            SELECT 1 FROM timetable_slots slot
            WHERE slot.class_section_id::text=event_payload->>'class_section_id'
              AND slot.teacher_user_id=membership.user_id
              AND (
                event_name NOT LIKE 'attendance.%'
                OR (event_payload ? 'term_id' AND slot.term_id::text=event_payload->>'term_id')
              )
          )
          WHEN event_payload ? 'student_id' THEN EXISTS (
            SELECT 1 FROM enrollments enrollment
            JOIN timetable_slots slot ON slot.class_section_id=enrollment.class_section_id
              AND slot.term_id=enrollment.term_id
              AND slot.teacher_user_id=membership.user_id
            WHERE enrollment.student_id::text=event_payload->>'student_id'
              AND enrollment.is_active
              AND (
                event_name NOT LIKE 'attendance.%'
                OR (event_payload ? 'term_id' AND enrollment.term_id::text=event_payload->>'term_id')
              )
          )
          ELSE true
        END)
        OR (membership.role='student' AND EXISTS (
          SELECT 1 FROM students student
          WHERE student.user_id=membership.user_id
            AND student.school_id=event_school_id
            AND CASE
              WHEN event_payload ? 'student_id'
                THEN student.id::text=event_payload->>'student_id'
              WHEN event_payload ? 'class_section_id'
                THEN EXISTS (
                  SELECT 1 FROM enrollments enrollment
                  WHERE enrollment.student_id=student.id
                    AND enrollment.class_section_id::text=event_payload->>'class_section_id'
                    AND enrollment.is_active
                    AND (
                      event_name NOT LIKE 'attendance.%'
                      OR (event_payload ? 'term_id' AND enrollment.term_id::text=event_payload->>'term_id')
                    )
                )
              ELSE true
            END
        ))
        OR (membership.role='guardian' AND CASE
          WHEN event_payload ? 'student_id' THEN EXISTS (
            SELECT 1 FROM parents parent
            JOIN guardian_relationships relationship ON relationship.guardian_id=parent.id
            JOIN students student ON student.id=relationship.student_id
            WHERE parent.user_id=membership.user_id
              AND student.school_id=event_school_id
              AND student.id::text=event_payload->>'student_id'
          )
          WHEN event_payload ? 'class_section_id' THEN EXISTS (
            SELECT 1 FROM parents parent
            JOIN guardian_relationships relationship ON relationship.guardian_id=parent.id
            JOIN students student ON student.id=relationship.student_id
            JOIN enrollments enrollment ON enrollment.student_id=student.id AND enrollment.is_active
            WHERE parent.user_id=membership.user_id
              AND student.school_id=event_school_id
              AND enrollment.class_section_id::text=event_payload->>'class_section_id'
              AND (
                event_name NOT LIKE 'attendance.%'
                OR (event_payload ? 'term_id' AND enrollment.term_id::text=event_payload->>'term_id')
              )
          )
          ELSE true
        END)
      )
  )
$$;

CREATE OR REPLACE FUNCTION validate_attendance_revision_links()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  record_row attendance_records%ROWTYPE;
  submission_row attendance_submissions%ROWTYPE;
  register_row attendance_registers%ROWTYPE;
BEGIN
  SELECT * INTO record_row FROM attendance_records WHERE id=NEW.attendance_record_id;
  IF NOT FOUND
    OR record_row.student_id IS DISTINCT FROM NEW.student_id
    OR record_row.class_section_id IS DISTINCT FROM NEW.class_section_id
    OR record_row.date IS DISTINCT FROM NEW.date THEN
    RAISE EXCEPTION 'Attendance revision does not match its attendance record'
      USING ERRCODE='23514';
  END IF;

  IF NEW.attendance_submission_id IS NOT NULL THEN
    SELECT * INTO submission_row FROM attendance_submissions WHERE id=NEW.attendance_submission_id;
    IF NOT FOUND
      OR submission_row.school_id IS DISTINCT FROM NEW.school_id
      OR submission_row.class_section_id IS DISTINCT FROM NEW.class_section_id
      OR submission_row.date IS DISTINCT FROM NEW.date
      OR submission_row.register_revision IS DISTINCT FROM NEW.register_revision THEN
      RAISE EXCEPTION 'Attendance revision does not match its submission'
        USING ERRCODE='23514';
    END IF;
  END IF;

  IF NEW.attendance_register_id IS NOT NULL THEN
    SELECT * INTO register_row FROM attendance_registers WHERE id=NEW.attendance_register_id;
    IF NOT FOUND
      OR register_row.school_id IS DISTINCT FROM NEW.school_id
      OR register_row.class_section_id IS DISTINCT FROM NEW.class_section_id
      OR register_row.date IS DISTINCT FROM NEW.date THEN
      RAISE EXCEPTION 'Attendance revision does not match its register'
        USING ERRCODE='23514';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION prevent_attendance_record_identity_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.student_id IS DISTINCT FROM NEW.student_id
    OR OLD.class_section_id IS DISTINCT FROM NEW.class_section_id
    OR OLD.date IS DISTINCT FROM NEW.date THEN
    RAISE EXCEPTION 'Attendance record identity is immutable; create an explicit transfer correction'
      USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS attendance_record_identity_immutable ON attendance_records;
CREATE TRIGGER attendance_record_identity_immutable
  BEFORE UPDATE OF student_id, class_section_id, date ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION prevent_attendance_record_identity_change();

DROP TRIGGER IF EXISTS validate_attendance_revision_links ON attendance_record_revisions;
CREATE CONSTRAINT TRIGGER validate_attendance_revision_links
  AFTER INSERT OR UPDATE ON attendance_record_revisions
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION validate_attendance_revision_links();

CREATE OR REPLACE FUNCTION prevent_attendance_revision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Attendance revision history is append-only' USING ERRCODE='55000';
END $$;

DROP TRIGGER IF EXISTS attendance_revision_append_only ON attendance_record_revisions;
CREATE TRIGGER attendance_revision_append_only
  BEFORE UPDATE OR DELETE ON attendance_record_revisions
  FOR EACH ROW EXECUTE FUNCTION prevent_attendance_revision_mutation();

REVOKE ALL ON FUNCTION validate_attendance_revision_links() FROM PUBLIC;
REVOKE ALL ON FUNCTION prevent_attendance_revision_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION prevent_attendance_record_identity_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION assign_event_delivery_sequence() FROM PUBLIC;
REVOKE ALL ON TABLE event_delivery_cursor FROM PUBLIC;
REVOKE ALL ON TABLE event_maintenance_leases FROM PUBLIC;
ALTER TABLE event_delivery_cursor ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_maintenance_leases ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE event_delivery_cursor FROM anon;
    REVOKE ALL ON TABLE event_maintenance_leases FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE event_delivery_cursor FROM authenticated;
    REVOKE ALL ON TABLE event_maintenance_leases FROM authenticated;
  END IF;
END $$;
