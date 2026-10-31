-- Lossless academic cutover support. Context activation is transactional and
-- cannot claim that importing an old accepted decision is a new observation.
ALTER TABLE schedule_activity_occurrences ALTER COLUMN period_id DROP NOT NULL;
ALTER TABLE activity_attendance_legacy_links
  ADD COLUMN state varchar(16) NOT NULL DEFAULT 'imported' CHECK(state IN ('imported','active')),
  ADD COLUMN activated_at timestamptz,
  ADD COLUMN context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN source_fingerprint char(64),
  ADD CONSTRAINT participation_legacy_activation CHECK((state='active')=(activated_at IS NOT NULL));

CREATE TABLE activity_attendance_legacy_people (
  school_id uuid NOT NULL REFERENCES schools(id),
  register_id uuid NOT NULL,
  person_id uuid NOT NULL,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  enrollment_id uuid REFERENCES enrollments(id) ON DELETE RESTRICT,
  source_revision integer NOT NULL CHECK(source_revision>0),
  PRIMARY KEY(register_id,person_id),
  UNIQUE(register_id,student_id),
  FOREIGN KEY(register_id,school_id) REFERENCES activity_attendance_registers(id,school_id),
  FOREIGN KEY(register_id,person_id) REFERENCES activity_attendance_roster(register_id,person_id)
);
CREATE TABLE activity_attendance_import_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  register_id uuid NOT NULL,
  source_kind varchar(24) NOT NULL CHECK(source_kind IN ('daily_class','scheduled_session','event','examination')),
  source_id text NOT NULL,
  source_revision integer NOT NULL CHECK(source_revision>=0),
  source_fingerprint char(64) NOT NULL,
  source_refs jsonb NOT NULL,
  counts jsonb NOT NULL,
  requested_by uuid NOT NULL REFERENCES users(id),
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,source_kind,source_id,source_fingerprint),
  FOREIGN KEY(register_id,school_id) REFERENCES activity_attendance_registers(id,school_id)
);
ALTER TABLE activity_attendance_entries ADD COLUMN legacy_source_ref text;
ALTER TABLE activity_attendance_entry_revisions ADD COLUMN legacy_source_ref text;
CREATE UNIQUE INDEX participation_entry_legacy_source ON activity_attendance_entries(school_id,legacy_source_ref) WHERE legacy_source_ref IS NOT NULL;
CREATE UNIQUE INDEX participation_revision_legacy_source ON activity_attendance_entry_revisions(school_id,legacy_source_ref) WHERE legacy_source_ref IS NOT NULL;

-- Half day is an existing daily-academic decision. Its applicability is checked
-- by the academic context adapter; it does not become a universal duty default.
ALTER TABLE activity_attendance_entries DROP CONSTRAINT activity_attendance_entries_status_check;
ALTER TABLE activity_attendance_entries ADD CONSTRAINT activity_attendance_entries_status_check
  CHECK(status IN ('present','absent','late','excused','half_day'));
ALTER TABLE activity_attendance_entry_revisions DROP CONSTRAINT activity_attendance_entry_revisions_previous_status_check;
ALTER TABLE activity_attendance_entry_revisions DROP CONSTRAINT activity_attendance_entry_revisions_new_status_check;
ALTER TABLE activity_attendance_entry_revisions ADD CONSTRAINT activity_attendance_entry_revisions_previous_status_check
  CHECK(previous_status IN ('present','absent','late','excused','half_day'));
ALTER TABLE activity_attendance_entry_revisions ADD CONSTRAINT activity_attendance_entry_revisions_new_status_check
  CHECK(new_status IN ('present','absent','late','excused','half_day'));
ALTER TABLE activity_attendance_evidence DROP CONSTRAINT activity_attendance_evidence_claimed_status_check;
ALTER TABLE activity_attendance_evidence ADD CONSTRAINT activity_attendance_evidence_claimed_status_check
  CHECK(claimed_status IN ('present','absent','late','excused','half_day'));

CREATE TRIGGER activity_attendance_imports_append_only BEFORE UPDATE OR DELETE ON activity_attendance_import_receipts
  FOR EACH ROW EXECUTE FUNCTION prevent_attendance_observation_mutation();
CREATE TRIGGER activity_attendance_legacy_person_scope BEFORE INSERT OR UPDATE ON activity_attendance_legacy_people
  FOR EACH ROW EXECUTE FUNCTION validate_activity_attendance_person_scope();
ALTER TABLE activity_attendance_legacy_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_attendance_import_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON activity_attendance_legacy_people,activity_attendance_import_receipts FROM PUBLIC;
DO $$ DECLARE database_role text;
BEGIN
  FOREACH database_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=database_role) THEN
      EXECUTE format('REVOKE ALL ON activity_attendance_legacy_people,activity_attendance_import_receipts FROM %I',database_role);
    END IF;
  END LOOP;
END $$;
