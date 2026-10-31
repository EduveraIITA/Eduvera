-- One authoritative row for each attendance source binding, academic roster
-- identity and accepted command receipt. These three one-to-one bridge stores
-- no longer need independent tables or a second writable lifecycle.
--
-- Keep the ten typed *_legacy_source relations: they retain original historical
-- inputs, source timestamps, unknown signers and native FK relationships.
-- Collapsing those into generic JSON or a sparse union would weaken or obscure
-- referential protection. They have no application writer; immutable import
-- provenance is not a second current participation engine. Current decisions,
-- revisions, observations and DT command/outcome lineage stay relational.

ALTER TABLE activity_attendance_registers
  ADD COLUMN context_source_kind varchar(24),
  ADD COLUMN context_source_id text,
  ADD COLUMN context_imported_revision integer,
  ADD COLUMN context_imported_at timestamptz,
  ADD COLUMN context_state varchar(16),
  ADD COLUMN context_activated_at timestamptz,
  ADD COLUMN context_snapshot jsonb,
  ADD COLUMN context_source_fingerprint char(64),
  ADD CONSTRAINT participation_context_binding_shape CHECK(
    (num_nonnulls(context_source_kind,context_source_id,context_imported_revision,context_imported_at,context_state,context_snapshot)=0
      AND context_activated_at IS NULL AND context_source_fingerprint IS NULL)
    OR (num_nonnulls(context_source_kind,context_source_id,context_imported_revision,context_imported_at,context_state,context_snapshot)=6
      AND context_source_kind IN ('daily_class','scheduled_session','event','examination')
      AND context_imported_revision>=0 AND context_state IN ('imported','active')
      AND (context_state='active')=(context_activated_at IS NOT NULL)
      AND jsonb_typeof(context_snapshot)='object'));
CREATE UNIQUE INDEX participation_context_source_identity
  ON activity_attendance_registers(school_id,context_source_kind,context_source_id)
  WHERE context_source_kind IS NOT NULL;
ALTER TABLE activity_attendance_roster
  ADD COLUMN academic_student_id uuid REFERENCES students(id) ON DELETE RESTRICT,
  ADD COLUMN academic_enrollment_id uuid REFERENCES enrollments(id) ON DELETE RESTRICT,
  ADD COLUMN academic_source_revision integer,
  ADD CONSTRAINT participation_academic_roster_shape CHECK(
    (academic_student_id IS NULL AND academic_enrollment_id IS NULL AND academic_source_revision IS NULL)
    OR (academic_student_id IS NOT NULL AND academic_source_revision IS NOT NULL AND academic_source_revision>0));
CREATE UNIQUE INDEX participation_academic_roster_identity
  ON activity_attendance_roster(register_id,academic_student_id) WHERE academic_student_id IS NOT NULL;
CREATE INDEX participation_academic_roster_student ON activity_attendance_roster(academic_student_id)
  WHERE academic_student_id IS NOT NULL;
CREATE INDEX participation_academic_roster_enrollment ON activity_attendance_roster(academic_enrollment_id)
  WHERE academic_enrollment_id IS NOT NULL;
ALTER TABLE activity_attendance_commands
  ADD COLUMN context_source_kind varchar(24),
  ADD COLUMN context_source_id text,
  ADD COLUMN context_request_hash char(64),
  ADD COLUMN context_result_body jsonb,
  ADD COLUMN context_records_count integer,
  ADD COLUMN context_changed_count integer,
  ADD COLUMN context_capture_source varchar(32),
  ADD COLUMN context_photo_session_id uuid,
  ADD COLUMN context_observed_at timestamptz,
  ADD COLUMN context_receipt_created_at timestamptz,
  ADD CONSTRAINT participation_context_receipt_shape CHECK(
    (num_nonnulls(context_source_kind,context_source_id,context_request_hash,context_result_body,
      context_records_count,context_changed_count,context_capture_source,context_receipt_created_at)=0
      AND context_photo_session_id IS NULL AND context_observed_at IS NULL)
    OR (num_nonnulls(context_source_kind,context_source_id,context_request_hash,context_result_body,
      context_records_count,context_changed_count,context_capture_source,context_receipt_created_at)=8
      AND context_source_kind IN ('daily_class','scheduled_session','event','examination')
      AND context_records_count>0 AND context_changed_count>=0 AND context_changed_count<=context_records_count));
