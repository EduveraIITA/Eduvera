-- Campus events and activities are operational records distinct from timetable
-- and academic attendance.  Nothing in this schema writes attendance_records.

-- Explicit, dated teaching authority.  Timetable rows can be used to seed these
-- grants, but authority never depends on a free-text designation or name.
CREATE TABLE class_section_staff_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  class_section_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role varchar(24) NOT NULL CHECK(role IN ('class_teacher','subject_teacher')),
  subject_id uuid,
  valid_from date NOT NULL,
  valid_until date,
  assigned_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  FOREIGN KEY(school_id,class_section_id) REFERENCES class_sections(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,subject_id) REFERENCES subjects(school_id,id) ON DELETE RESTRICT,
  CHECK((role='subject_teacher')=(subject_id IS NOT NULL)),
  CHECK(valid_until IS NULL OR valid_until>=valid_from),
  UNIQUE(school_id,class_section_id,user_id,role,subject_id,valid_from)
);
CREATE INDEX class_section_staff_assignment_lookup_idx
  ON class_section_staff_assignments(school_id,user_id,class_section_id,subject_id,valid_from,valid_until);
CREATE UNIQUE INDEX class_section_one_class_teacher_grant_idx
  ON class_section_staff_assignments(school_id,class_section_id,user_id,valid_from)
  WHERE role='class_teacher';

CREATE TABLE campus_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  event_type varchar(32) NOT NULL CHECK(event_type IN (
    'annual_function','excursion','sports','workshop','competition','assembly','ptm','club','class_test','other'
  )),
  subject_id uuid,
  status varchar(16) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','cancelled','completed')),
  title varchar(160) NOT NULL CHECK(length(trim(title))>0),
  description varchar(4000) NOT NULL DEFAULT '',
  venue varchar(240) NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  audience_mode varchar(24) NOT NULL CHECK(audience_mode IN ('school','class_sections','students')),
  participation_requirement varchar(16) NOT NULL CHECK(participation_requirement IN ('optional','mandatory')),
  requires_rsvp boolean NOT NULL DEFAULT false,
  requires_guardian_consent boolean NOT NULL DEFAULT false,
  payment_required boolean NOT NULL DEFAULT false,
  payment_amount_paise integer,
  payment_due_on date,
  payment_currency char(3) NOT NULL DEFAULT 'INR' CHECK(payment_currency='INR'),
  academic_attendance_impact varchar(8) NOT NULL DEFAULT 'none' CHECK(academic_attendance_impact='none'),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  published_at timestamptz,
  cancelled_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  cancelled_at timestamptz,
  cancellation_internal_reason varchar(500),
  cancellation_reason varchar(500),
  completed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  FOREIGN KEY(school_id,subject_id) REFERENCES subjects(school_id,id) ON DELETE RESTRICT,
  CHECK(ends_at>starts_at),
  CHECK(payment_required=(payment_amount_paise IS NOT NULL AND payment_due_on IS NOT NULL)),
  CHECK(payment_amount_paise IS NULL OR payment_amount_paise BETWEEN 1 AND 100000000),
  CHECK(participation_requirement='mandatory' OR requires_rsvp),
  CHECK(event_type<>'class_test' OR (
    subject_id IS NOT NULL AND participation_requirement='mandatory' AND NOT requires_rsvp
    AND NOT requires_guardian_consent AND NOT payment_required AND academic_attendance_impact='none'
  )),
  CHECK((published_at IS NULL)=(published_by IS NULL)),
  CHECK((cancelled_at IS NULL)=(cancelled_by IS NULL)),
  CHECK((completed_at IS NULL)=(completed_by IS NULL)),
  CHECK(status<>'published' OR published_at IS NOT NULL),
  CHECK(status<>'cancelled' OR (
    cancelled_at IS NOT NULL
    AND length(trim(cancellation_internal_reason))>=3
    AND length(trim(cancellation_reason))>=3
  )),
  CHECK(status<>'completed' OR completed_at IS NOT NULL)
);
CREATE INDEX campus_events_school_window_idx ON campus_events(school_id,starts_at,ends_at,id);
CREATE INDEX campus_events_school_status_idx ON campus_events(school_id,status,starts_at,id);

