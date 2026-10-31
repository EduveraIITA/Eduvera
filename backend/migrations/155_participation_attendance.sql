-- One participation register lifecycle for people in any scheduled context.
-- Context adapters retain enrollment, consent, employment and authority rules.
-- A roster reference never grants an account or permission.
CREATE TABLE activity_attendance_registers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  occurrence_id uuid NOT NULL,
  state varchar(16) NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','submitted','locked')),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  roster_fingerprint char(64) NOT NULL,
  roster_source_revision integer NOT NULL CHECK (roster_source_revision > 0),
  policy_revision integer NOT NULL CHECK (policy_revision > 0),
  policy_snapshot jsonb NOT NULL,
  submitted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  locked_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  locked_at timestamptz,
  reopened_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  reopened_at timestamptz,
  reopen_reason varchar(500),
  auto_finalize_at timestamptz,
  finalization_source varchar(16) CHECK (finalization_source IN ('manual','automatic')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,occurrence_id),
  UNIQUE(id,school_id),
  FOREIGN KEY(occurrence_id,school_id) REFERENCES schedule_activity_occurrences(id,school_id) ON DELETE RESTRICT,
  CHECK ((submitted_by IS NULL) = (submitted_at IS NULL)),
  CHECK ((locked_at IS NULL) = (finalization_source IS NULL)),
  CHECK (state <> 'locked' OR locked_at IS NOT NULL),
  CHECK (reopen_reason IS NULL OR length(btrim(reopen_reason)) >= 3)
);
CREATE INDEX activity_attendance_registers_finalize_idx
  ON activity_attendance_registers(auto_finalize_at,id)
  WHERE state='submitted' AND auto_finalize_at IS NOT NULL;

CREATE TABLE activity_attendance_roster (
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  register_id uuid NOT NULL,
  person_id uuid NOT NULL REFERENCES school_people(id) ON DELETE RESTRICT,
  label varchar(310) NOT NULL,
  participation_role varchar(24) NOT NULL,
  requirement varchar(16) NOT NULL CHECK(requirement IN ('required','optional')),
  source_kind varchar(24) NOT NULL,
  source_ref text NOT NULL,
  source_revision integer NOT NULL CHECK(source_revision>0),
  PRIMARY KEY(register_id,person_id),
  FOREIGN KEY(register_id,school_id) REFERENCES activity_attendance_registers(id,school_id) ON DELETE RESTRICT
);

CREATE TABLE activity_attendance_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  register_id uuid NOT NULL,
  person_id uuid NOT NULL REFERENCES school_people(id) ON DELETE RESTRICT,
  status varchar(16) CHECK (status IN ('present','absent','late','excused')),
  remarks varchar(500) NOT NULL DEFAULT '',
  capture_channel varchar(24) NOT NULL CHECK (capture_channel IN ('human_roll_call','offline_paper','self_check_in','camera_assisted','registered_device')),
  observed_at timestamptz NOT NULL,
  recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(register_id,school_id) REFERENCES activity_attendance_registers(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(register_id,person_id) REFERENCES activity_attendance_roster(register_id,person_id) ON DELETE RESTRICT,
  UNIQUE(register_id,person_id),
  UNIQUE(id,school_id)
);
CREATE INDEX activity_attendance_person_idx ON activity_attendance_entries(school_id,person_id,register_id);

CREATE TABLE activity_attendance_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  register_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation varchar(24) NOT NULL CHECK (operation IN ('marks','submit','finalize','reopen','evidence','evidence_review','automatic_finalize')),
  idempotency_key varchar(128) NOT NULL,
  request_hash char(64) NOT NULL,
  request_id uuid NOT NULL,
  register_revision integer NOT NULL CHECK (register_revision > 0),
  result_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(register_id,school_id) REFERENCES activity_attendance_registers(id,school_id) ON DELETE RESTRICT,
  UNIQUE(school_id,actor_id,idempotency_key)
);