CREATE INDEX participation_context_receipt_source
  ON activity_attendance_commands(school_id,context_source_kind,context_source_id,context_receipt_created_at)
  WHERE context_source_kind IS NOT NULL;

-- Retain view definitions before rebinding their relation dependencies. No
-- DROP CASCADE: an unreviewed dependency must stop this migration atomically.
CREATE TEMP TABLE participation_214_views ON COMMIT DROP AS
  SELECT c.relname,pg_get_viewdef(c.oid,true) AS definition
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname=current_schema() AND c.relkind='v';

DO $migration$
BEGIN
  IF EXISTS(SELECT 1 FROM activity_attendance_legacy_links GROUP BY register_id HAVING count(*)>1) THEN
    RAISE EXCEPTION 'An attendance register has more than one retained source binding';
  END IF;
  IF EXISTS(SELECT 1 FROM activity_attendance_legacy_command_results source
    JOIN activity_attendance_commands command ON command.id=source.command_id WHERE source.school_id<>command.school_id) THEN
    RAISE EXCEPTION 'An attendance receipt belongs to another command institution';
  END IF;
  IF EXISTS(SELECT 1 FROM activity_attendance_legacy_people source JOIN students student ON student.id=source.student_id
    WHERE student.school_id<>source.school_id OR student.person_id IS DISTINCT FROM source.person_id) THEN
    RAISE EXCEPTION 'A retained attendance identity does not match its canonical person and institution';
  END IF;
  UPDATE activity_attendance_registers target SET context_source_kind=source.source_kind,
    context_source_id=source.source_id,context_imported_revision=source.imported_revision,
    context_imported_at=source.imported_at,context_state=source.state,
    context_activated_at=source.activated_at,context_snapshot=source.context_snapshot,
    context_source_fingerprint=source.source_fingerprint
    FROM activity_attendance_legacy_links source WHERE target.id=source.register_id AND target.school_id=source.school_id;
  UPDATE activity_attendance_roster target SET academic_student_id=source.student_id,
    academic_enrollment_id=source.enrollment_id,academic_source_revision=source.source_revision
    FROM activity_attendance_legacy_people source WHERE target.register_id=source.register_id
      AND target.person_id=source.person_id AND target.school_id=source.school_id;
  UPDATE activity_attendance_commands target SET context_source_kind=source.source_kind,
    context_source_id=source.source_id,context_request_hash=source.legacy_request_hash,
    context_result_body=source.result_body,context_records_count=source.records_count,
    context_changed_count=source.changed_count,context_capture_source=source.capture_source,
    context_photo_session_id=source.source_photo_session_id,context_observed_at=source.observed_at,
    context_receipt_created_at=source.created_at
    FROM activity_attendance_legacy_command_results source WHERE target.id=source.command_id AND target.school_id=source.school_id;
  IF (SELECT count(*) FROM activity_attendance_legacy_links)<>(SELECT count(*) FROM activity_attendance_registers WHERE context_source_kind IS NOT NULL)
    OR (SELECT count(*) FROM activity_attendance_legacy_people)<>(SELECT count(*) FROM activity_attendance_roster WHERE academic_student_id IS NOT NULL)
    OR (SELECT count(*) FROM activity_attendance_legacy_command_results)<>(SELECT count(*) FROM activity_attendance_commands WHERE context_source_kind IS NOT NULL) THEN
    RAISE EXCEPTION 'Attendance source convergence did not preserve every bridge record';
  END IF;
END $migration$;