CREATE TABLE campus_event_class_sections (
  school_id uuid NOT NULL,
  event_id uuid NOT NULL,
  class_section_id uuid NOT NULL,
  PRIMARY KEY(event_id,class_section_id),
  FOREIGN KEY(school_id,event_id) REFERENCES campus_events(school_id,id) ON DELETE CASCADE,
  FOREIGN KEY(school_id,class_section_id) REFERENCES class_sections(school_id,id) ON DELETE RESTRICT
);
CREATE INDEX campus_event_classes_scope_idx ON campus_event_class_sections(school_id,class_section_id,event_id);

CREATE TABLE campus_event_selected_students (
  school_id uuid NOT NULL,
  event_id uuid NOT NULL,
  student_id uuid NOT NULL,
  PRIMARY KEY(event_id,student_id),
  FOREIGN KEY(school_id,event_id) REFERENCES campus_events(school_id,id) ON DELETE CASCADE,
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT
);
CREATE INDEX campus_event_students_scope_idx ON campus_event_selected_students(school_id,student_id,event_id);

CREATE TABLE campus_event_staff (
  school_id uuid NOT NULL,
  event_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role varchar(24) NOT NULL CHECK(role IN ('organizer','duty_staff','attendance_taker')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(event_id,user_id),
  FOREIGN KEY(school_id,event_id) REFERENCES campus_events(school_id,id) ON DELETE CASCADE
);
CREATE INDEX campus_event_staff_user_idx ON campus_event_staff(school_id,user_id,event_id);

CREATE TABLE campus_event_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  event_id uuid NOT NULL,
  title varchar(160) NOT NULL CHECK(length(trim(title))>0),
  session_type varchar(16) NOT NULL CHECK(session_type IN ('general','rehearsal','departure','activity','return')),
  venue varchar(240) NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  attendance_mode varchar(16) NOT NULL CHECK(attendance_mode IN ('none','check_in','check_in_out')),
  state varchar(16) NOT NULL DEFAULT 'open' CHECK(state IN ('open','locked')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  locked_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  locked_at timestamptz,
  lock_reason varchar(500),
  reopened_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  reopened_at timestamptz,
  reopen_reason varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,event_id,id),
  FOREIGN KEY(school_id,event_id) REFERENCES campus_events(school_id,id) ON DELETE CASCADE,
  CHECK(ends_at>starts_at),
  CHECK((state='locked')=(locked_at IS NOT NULL AND locked_by IS NOT NULL)),
  CHECK(lock_reason IS NULL OR length(trim(lock_reason))>=3),
  CHECK(reopen_reason IS NULL OR length(trim(reopen_reason))>=3)
);
CREATE INDEX campus_event_sessions_event_time_idx ON campus_event_sessions(school_id,event_id,starts_at,id);

