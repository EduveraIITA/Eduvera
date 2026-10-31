-- Accepted academic decisions converge on the participation writer. Retain the
-- original rows and FK identities as immutable sources, never dual-write marks.
-- Register/context identities remain tables because scheduling and artifacts
-- refer to them; their lifecycle becomes a checked projection of the kernel.
CREATE TABLE activity_attendance_legacy_command_results (
  command_id uuid PRIMARY KEY REFERENCES activity_attendance_commands(id),
  school_id uuid NOT NULL REFERENCES schools(id),
  source_kind varchar(24) NOT NULL CHECK(source_kind IN ('daily_class','scheduled_session','event','examination')),
  source_id text NOT NULL,
  legacy_request_hash char(64) NOT NULL,
  result_body jsonb NOT NULL,
  records_count integer NOT NULL CHECK(records_count>0),
  changed_count integer NOT NULL CHECK(changed_count>=0 AND changed_count<=records_count),
  capture_source varchar(32) NOT NULL DEFAULT 'live_app',
  source_photo_session_id uuid,
  observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX participation_legacy_command_source ON activity_attendance_legacy_command_results(school_id,source_kind,source_id,created_at);
CREATE TRIGGER participation_legacy_results_immutable BEFORE UPDATE OR DELETE ON activity_attendance_legacy_command_results
  FOR EACH ROW EXECUTE FUNCTION prevent_attendance_observation_mutation();
ALTER TABLE activity_attendance_legacy_command_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON activity_attendance_legacy_command_results FROM PUBLIC;

ALTER TABLE activity_attendance_evidence
  ADD COLUMN legacy_source_ref text,
  ADD COLUMN legacy_snapshot jsonb,
  ALTER COLUMN submitted_by DROP NOT NULL;
ALTER TABLE activity_attendance_evidence DROP CONSTRAINT activity_attendance_evidence_check;
ALTER TABLE activity_attendance_evidence ADD CONSTRAINT participation_evidence_decision_attribution CHECK(
  (legacy_source_ref IS NOT NULL AND legacy_snapshot IS NOT NULL)
  OR ((decided_by IS NULL)=(decided_at IS NULL))
);
ALTER TABLE activity_attendance_evidence ADD CONSTRAINT participation_evidence_source_attribution CHECK(
  submitted_by IS NOT NULL OR (legacy_source_ref IS NOT NULL AND legacy_snapshot IS NOT NULL)
);
CREATE UNIQUE INDEX participation_evidence_legacy_source ON activity_attendance_evidence(school_id,legacy_source_ref)
  WHERE legacy_source_ref IS NOT NULL;
ALTER TABLE activity_attendance_audits
  ADD COLUMN legacy_source_ref text,
  ALTER COLUMN request_id DROP NOT NULL;
ALTER TABLE activity_attendance_audits ADD CONSTRAINT participation_audit_request_attribution CHECK(request_id IS NOT NULL OR legacy_source_ref IS NOT NULL);
CREATE UNIQUE INDEX participation_audit_legacy_source ON activity_attendance_audits(school_id,legacy_source_ref)
  WHERE legacy_source_ref IS NOT NULL;
CREATE UNIQUE INDEX attendance_followups_one_source_identity ON attendance_followups(school_id,COALESCE(participation_entry_id,attendance_record_id))
  WHERE state<>'resolved';

ALTER TABLE attendance_records RENAME TO attendance_records_legacy_source;
ALTER TABLE attendance_submissions RENAME TO attendance_submissions_legacy_source;
ALTER TABLE attendance_record_revisions RENAME TO attendance_record_revisions_legacy_source;
ALTER TABLE attendance_session_entries RENAME TO attendance_session_entries_legacy_source;
ALTER TABLE attendance_session_submissions RENAME TO attendance_session_submissions_legacy_source;
ALTER TABLE attendance_session_entry_revisions RENAME TO attendance_session_entry_revisions_legacy_source;
ALTER TABLE attendance_session_evidence RENAME TO attendance_session_evidence_legacy_source;

CREATE VIEW attendance_records AS
SELECT original.* FROM attendance_records_legacy_source original
WHERE NOT EXISTS(SELECT 1 FROM activity_attendance_legacy_links link WHERE link.state='active' AND link.source_kind='daily_class'
  AND link.context_snapshot->'context'->>'class_id'=original.class_section_id::text
  AND link.context_snapshot->'context'->>'date'=original.date::text)
UNION ALL
SELECT entry.id,person.student_id,(link.context_snapshot->'context'->>'class_id')::uuid,
  (link.context_snapshot->'context'->>'date')::date,entry.status,original.check_in_at,original.check_out_at,
  entry.remarks,entry.recorded_by,entry.created_at,entry.updated_at,entry.revision,
  COALESCE((SELECT revision.request_id FROM activity_attendance_entry_revisions revision WHERE revision.entry_id=entry.id
    ORDER BY revision.register_revision DESC,revision.created_at DESC,revision.id DESC LIMIT 1),original.source_request_id)
FROM activity_attendance_entries entry
JOIN activity_attendance_legacy_links link ON link.register_id=entry.register_id AND link.school_id=entry.school_id
  AND link.state='active' AND link.source_kind='daily_class'
JOIN activity_attendance_legacy_people person ON person.register_id=entry.register_id AND person.person_id=entry.person_id
LEFT JOIN attendance_records_legacy_source original ON original.id=entry.id
WHERE entry.status IS NOT NULL;

CREATE VIEW attendance_session_entries AS
SELECT original.* FROM attendance_session_entries_legacy_source original
WHERE NOT EXISTS(SELECT 1 FROM activity_attendance_legacy_links link WHERE link.state='active'
  AND link.source_kind='scheduled_session' AND link.source_id=original.session_id::text AND link.school_id=original.school_id)
UNION ALL
SELECT entry.id,entry.school_id,link.source_id::uuid,person.student_id,entry.status,entry.remarks,
  CASE entry.capture_channel WHEN 'human_roll_call' THEN 'staff_roll_call' WHEN 'self_check_in' THEN 'student_qr'
    WHEN 'registered_device' THEN 'biometric_device' WHEN 'legacy_import' THEN original.capture_channel ELSE entry.capture_channel END,
  entry.observed_at,entry.recorded_by,entry.revision,entry.created_at,entry.updated_at
FROM activity_attendance_entries entry
JOIN activity_attendance_legacy_links link ON link.register_id=entry.register_id AND link.school_id=entry.school_id
  AND link.state='active' AND link.source_kind='scheduled_session'
JOIN activity_attendance_legacy_people person ON person.register_id=entry.register_id AND person.person_id=entry.person_id
LEFT JOIN attendance_session_entries_legacy_source original ON original.id=entry.id
WHERE entry.status IS NOT NULL;

CREATE VIEW attendance_submissions AS
SELECT original.* FROM attendance_submissions_legacy_source original
UNION ALL
SELECT command.id,command.school_id,(link.context_snapshot->'context'->>'class_id')::uuid,
  (link.context_snapshot->'context'->>'term_id')::uuid,(link.context_snapshot->'context'->>'date')::date,
  command.actor_id,command.idempotency_key,compat.legacy_request_hash,command.request_id,command.register_revision,
  compat.records_count,compat.changed_count,200,compat.result_body,command.created_at,command.created_at,
  compat.source_photo_session_id,NULL::uuid,compat.capture_source,compat.observed_at
FROM activity_attendance_legacy_command_results compat JOIN activity_attendance_commands command ON command.id=compat.command_id
JOIN activity_attendance_legacy_links link ON link.register_id=command.register_id AND link.school_id=command.school_id
WHERE compat.source_kind='daily_class';

CREATE VIEW attendance_session_submissions AS
SELECT original.* FROM attendance_session_submissions_legacy_source original
UNION ALL
SELECT command.id,command.school_id,link.source_id::uuid,command.actor_id,command.idempotency_key,compat.legacy_request_hash,
  command.request_id,command.register_revision,compat.records_count,compat.changed_count,compat.result_body,command.created_at,
  compat.capture_source,compat.source_photo_session_id
FROM activity_attendance_legacy_command_results compat JOIN activity_attendance_commands command ON command.id=compat.command_id
JOIN activity_attendance_legacy_links link ON link.register_id=command.register_id AND link.school_id=command.school_id
WHERE compat.source_kind='scheduled_session';

CREATE VIEW attendance_record_revisions AS
SELECT original.* FROM attendance_record_revisions_legacy_source original
UNION ALL
SELECT -revision.id,revision.entry_id,command.id,(link.context_snapshot->'context'->>'legacy_register_id')::uuid,
  revision.school_id,person.student_id,(link.context_snapshot->'context'->>'class_id')::uuid,
  (link.context_snapshot->'context'->>'date')::date,revision.previous_status,revision.new_status,
  revision.previous_remarks,revision.new_remarks,original.check_in_at,original.check_in_at,original.check_out_at,original.check_out_at,
  revision.reason,revision.changed_by,revision.request_id,revision.register_revision,revision.created_at
FROM activity_attendance_entry_revisions revision
JOIN activity_attendance_legacy_links link ON link.register_id=revision.register_id AND link.school_id=revision.school_id
  AND link.state='active' AND link.source_kind='daily_class'
JOIN activity_attendance_legacy_people person ON person.register_id=revision.register_id AND person.person_id=revision.person_id
LEFT JOIN activity_attendance_commands command ON command.register_id=revision.register_id AND command.register_revision=revision.register_revision
LEFT JOIN attendance_records_legacy_source original ON original.id=revision.entry_id
WHERE revision.legacy_source_ref IS NULL;

CREATE VIEW attendance_session_entry_revisions AS
SELECT original.* FROM attendance_session_entry_revisions_legacy_source original
UNION ALL
SELECT -revision.id,revision.school_id,link.source_id::uuid,revision.entry_id,command.id,person.student_id,
  revision.previous_status,revision.new_status,revision.previous_remarks,revision.new_remarks,
  CASE revision.capture_channel WHEN 'human_roll_call' THEN 'staff_roll_call' WHEN 'self_check_in' THEN 'student_qr'
    WHEN 'registered_device' THEN 'biometric_device' ELSE revision.capture_channel END,
  revision.reason,revision.changed_by,revision.request_id,revision.register_revision,revision.created_at
FROM activity_attendance_entry_revisions revision
JOIN activity_attendance_legacy_links link ON link.register_id=revision.register_id AND link.school_id=revision.school_id
  AND link.state='active' AND link.source_kind='scheduled_session'
JOIN activity_attendance_legacy_people person ON person.register_id=revision.register_id AND person.person_id=revision.person_id
LEFT JOIN activity_attendance_commands command ON command.register_id=revision.register_id AND command.register_revision=revision.register_revision
WHERE revision.legacy_source_ref IS NULL;

CREATE VIEW attendance_session_evidence AS
SELECT original.* FROM attendance_session_evidence_legacy_source original
WHERE NOT EXISTS(SELECT 1 FROM activity_attendance_legacy_links link WHERE link.state='active'
  AND link.source_kind='scheduled_session' AND link.source_id=original.session_id::text AND link.school_id=original.school_id)
UNION ALL
SELECT evidence.id,evidence.school_id,link.source_id::uuid,person.student_id,
  CASE evidence.capture_channel WHEN 'self_check_in' THEN 'student_qr' WHEN 'registered_device' THEN 'biometric_device'
    ELSE evidence.capture_channel END,evidence.state,evidence.observed_at,evidence.submitted_by,evidence.source_reference,
  COALESCE(evidence.legacy_snapshot->'metadata','{}'::jsonb),evidence.decided_by,evidence.decided_at,COALESCE(evidence.decision_note,''),
  evidence.created_at,COALESCE(evidence.decided_at,evidence.received_at)
FROM activity_attendance_evidence evidence
JOIN activity_attendance_legacy_links link ON link.register_id=evidence.register_id AND link.school_id=evidence.school_id
  AND link.state='active' AND link.source_kind='scheduled_session'
JOIN activity_attendance_legacy_people person ON person.register_id=evidence.register_id AND person.person_id=evidence.person_id;

-- A retained academic context is not an independent lifecycle authority. Even
-- direct maintenance SQL cannot advance it beyond its accepted common state.
ALTER TABLE attendance_registers DROP CONSTRAINT attendance_registers_check1;
ALTER TABLE attendance_registers ADD CONSTRAINT attendance_projection_lock_attribution CHECK(
  (locked_at IS NULL AND locked_by IS NULL) OR (locked_at IS NOT NULL AND (locked_by IS NOT NULL OR finalization_source='automatic'))
);
CREATE FUNCTION validate_academic_participation_projection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE common_record activity_attendance_registers%ROWTYPE;
BEGIN
  SELECT register.* INTO common_record FROM activity_attendance_legacy_links link
  JOIN activity_attendance_registers register ON register.id=link.register_id AND register.school_id=link.school_id
  WHERE link.school_id=NEW.school_id AND link.state='active'
    AND ((TG_TABLE_NAME='attendance_registers' AND link.source_kind='daily_class'
      AND link.context_snapshot->'context'->>'legacy_register_id'=NEW.id::text)
      OR (TG_TABLE_NAME='attendance_session_registers' AND link.source_kind='scheduled_session' AND link.source_id=NEW.id::text));
  IF FOUND AND (NEW.state,NEW.revision,NEW.submitted_by,NEW.submitted_at,NEW.locked_by,NEW.locked_at,
      NEW.reopened_by,NEW.reopened_at,NEW.reopen_reason,NEW.auto_finalize_at,NEW.finalization_source)
    IS DISTINCT FROM (common_record.state,common_record.revision,common_record.submitted_by,common_record.submitted_at,
      common_record.locked_by,common_record.locked_at,common_record.reopened_by,common_record.reopened_at,
      common_record.reopen_reason,common_record.auto_finalize_at,common_record.finalization_source) THEN
    RAISE EXCEPTION 'Academic lifecycle is a read projection of accepted participation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attendance_common_lifecycle_projection BEFORE UPDATE ON attendance_registers
  FOR EACH ROW EXECUTE FUNCTION validate_academic_participation_projection();
CREATE TRIGGER session_common_lifecycle_projection BEFORE UPDATE ON attendance_session_registers
  FOR EACH ROW EXECUTE FUNCTION validate_academic_participation_projection();

DO $$ DECLARE source_table text; database_role text;
BEGIN
  FOREACH source_table IN ARRAY ARRAY['attendance_records_legacy_source','attendance_submissions_legacy_source',
    'attendance_record_revisions_legacy_source','attendance_session_entries_legacy_source','attendance_session_submissions_legacy_source',
    'attendance_session_entry_revisions_legacy_source','attendance_session_evidence_legacy_source'] LOOP
    EXECUTE format('CREATE TRIGGER participation_archived_source_immutable BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION prevent_attendance_observation_mutation()',source_table);
  END LOOP;
  FOREACH database_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=database_role) THEN
      EXECUTE format('REVOKE ALL ON activity_attendance_legacy_command_results,attendance_records,attendance_submissions,attendance_record_revisions,attendance_session_entries,attendance_session_submissions,attendance_session_entry_revisions,attendance_session_evidence FROM %I',database_role);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON attendance_records,attendance_submissions,attendance_record_revisions,attendance_session_entries,
  attendance_session_submissions,attendance_session_entry_revisions,attendance_session_evidence FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_academic_participation_projection() FROM PUBLIC;