ALTER TABLE activity_attendance_legacy_links RENAME TO retiring_214_context_links;
ALTER TABLE activity_attendance_legacy_people RENAME TO retiring_214_context_people;
ALTER TABLE activity_attendance_legacy_command_results RENAME TO retiring_214_context_results;
CREATE VIEW activity_attendance_source_contexts AS SELECT school_id,context_source_kind AS source_kind,
  context_source_id AS source_id,id AS register_id,context_imported_revision AS imported_revision,
  context_imported_at AS imported_at,context_state AS state,context_activated_at AS activated_at,
  context_snapshot,context_source_fingerprint AS source_fingerprint
  FROM activity_attendance_registers WHERE context_source_kind IS NOT NULL OFFSET 0;
CREATE VIEW activity_attendance_academic_roster AS SELECT school_id,register_id,person_id,
  academic_student_id AS student_id,academic_enrollment_id AS enrollment_id,academic_source_revision AS source_revision
  FROM activity_attendance_roster WHERE academic_student_id IS NOT NULL OFFSET 0;
CREATE VIEW activity_attendance_context_receipts AS SELECT id AS command_id,school_id,
  context_source_kind AS source_kind,context_source_id AS source_id,context_request_hash AS legacy_request_hash,
  context_result_body AS result_body,context_records_count AS records_count,context_changed_count AS changed_count,
  context_capture_source AS capture_source,context_photo_session_id AS source_photo_session_id,
  context_observed_at AS observed_at,context_receipt_created_at AS created_at
  FROM activity_attendance_commands WHERE context_source_kind IS NOT NULL OFFSET 0;

DO $rebind$
DECLARE item record; schema_name text:=current_schema();
BEGIN
  FOR item IN SELECT * FROM participation_214_views LOOP
    EXECUTE format('CREATE OR REPLACE VIEW %I.%I AS %s',schema_name,item.relname,
      replace(replace(replace(item.definition,'activity_attendance_legacy_links','activity_attendance_source_contexts'),
        'activity_attendance_legacy_people','activity_attendance_academic_roster'),
        'activity_attendance_legacy_command_results','activity_attendance_context_receipts'));
  END LOOP;
  -- PL/pgSQL text is not a relation dependency. Rebind only functions that
  -- actually name one retired bridge, retaining all other native contracts.
  FOR item IN SELECT pg_get_functiondef(p.oid) AS definition FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=schema_name AND p.prokind='f'
      AND (p.prosrc LIKE '%activity_attendance_legacy_links%' OR p.prosrc LIKE '%activity_attendance_legacy_people%'
        OR p.prosrc LIKE '%activity_attendance_legacy_command_results%') LOOP
    EXECUTE replace(replace(replace(item.definition,'activity_attendance_legacy_links','activity_attendance_source_contexts'),
      'activity_attendance_legacy_people','activity_attendance_academic_roster'),
      'activity_attendance_legacy_command_results','activity_attendance_context_receipts');
  END LOOP;
END $rebind$;
DROP TABLE retiring_214_context_people RESTRICT;
DROP TABLE retiring_214_context_results RESTRICT;
DROP TABLE retiring_214_context_links RESTRICT;

CREATE FUNCTION validate_participation_academic_roster() RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  IF NEW.academic_student_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM students student WHERE student.id=NEW.academic_student_id
      AND student.school_id=NEW.school_id AND student.person_id=NEW.person_id) THEN
    RAISE EXCEPTION 'Attendance academic identity must match the same canonical person and institution' USING ERRCODE='23514';
  END IF;
  IF NEW.academic_enrollment_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM enrollments enrollment JOIN class_sections section ON section.id=enrollment.class_section_id
      JOIN academic_terms term ON term.id=enrollment.term_id
      WHERE enrollment.id=NEW.academic_enrollment_id AND enrollment.student_id=NEW.academic_student_id
        AND section.school_id=NEW.school_id AND term.school_id=NEW.school_id) THEN
    RAISE EXCEPTION 'Attendance academic enrollment belongs to another participant or institution' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $body$;
