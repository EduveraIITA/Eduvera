-- Keep retained signer references efficient for account-reference checks.
CREATE INDEX facilities_rule_actor_user_idx ON facilities_intake_rules(created_by_user_id);
CREATE INDEX facilities_receipt_actor_user_idx ON facilities_repair_receipts(actor_user_id);