CREATE TABLE campus_event_session_selected_students (
  school_id uuid NOT NULL,
  event_id uuid NOT NULL,
  session_id uuid NOT NULL,
  student_id uuid NOT NULL,
  PRIMARY KEY(session_id,student_id),
  FOREIGN KEY(school_id,event_id,session_id) REFERENCES campus_event_sessions(school_id,event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT
);
CREATE INDEX campus_event_session_selected_student_idx
  ON campus_event_session_selected_students(school_id,student_id,event_id,session_id);

CREATE TABLE campus_event_participants (
  school_id uuid NOT NULL,
  event_id uuid NOT NULL,
  student_id uuid NOT NULL,
  participation_requirement varchar(16) NOT NULL CHECK(participation_requirement IN ('optional','mandatory')),
  rsvp_status varchar(16) NOT NULL DEFAULT 'pending' CHECK(rsvp_status IN ('pending','accepted','declined')),
  rsvp_revision integer NOT NULL DEFAULT 0 CHECK(rsvp_revision>=0),
  fee_invoice_id uuid,
  invited_at timestamptz NOT NULL DEFAULT now(),
  rsvp_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  rsvp_at timestamptz,
  PRIMARY KEY(event_id,student_id),
  UNIQUE(school_id,event_id,student_id),
  FOREIGN KEY(school_id,event_id) REFERENCES campus_events(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT,
  CHECK((rsvp_at IS NULL)=(rsvp_by IS NULL))
);
CREATE INDEX campus_event_participants_student_idx ON campus_event_participants(school_id,student_id,event_id);

CREATE TABLE campus_event_session_participants (
  school_id uuid NOT NULL,
  event_id uuid NOT NULL,
  session_id uuid NOT NULL,
  student_id uuid NOT NULL,
  participation_requirement varchar(16) NOT NULL CHECK(participation_requirement IN ('optional','mandatory')),
  PRIMARY KEY(session_id,student_id),
  UNIQUE(school_id,event_id,session_id,student_id),
  FOREIGN KEY(school_id,event_id,session_id) REFERENCES campus_event_sessions(school_id,event_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,event_id,student_id) REFERENCES campus_event_participants(school_id,event_id,student_id) ON DELETE RESTRICT
);
CREATE INDEX campus_event_session_participant_event_idx ON campus_event_session_participants(school_id,event_id,student_id);

CREATE UNIQUE INDEX campus_event_fee_invoice_scope_idx ON fee_invoices(school_id,id,student_id);
ALTER TABLE campus_event_participants ADD CONSTRAINT campus_event_participant_fee_invoice_fk
  FOREIGN KEY(school_id,fee_invoice_id,student_id) REFERENCES fee_invoices(school_id,id,student_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX campus_event_participant_invoice_unique_idx
  ON campus_event_participants(fee_invoice_id) WHERE fee_invoice_id IS NOT NULL;

-- Event consent is purpose-specific.  It deliberately does not inherit the
-- separate leave-signing flag on guardian_relationships.
CREATE TABLE campus_event_consent_authorities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  relationship_id uuid NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'active' CHECK(status='active'),
  valid_from date NOT NULL,
  valid_until date,
  source varchar(16) NOT NULL CHECK(source IN ('enrollment','reviewed','policy')),
  provenance varchar(500) NOT NULL CHECK(length(trim(provenance))>=3),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  granted_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  revocation_reason varchar(500),
  UNIQUE(school_id,id,relationship_id),
  FOREIGN KEY(school_id,relationship_id) REFERENCES guardian_relationships(school_id,id) ON DELETE RESTRICT,
  CHECK(valid_until IS NULL OR valid_until>=valid_from),
  CHECK(revoked_by IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL)
);
CREATE INDEX campus_event_consent_authority_relationship_idx
  ON campus_event_consent_authorities(school_id,relationship_id,revision DESC,id);

-- Grants are immutable evidence. A revocation is a separate append-only fact,
-- so later administrative review cannot rewrite what authorized an earlier
-- consent decision.
CREATE TABLE campus_event_consent_authority_revocations (
  school_id uuid NOT NULL,
  authority_id uuid PRIMARY KEY,
  relationship_id uuid NOT NULL,
  revision integer NOT NULL CHECK(revision>0),
  revoked_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  reason varchar(500) NOT NULL CHECK(length(trim(reason))>=3),
  request_id uuid NOT NULL UNIQUE,
  FOREIGN KEY(school_id,authority_id,relationship_id)
    REFERENCES campus_event_consent_authorities(school_id,id,relationship_id) ON DELETE RESTRICT,
  UNIQUE(school_id,relationship_id,revision)
);
CREATE INDEX campus_event_consent_authority_revocation_relationship_idx
  ON campus_event_consent_authority_revocations(school_id,relationship_id,revoked_at DESC);

CREATE TABLE campus_event_consents (
  school_id uuid NOT NULL,
  event_id uuid NOT NULL,
  student_id uuid NOT NULL,
  relationship_id uuid NOT NULL,
  authority_id uuid NOT NULL,
  status varchar(16) NOT NULL CHECK(status IN ('granted','denied','withdrawn')),
  note varchar(500) NOT NULL DEFAULT '',
  decided_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decided_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  PRIMARY KEY(event_id,student_id),
  FOREIGN KEY(school_id,event_id,student_id) REFERENCES campus_event_participants(school_id,event_id,student_id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,relationship_id) REFERENCES guardian_relationships(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,authority_id,relationship_id) REFERENCES campus_event_consent_authorities(school_id,id,relationship_id) ON DELETE RESTRICT
);
CREATE INDEX campus_event_consents_authority_idx ON campus_event_consents(school_id,authority_id,event_id);
CREATE INDEX campus_event_consents_participant_idx ON campus_event_consents(school_id,event_id,student_id);

CREATE TABLE campus_event_consent_revisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id uuid NOT NULL,
  event_id uuid NOT NULL,
  student_id uuid NOT NULL,
  relationship_id uuid NOT NULL,
  authority_id uuid NOT NULL,
  previous_status varchar(16) CHECK(previous_status IS NULL OR previous_status IN ('granted','denied','withdrawn')),
  new_status varchar(16) NOT NULL CHECK(new_status IN ('granted','denied','withdrawn')),
  previous_note varchar(500),
  new_note varchar(500) NOT NULL DEFAULT '',
  revision integer NOT NULL CHECK(revision>0),
  decided_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id,event_id,student_id),
  FOREIGN KEY(school_id,event_id,student_id) REFERENCES campus_event_participants(school_id,event_id,student_id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,authority_id,relationship_id) REFERENCES campus_event_consent_authorities(school_id,id,relationship_id) ON DELETE RESTRICT
);
CREATE INDEX campus_event_consent_history_idx ON campus_event_consent_revisions(school_id,event_id,student_id,id DESC);