CREATE TRIGGER participation_academic_roster_scope BEFORE INSERT OR UPDATE ON activity_attendance_roster
  FOR EACH ROW EXECUTE FUNCTION validate_participation_academic_roster();
CREATE FUNCTION protect_participation_context_receipt() RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.context_source_kind IS NOT NULL THEN
      RAISE EXCEPTION 'An accepted attendance command and its context receipt are append-only' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND OLD.context_source_kind IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'An accepted attendance command and its context receipt are append-only' USING ERRCODE='23514';
  END IF;
  IF NEW.context_source_kind IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM activity_attendance_registers register WHERE register.id=NEW.register_id AND register.school_id=NEW.school_id
      AND register.context_source_kind=NEW.context_source_kind AND register.context_source_id=NEW.context_source_id) THEN
    RAISE EXCEPTION 'An attendance context receipt must match its exact command register and institution' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $body$;
CREATE TRIGGER participation_context_receipt_immutable BEFORE INSERT OR UPDATE OR DELETE ON activity_attendance_commands
  FOR EACH ROW EXECUTE FUNCTION protect_participation_context_receipt();
CREATE TRIGGER participation_context_projection_read_only INSTEAD OF INSERT OR UPDATE OR DELETE ON activity_attendance_source_contexts
  FOR EACH ROW EXECUTE FUNCTION prevent_attendance_observation_mutation();
CREATE TRIGGER participation_context_projection_read_only INSTEAD OF INSERT OR UPDATE OR DELETE ON activity_attendance_academic_roster
  FOR EACH ROW EXECUTE FUNCTION prevent_attendance_observation_mutation();
CREATE TRIGGER participation_context_projection_read_only INSTEAD OF INSERT OR UPDATE OR DELETE ON activity_attendance_context_receipts
  FOR EACH ROW EXECUTE FUNCTION prevent_attendance_observation_mutation();

-- Event/exam adapters now exclusively record current decisions through the
-- common kernel, just like academic adapters. Retained sources cannot become
-- a direct maintenance bypass merely because no context has activated yet.
CREATE TRIGGER participation_archived_source_immutable BEFORE INSERT OR UPDATE OR DELETE ON campus_event_attendance_records_legacy_source
  FOR EACH ROW EXECUTE FUNCTION prevent_attendance_observation_mutation();
CREATE TRIGGER participation_archived_source_immutable BEFORE INSERT OR UPDATE OR DELETE ON campus_event_attendance_revisions_legacy_source
  FOR EACH ROW EXECUTE FUNCTION prevent_attendance_observation_mutation();
CREATE TRIGGER participation_archived_source_immutable BEFORE INSERT OR UPDATE OR DELETE ON assessment_candidate_attendance_legacy_source
  FOR EACH ROW EXECUTE FUNCTION prevent_attendance_observation_mutation();
COMMENT ON TABLE attendance_records_legacy_source IS 'Attendance-owned immutable original daily evidence; source identity, times and native foreign keys retained. Current decisions are canonical participation records. Referenced history has no automatic expiry.';
COMMENT ON TABLE campus_event_attendance_records_legacy_source IS 'Attendance-owned immutable original event evidence, not a current writer. Owning event eligibility and native source relationships retained. No automatic expiry.';
COMMENT ON TABLE assessment_candidate_attendance_legacy_source IS 'Attendance-owned immutable original exam evidence, not a current writer. Owning candidate chain and native source relationships retained. No automatic expiry.';
DO $permissions$ DECLARE role_name text; relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['activity_attendance_source_contexts','activity_attendance_academic_roster','activity_attendance_context_receipts'] LOOP
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',relation_name);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON %I FROM %I',relation_name,role_name);
      END IF;
    END LOOP;
  END LOOP;
END $permissions$;
REVOKE ALL ON FUNCTION validate_participation_academic_roster(),protect_participation_context_receipt() FROM PUBLIC;