CREATE TABLE activity_attendance_entry_revisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  register_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  person_id uuid NOT NULL REFERENCES school_people(id) ON DELETE RESTRICT,
  previous_status varchar(16) CHECK (previous_status IN ('present','absent','late','excused')),
  new_status varchar(16) CHECK (new_status IN ('present','absent','late','excused')),
  previous_remarks varchar(500),
  new_remarks varchar(500) NOT NULL DEFAULT '',
  capture_channel varchar(24) NOT NULL,
  observed_at timestamptz NOT NULL,
  reason varchar(500) NOT NULL CHECK (length(btrim(reason)) >= 3),
  changed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  register_revision integer NOT NULL CHECK (register_revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(register_id,school_id) REFERENCES activity_attendance_registers(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(entry_id,school_id) REFERENCES activity_attendance_entries(id,school_id) ON DELETE RESTRICT
);
CREATE INDEX activity_attendance_history_idx ON activity_attendance_entry_revisions(register_id,id);

CREATE TABLE activity_attendance_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  register_id uuid NOT NULL,
  person_id uuid NOT NULL REFERENCES school_people(id) ON DELETE RESTRICT,
  claimed_status varchar(16) NOT NULL CHECK (claimed_status IN ('present','absent','late','excused')),
  capture_channel varchar(24) NOT NULL CHECK (capture_channel IN ('offline_paper','self_check_in','camera_assisted','registered_device')),
  state varchar(16) NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','accepted','rejected')),
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  submitted_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_reference varchar(160) NOT NULL DEFAULT '',
  note varchar(500) NOT NULL DEFAULT '',
  observation_id uuid,
  decided_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  decided_at timestamptz,
  decision_note varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(register_id,school_id) REFERENCES activity_attendance_registers(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(register_id,person_id) REFERENCES activity_attendance_roster(register_id,person_id) ON DELETE RESTRICT,
  CHECK ((decided_by IS NULL) = (decided_at IS NULL)),
  CHECK (decision_note IS NULL OR length(btrim(decision_note)) >= 3)
);
CREATE INDEX activity_attendance_evidence_queue_idx ON activity_attendance_evidence(register_id,state,received_at,id);

CREATE TABLE activity_attendance_audits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  register_id uuid NOT NULL,
  action varchar(40) NOT NULL,
  actor_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  reason varchar(500),
  register_revision integer NOT NULL CHECK (register_revision > 0),
  request_id uuid NOT NULL,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(register_id,school_id) REFERENCES activity_attendance_registers(id,school_id) ON DELETE RESTRICT
);
CREATE INDEX activity_attendance_audit_history_idx ON activity_attendance_audits(register_id,id);

CREATE TABLE activity_attendance_legacy_links (
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  source_kind varchar(24) NOT NULL CHECK (source_kind IN ('daily_class','scheduled_session','event','examination')),
  source_id text NOT NULL,
  register_id uuid NOT NULL,
  imported_revision integer NOT NULL CHECK (imported_revision >= 0),
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(school_id,source_kind,source_id),
  FOREIGN KEY(register_id,school_id) REFERENCES activity_attendance_registers(id,school_id) ON DELETE RESTRICT
);

CREATE FUNCTION validate_activity_attendance_person_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM school_people person WHERE person.id=NEW.person_id AND person.school_id=NEW.school_id) THEN
    RAISE EXCEPTION 'Attendance participant belongs to another institution' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER activity_attendance_entry_person_scope BEFORE INSERT OR UPDATE ON activity_attendance_entries
  FOR EACH ROW EXECUTE FUNCTION validate_activity_attendance_person_scope();
CREATE TRIGGER activity_attendance_roster_person_scope BEFORE INSERT OR UPDATE ON activity_attendance_roster
  FOR EACH ROW EXECUTE FUNCTION validate_activity_attendance_person_scope();
CREATE TRIGGER activity_attendance_revision_person_scope BEFORE INSERT OR UPDATE ON activity_attendance_entry_revisions
  FOR EACH ROW EXECUTE FUNCTION validate_activity_attendance_person_scope();
CREATE TRIGGER activity_attendance_evidence_person_scope BEFORE INSERT OR UPDATE ON activity_attendance_evidence
  FOR EACH ROW EXECUTE FUNCTION validate_activity_attendance_person_scope();

CREATE TRIGGER activity_attendance_revisions_append_only BEFORE UPDATE OR DELETE ON activity_attendance_entry_revisions
  FOR EACH ROW EXECUTE FUNCTION prevent_attendance_observation_mutation();
CREATE TRIGGER activity_attendance_audits_append_only BEFORE UPDATE OR DELETE ON activity_attendance_audits
  FOR EACH ROW EXECUTE FUNCTION prevent_attendance_observation_mutation();

DO $$
DECLARE target_name text;
BEGIN
  FOREACH target_name IN ARRAY ARRAY['activity_attendance_registers','activity_attendance_roster','activity_attendance_entries',
    'activity_attendance_commands','activity_attendance_entry_revisions','activity_attendance_evidence',
    'activity_attendance_audits','activity_attendance_legacy_links'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',target_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',target_name);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon',target_name); END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated',target_name); END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION validate_activity_attendance_person_scope() FROM PUBLIC;