CREATE TABLE campus_event_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  event_id uuid NOT NULL,
  label varchar(180) NOT NULL CHECK(length(trim(label))>0),
  required boolean NOT NULL DEFAULT false,
  sort_order smallint NOT NULL DEFAULT 0 CHECK(sort_order>=0),
  UNIQUE(school_id,event_id,id),
  FOREIGN KEY(school_id,event_id) REFERENCES campus_events(school_id,id) ON DELETE CASCADE
);
CREATE INDEX campus_event_checklist_items_event_idx ON campus_event_checklist_items(school_id,event_id,sort_order,id);

CREATE TABLE campus_event_checklist_completions (
  school_id uuid NOT NULL,
  event_id uuid NOT NULL,
  item_id uuid NOT NULL,
  student_id uuid NOT NULL,
  completed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(item_id,student_id),
  FOREIGN KEY(school_id,event_id,item_id) REFERENCES campus_event_checklist_items(school_id,event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(school_id,event_id,student_id) REFERENCES campus_event_participants(school_id,event_id,student_id) ON DELETE CASCADE
);
CREATE INDEX campus_event_checklist_completion_student_idx
  ON campus_event_checklist_completions(school_id,event_id,student_id,item_id);

CREATE TABLE campus_event_attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  event_id uuid NOT NULL,
  session_id uuid NOT NULL,
  student_id uuid NOT NULL,
  status varchar(16) NOT NULL CHECK(status IN ('not_recorded','present','late','excused','no_show','checked_out')),
  note varchar(500) NOT NULL DEFAULT '',
  readiness_contradiction_note varchar(500),
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  marked_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  marked_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id,student_id),
  UNIQUE(school_id,event_id,session_id,student_id),
  UNIQUE(school_id,event_id,session_id,student_id,id),
  FOREIGN KEY(school_id,event_id,session_id) REFERENCES campus_event_sessions(school_id,event_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,event_id,session_id,student_id) REFERENCES campus_event_session_participants(school_id,event_id,session_id,student_id) ON DELETE RESTRICT,
  CHECK(checked_out_at IS NULL OR checked_in_at IS NOT NULL),
  CHECK(checked_out_at IS NULL OR checked_out_at>=checked_in_at),
  CHECK((status='checked_out')=(checked_out_at IS NOT NULL)),
  CHECK(status NOT IN ('not_recorded','excused','no_show') OR (checked_in_at IS NULL AND checked_out_at IS NULL)),
  CHECK(readiness_contradiction_note IS NULL OR length(trim(readiness_contradiction_note))>=3),
  CHECK(status IN ('present','late','checked_out') OR readiness_contradiction_note IS NULL)
);
CREATE INDEX campus_event_attendance_session_idx ON campus_event_attendance_records(school_id,session_id,status,student_id);

