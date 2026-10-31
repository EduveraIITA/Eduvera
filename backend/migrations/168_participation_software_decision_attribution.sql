-- A configured software decision is never attributed to the human who reported
-- the evidence or approved the rule. Legacy unknown attribution stays unknown.
ALTER TABLE activity_attendance_entries ADD COLUMN recorded_by_agent_id uuid,
  ADD CONSTRAINT participation_entry_software_actor_scope FOREIGN KEY(recorded_by_agent_id,school_id)
    REFERENCES campus_model_agents(id,school_id);
ALTER TABLE activity_attendance_entries DROP CONSTRAINT participation_signer_or_legacy_source;
ALTER TABLE activity_attendance_entries ADD CONSTRAINT participation_decision_actor CHECK(
  num_nonnulls(recorded_by,recorded_by_agent_id)=1 OR
  (num_nonnulls(recorded_by,recorded_by_agent_id)=0 AND legacy_source_ref IS NOT NULL));

ALTER TABLE activity_attendance_entry_revisions ALTER COLUMN changed_by DROP NOT NULL;
ALTER TABLE activity_attendance_entry_revisions ADD COLUMN changed_by_agent_id uuid,
  ADD CONSTRAINT participation_revision_software_actor_scope FOREIGN KEY(changed_by_agent_id,school_id)
    REFERENCES campus_model_agents(id,school_id),
  ADD CONSTRAINT participation_revision_actor CHECK(num_nonnulls(changed_by,changed_by_agent_id)=1 OR
    (num_nonnulls(changed_by,changed_by_agent_id)=0 AND legacy_source_ref IS NOT NULL));

ALTER TABLE activity_attendance_commands ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE activity_attendance_commands ADD COLUMN actor_agent_id uuid,
  ADD COLUMN model_command_id uuid REFERENCES campus_model_commands(id),
  ADD CONSTRAINT participation_command_software_actor_scope FOREIGN KEY(actor_agent_id,school_id)
    REFERENCES campus_model_agents(id,school_id),
  ADD CONSTRAINT participation_command_actor CHECK(num_nonnulls(actor_id,actor_agent_id)=1
    AND (actor_agent_id IS NULL OR model_command_id IS NOT NULL));
ALTER TABLE activity_attendance_commands DROP CONSTRAINT activity_attendance_commands_operation_check;
ALTER TABLE activity_attendance_commands ADD CONSTRAINT activity_attendance_commands_operation_check CHECK(operation IN
  ('marks','submit','finalize','reopen','evidence','evidence_review','automatic_finalize','self_report','automatic_evidence'));
CREATE UNIQUE INDEX participation_software_command_retry ON activity_attendance_commands(school_id,actor_agent_id,idempotency_key)
  WHERE actor_agent_id IS NOT NULL;
CREATE INDEX participation_software_command_model ON activity_attendance_commands(model_command_id) WHERE model_command_id IS NOT NULL;

ALTER TABLE activity_attendance_evidence ADD COLUMN decided_by_agent_id uuid,
  ADD COLUMN source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT participation_evidence_software_actor_scope FOREIGN KEY(decided_by_agent_id,school_id)
    REFERENCES campus_model_agents(id,school_id);
ALTER TABLE activity_attendance_evidence DROP CONSTRAINT participation_evidence_decision_attribution;
ALTER TABLE activity_attendance_evidence ADD CONSTRAINT participation_evidence_decision_attribution CHECK(
  (decided_at IS NULL AND num_nonnulls(decided_by,decided_by_agent_id)=0)
  OR (decided_at IS NOT NULL AND num_nonnulls(decided_by,decided_by_agent_id)=1)
  OR (legacy_source_ref IS NOT NULL AND num_nonnulls(decided_by,decided_by_agent_id)=0));
CREATE UNIQUE INDEX participation_own_report_source ON activity_attendance_evidence(school_id,register_id,person_id,capture_channel,source_reference)
  WHERE capture_channel='self_check_in' AND legacy_source_ref IS NULL;
