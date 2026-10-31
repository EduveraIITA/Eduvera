-- Keep restrictive account references cheap to inspect during controlled
-- account retention work; immutable custody evidence is never cascade-deleted.
CREATE INDEX resource_loans_issued_by_idx ON resource_loans(issued_by_user_id);
CREATE INDEX resource_loan_receipts_actor_user_idx ON resource_loan_receipts(actor_user_id);