CREATE TABLE campus_event_attendance_revisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id uuid NOT NULL,
  event_id uuid NOT NULL,
  session_id uuid NOT NULL,
  student_id uuid NOT NULL,
  attendance_record_id uuid NOT NULL REFERENCES campus_event_attendance_records(id) ON DELETE RESTRICT,
  previous_status varchar(16) CHECK(previous_status IS NULL OR previous_status IN ('not_recorded','present','late','excused','no_show','checked_out')),
  new_status varchar(16) NOT NULL CHECK(new_status IN ('not_recorded','present','late','excused','no_show','checked_out')),
  previous_note varchar(500),
  new_note varchar(500) NOT NULL DEFAULT '',
  previous_readiness_contradiction_note varchar(500),
  new_readiness_contradiction_note varchar(500),
  previous_checked_in_at timestamptz,
  new_checked_in_at timestamptz,
  previous_checked_out_at timestamptz,
  new_checked_out_at timestamptz,
  reason varchar(500) NOT NULL CHECK(length(trim(reason))>=3),
  revision integer NOT NULL CHECK(revision>0),
  changed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id,attendance_record_id),
  FOREIGN KEY(school_id,event_id,session_id,student_id,attendance_record_id)
    REFERENCES campus_event_attendance_records(school_id,event_id,session_id,student_id,id) ON DELETE RESTRICT,
  CHECK(previous_readiness_contradiction_note IS NULL OR length(trim(previous_readiness_contradiction_note))>=3),
  CHECK(new_readiness_contradiction_note IS NULL OR length(trim(new_readiness_contradiction_note))>=3)
);
CREATE INDEX campus_event_attendance_history_idx ON campus_event_attendance_revisions(school_id,session_id,id DESC);
CREATE INDEX campus_event_attendance_history_student_idx
  ON campus_event_attendance_revisions(school_id,event_id,session_id,student_id,id DESC);
CREATE INDEX campus_event_attendance_history_record_idx
  ON campus_event_attendance_revisions(attendance_record_id,id DESC);

CREATE TABLE campus_event_commands (
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  command_key uuid NOT NULL,
  operation varchar(80) NOT NULL,
  request_hash char(64) NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(school_id,actor_id,command_key)
);
CREATE INDEX campus_event_commands_created_idx ON campus_event_commands(school_id,created_at DESC);

CREATE FUNCTION validate_campus_event_session_window()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE event_row campus_events%ROWTYPE;
BEGIN
  SELECT * INTO event_row FROM campus_events WHERE id=NEW.event_id AND school_id=NEW.school_id;
  IF NOT FOUND OR NEW.starts_at<event_row.starts_at OR NEW.ends_at>event_row.ends_at THEN
    RAISE EXCEPTION 'Event session must fall within the event time window' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campus_event_session_window_before_write
  BEFORE INSERT OR UPDATE OF school_id,event_id,starts_at,ends_at ON campus_event_sessions
  FOR EACH ROW EXECUTE FUNCTION validate_campus_event_session_window();

CREATE FUNCTION validate_campus_event_session_participant()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE participant_row campus_event_participants%ROWTYPE;
BEGIN
  SELECT * INTO participant_row FROM campus_event_participants participant
  WHERE participant.school_id=NEW.school_id AND participant.event_id=NEW.event_id
    AND participant.student_id=NEW.student_id;
  IF NOT FOUND OR participant_row.participation_requirement<>NEW.participation_requirement THEN
    RAISE EXCEPTION 'Session participation must match the event invitation' USING ERRCODE='23514';
  END IF;
  IF NEW.participation_requirement='optional' AND participant_row.rsvp_status<>'accepted' THEN
    RAISE EXCEPTION 'Only an accepted optional participant may enter an event session roster' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER campus_event_session_participant_valid
  AFTER INSERT OR UPDATE ON campus_event_session_participants DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION validate_campus_event_session_participant();

CREATE FUNCTION validate_campus_event_participant_rsvp()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.participation_requirement='optional' AND NEW.rsvp_status<>'accepted' AND EXISTS (
    SELECT 1 FROM campus_event_session_participants roster
    WHERE roster.school_id=NEW.school_id AND roster.event_id=NEW.event_id
      AND roster.student_id=NEW.student_id
  ) THEN
    RAISE EXCEPTION 'Remove an optional participant from every session roster before changing an accepted RSVP' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER campus_event_participant_rsvp_valid
  AFTER UPDATE OF participation_requirement,rsvp_status ON campus_event_participants DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION validate_campus_event_participant_rsvp();

