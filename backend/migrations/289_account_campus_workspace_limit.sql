ALTER TABLE progressive_onboarding_workspaces
  ADD COLUMN provisioned_account_slot smallint NOT NULL DEFAULT 1
    CHECK (provisioned_account_slot BETWEEN 1 AND 10),
  ADD COLUMN provision_request_id uuid,
  ADD COLUMN provision_request_name varchar(180),
  ADD CHECK ((provision_request_id IS NULL) = (provision_request_name IS NULL)),
  ADD CHECK (provision_request_id IS NULL OR provisioned_for_account_id IS NOT NULL),
  DROP CONSTRAINT progressive_onboarding_workspace_provisioned_for_account_id_key,
  ADD UNIQUE (provisioned_for_account_id, provisioned_account_slot),
  ADD UNIQUE (provisioned_for_account_id, provision_request_id);
