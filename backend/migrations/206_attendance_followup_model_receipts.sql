-- Keep the owning-domain retry result and its exact Core handoff together.
-- Historical commands remain explicitly unlinked; this does not fabricate traces.
ALTER TABLE coordination_commands ADD COLUMN model_receipt jsonb;
ALTER TABLE coordination_commands ADD CONSTRAINT coordination_command_model_receipt_object
  CHECK (model_receipt IS NULL OR jsonb_typeof(model_receipt)='object');
CREATE INDEX coordination_commands_revision_idx ON coordination_commands(followup_id,result_revision DESC);