CREATE FUNCTION validate_campus_event_consent_authority_grant()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE latest_revision integer;
BEGIN
  PERFORM 1 FROM guardian_relationships relationship
  WHERE relationship.school_id=NEW.school_id AND relationship.id=NEW.relationship_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event-consent authority must belong to an existing guardian relationship' USING ERRCODE='23503';
  END IF;
  IF EXISTS (
    SELECT 1 FROM campus_event_consent_authorities authority
    WHERE authority.school_id=NEW.school_id AND authority.relationship_id=NEW.relationship_id
      AND NOT EXISTS(SELECT 1 FROM campus_event_consent_authority_revocations revocation
        WHERE revocation.authority_id=authority.id)
  ) THEN
    RAISE EXCEPTION 'An unrevoked event-consent authority already exists for this guardian relationship' USING ERRCODE='23505';
  END IF;
  SELECT max(version) INTO latest_revision FROM (
    SELECT authority.revision AS version FROM campus_event_consent_authorities authority
    WHERE authority.school_id=NEW.school_id AND authority.relationship_id=NEW.relationship_id
    UNION ALL
    SELECT revocation.revision FROM campus_event_consent_authority_revocations revocation
    WHERE revocation.school_id=NEW.school_id AND revocation.relationship_id=NEW.relationship_id
  ) versions;
  IF NEW.revision<>COALESCE(latest_revision,0)+1 THEN
    RAISE EXCEPTION 'Event-consent authority revision must advance the relationship history by one' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campus_event_consent_authority_grant_valid
  BEFORE INSERT ON campus_event_consent_authorities
  FOR EACH ROW EXECUTE FUNCTION validate_campus_event_consent_authority_grant();

CREATE FUNCTION validate_campus_event_consent_authority_revocation()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE latest_revision integer;
BEGIN
  PERFORM 1 FROM guardian_relationships relationship
  WHERE relationship.school_id=NEW.school_id AND relationship.id=NEW.relationship_id
  FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM campus_event_consent_authorities authority
    WHERE authority.school_id=NEW.school_id AND authority.id=NEW.authority_id
      AND authority.relationship_id=NEW.relationship_id
  ) THEN
    RAISE EXCEPTION 'Revocation must reference the same event-consent authority relationship' USING ERRCODE='23503';
  END IF;
  IF EXISTS (SELECT 1 FROM campus_event_consent_authority_revocations revocation
    WHERE revocation.authority_id=NEW.authority_id) THEN
    RAISE EXCEPTION 'This event-consent authority is already revoked' USING ERRCODE='23505';
  END IF;
  SELECT max(version) INTO latest_revision FROM (
    SELECT authority.revision AS version FROM campus_event_consent_authorities authority
    WHERE authority.school_id=NEW.school_id AND authority.relationship_id=NEW.relationship_id
    UNION ALL
    SELECT revocation.revision FROM campus_event_consent_authority_revocations revocation
    WHERE revocation.school_id=NEW.school_id AND revocation.relationship_id=NEW.relationship_id
  ) versions;
  IF NEW.revision<>COALESCE(latest_revision,0)+1 THEN
    RAISE EXCEPTION 'Event-consent authority revocation must advance the relationship history by one' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campus_event_consent_authority_revocation_valid
  BEFORE INSERT ON campus_event_consent_authority_revocations
  FOR EACH ROW EXECUTE FUNCTION validate_campus_event_consent_authority_revocation();

CREATE FUNCTION prevent_campus_event_consent_authority_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Event-consent authority evidence is append-only' USING ERRCODE='55000';
END $$;
CREATE TRIGGER campus_event_consent_authority_grant_append_only
  BEFORE UPDATE OR DELETE ON campus_event_consent_authorities
  FOR EACH ROW EXECUTE FUNCTION prevent_campus_event_consent_authority_mutation();
CREATE TRIGGER campus_event_consent_authority_revocation_append_only
  BEFORE UPDATE OR DELETE ON campus_event_consent_authority_revocations
  FOR EACH ROW EXECUTE FUNCTION prevent_campus_event_consent_authority_mutation();

CREATE FUNCTION validate_campus_event_consent()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM guardian_relationships relationship
    JOIN campus_event_consent_authorities authority
      ON authority.relationship_id=relationship.id AND authority.school_id=relationship.school_id
    JOIN schools school ON school.id=relationship.school_id
    JOIN campus_events event ON event.id=NEW.event_id AND event.school_id=NEW.school_id
    WHERE relationship.id=NEW.relationship_id AND relationship.school_id=NEW.school_id
      AND relationship.student_id=NEW.student_id AND authority.id=NEW.authority_id
      AND (NEW.status='withdrawn' OR (
        NOT EXISTS(SELECT 1 FROM campus_event_consent_authority_revocations revocation
          WHERE revocation.authority_id=authority.id)
        AND (NEW.decided_at AT TIME ZONE school.timezone)::date
          BETWEEN authority.valid_from AND COALESCE(authority.valid_until,'infinity'::date)
        AND (event.starts_at AT TIME ZONE school.timezone)::date
          BETWEEN authority.valid_from AND COALESCE(authority.valid_until,'infinity'::date)
      ))
      AND EXISTS (
        SELECT 1 FROM parents parent JOIN users account ON account.id=parent.user_id AND account.is_active
        JOIN school_memberships membership ON membership.user_id=parent.user_id
          AND membership.school_id=NEW.school_id AND membership.role='guardian' AND membership.is_active
        WHERE parent.id=relationship.guardian_id AND parent.user_id=NEW.decided_by
      )
  ) THEN
    RAISE EXCEPTION 'Guardian does not hold active event-consent authority for this student' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER campus_event_consent_authority_valid
  AFTER INSERT OR UPDATE ON campus_event_consents DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION validate_campus_event_consent();

CREATE FUNCTION validate_campus_event_attendance_record()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE participant_ready boolean;
BEGIN
  IF NEW.status='no_show' AND NOT EXISTS (
    SELECT 1 FROM campus_event_session_participants roster
    JOIN campus_event_participants participant ON participant.school_id=roster.school_id
      AND participant.event_id=roster.event_id AND participant.student_id=roster.student_id
    WHERE roster.school_id=NEW.school_id AND roster.event_id=NEW.event_id
      AND roster.session_id=NEW.session_id AND roster.student_id=NEW.student_id
      AND (roster.participation_requirement='mandatory'
        OR (roster.participation_requirement='optional' AND participant.rsvp_status='accepted'))
  ) THEN
    RAISE EXCEPTION 'Only a mandatory or accepted optional event participant may be marked no-show' USING ERRCODE='23514';
  END IF;
  SELECT (
    (NOT event.requires_guardian_consent OR EXISTS(
      SELECT 1 FROM campus_event_consents consent
      JOIN campus_event_consent_authorities authority ON authority.id=consent.authority_id
      JOIN schools school ON school.id=authority.school_id
      WHERE consent.event_id=NEW.event_id AND consent.student_id=NEW.student_id
        AND consent.status='granted'
        AND (consent.decided_at AT TIME ZONE school.timezone)::date
          BETWEEN authority.valid_from AND COALESCE(authority.valid_until,'infinity'::date)
        AND (event.starts_at AT TIME ZONE school.timezone)::date
          BETWEEN authority.valid_from AND COALESCE(authority.valid_until,'infinity'::date)
        AND NOT EXISTS(SELECT 1 FROM campus_event_consent_authority_revocations revocation
          WHERE revocation.authority_id=authority.id AND revocation.revoked_at<=event.starts_at)
    )) AND NOT EXISTS(
      SELECT 1 FROM campus_event_checklist_items required_item
      WHERE required_item.event_id=NEW.event_id AND required_item.required
        AND NOT EXISTS(SELECT 1 FROM campus_event_checklist_completions completion
          WHERE completion.item_id=required_item.id AND completion.student_id=NEW.student_id)
    )
  ) INTO participant_ready
  FROM campus_events event WHERE event.school_id=NEW.school_id AND event.id=NEW.event_id;
  IF NEW.status='no_show' AND NOT COALESCE(participant_ready,false) THEN
    RAISE EXCEPTION 'No-show requires complete event consent and readiness' USING ERRCODE='23514';
  END IF;
  IF NEW.status IN ('present','late','checked_out') AND NOT COALESCE(participant_ready,false)
    AND NEW.readiness_contradiction_note IS NULL THEN
    RAISE EXCEPTION 'Physical attendance without complete readiness requires contradiction evidence' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM campus_event_sessions session
    WHERE session.school_id=NEW.school_id AND session.event_id=NEW.event_id
      AND session.id=NEW.session_id AND session.attendance_mode<>'none'
  ) THEN
    RAISE EXCEPTION 'Attendance is disabled for this event session' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER campus_event_attendance_record_valid
  AFTER INSERT OR UPDATE ON campus_event_attendance_records DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION validate_campus_event_attendance_record();

CREATE FUNCTION prevent_campus_event_attendance_revision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Campus event attendance revision history is append-only' USING ERRCODE='55000';
END $$;
CREATE TRIGGER campus_event_attendance_revision_append_only
  BEFORE UPDATE OR DELETE ON campus_event_attendance_revisions
  FOR EACH ROW EXECUTE FUNCTION prevent_campus_event_attendance_revision_mutation();

CREATE FUNCTION prevent_campus_event_consent_revision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Campus event consent revision history is append-only' USING ERRCODE='55000';
END $$;
CREATE TRIGGER campus_event_consent_revision_append_only
  BEFORE UPDATE OR DELETE ON campus_event_consent_revisions
  FOR EACH ROW EXECUTE FUNCTION prevent_campus_event_consent_revision_mutation();

-- Extend durable event replay authorization without changing older event rules.
ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid)
  RENAME TO event_user_is_authorized_before_campus_events;
CREATE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE WHEN event_name='campus_event.updated' THEN EXISTS (
    SELECT 1 FROM campus_events event
    JOIN school_memberships membership ON membership.school_id=event.school_id
      AND membership.user_id=candidate_user_id AND membership.is_active
    JOIN users account ON account.id=membership.user_id AND account.is_active
    WHERE event.school_id=event_school_id AND event.id::text=event_payload->>'event_id'
      AND (
        membership.role='admin'
        OR (membership.role='staff' AND EXISTS (
          SELECT 1 FROM campus_event_staff staff
          WHERE staff.event_id=event.id AND staff.school_id=event.school_id
            AND staff.user_id=membership.user_id
        ))
        OR (membership.role='student' AND event.status<>'draft' AND EXISTS (
          SELECT 1 FROM campus_event_participants participant
          JOIN students student ON student.id=participant.student_id
          WHERE participant.event_id=event.id AND participant.school_id=event.school_id
            AND student.user_id=membership.user_id
        ))
        OR (membership.role='guardian' AND event.status<>'draft' AND EXISTS (
          SELECT 1 FROM campus_event_participants participant
          JOIN guardian_relationships relationship ON relationship.student_id=participant.student_id
            AND relationship.school_id=participant.school_id
          JOIN parents parent ON parent.id=relationship.guardian_id
          WHERE participant.event_id=event.id AND participant.school_id=event.school_id
            AND parent.user_id=membership.user_id
        ))
      )
  ) ELSE event_user_is_authorized_before_campus_events(
    event_school_id,event_name,event_payload,candidate_user_id
  ) END
$$;

REVOKE ALL ON FUNCTION validate_campus_event_session_window() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_campus_event_session_participant() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_campus_event_participant_rsvp() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_campus_event_consent_authority_grant() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_campus_event_consent_authority_revocation() FROM PUBLIC;
REVOKE ALL ON FUNCTION prevent_campus_event_consent_authority_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_campus_event_consent() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_campus_event_attendance_record() FROM PUBLIC;
REVOKE ALL ON FUNCTION prevent_campus_event_attendance_revision_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION prevent_campus_event_consent_revision_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) FROM PUBLIC;

DO $$ DECLARE table_name text; owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='students'::regclass;
  FOREACH table_name IN ARRAY ARRAY[
    'class_section_staff_assignments','campus_events','campus_event_class_sections','campus_event_selected_students',
    'campus_event_staff','campus_event_sessions','campus_event_session_selected_students',
    'campus_event_participants','campus_event_session_participants',
    'campus_event_consent_authorities','campus_event_consent_authority_revocations',
    'campus_event_consents','campus_event_consent_revisions',
    'campus_event_checklist_items','campus_event_checklist_completions',
    'campus_event_attendance_records','campus_event_attendance_revisions','campus_event_commands'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',table_name);
    EXECUTE format('ALTER TABLE %I OWNER TO %I',table_name,owner_name);
  END LOOP;
  EXECUTE format('ALTER FUNCTION validate_campus_event_session_window() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION validate_campus_event_session_participant() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION validate_campus_event_participant_rsvp() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION validate_campus_event_consent_authority_grant() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION validate_campus_event_consent_authority_revocation() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION prevent_campus_event_consent_authority_mutation() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION validate_campus_event_consent() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION validate_campus_event_attendance_record() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION prevent_campus_event_attendance_revision_mutation() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION prevent_campus_event_consent_revision_mutation() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO %I',owner_name);
END $$;
