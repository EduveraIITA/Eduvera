-- Register the new explicit purpose everywhere the existing access catalogue
-- validates it. This permits reviewed institution exceptions; it grants none.
ALTER TABLE school_access_exceptions DROP CONSTRAINT school_access_exceptions_permission_check;
ALTER TABLE school_access_exceptions ADD CONSTRAINT school_access_exceptions_permission_check CHECK(permission=ANY(ARRAY[
  'members.invite','sis.manage','fees.manage','resources.manage','attendance.view','attendance.record','photo.use',
  'timetable.view','dayplans.respond','followups.manage','messages.view','messages.send','groups.create',
  'safeguarding.review','events.view','events.manage','events.attendance','assessments.view',
  'assessments.mark','assessments.moderate','reports.comment','departure.manage','departure.collect','ai.use'
]::text[]));
ALTER TABLE school_access_exceptions ADD CONSTRAINT resource_access_exception_institution_scope
  CHECK(permission<>'resources.manage' OR scope_kind='institution');

-- Keep participant roles a native custody floor as well as a service check.
-- A borrower may add information; only the custodian can settle the question
-- or record a physical receipt.220 still binds each row to exact accepted Core
-- command/outcome/journal evidence at commit.
CREATE FUNCTION guard_resource_loan_receipt_participant() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE borrower uuid;custodian uuid;
BEGIN
  SELECT borrower_person_id,custodian_person_id INTO borrower,custodian
    FROM resource_loans WHERE id=NEW.loan_id AND school_id=NEW.school_id;
  IF (NEW.action='question_asked' AND NEW.actor_person_id IS DISTINCT FROM borrower)
    OR (NEW.action='replied' AND NEW.actor_person_id IS DISTINCT FROM borrower AND NEW.actor_person_id IS DISTINCT FROM custodian)
    OR (NEW.action NOT IN('question_asked','replied') AND NEW.actor_person_id IS DISTINCT FROM custodian)
  THEN RAISE EXCEPTION 'A borrowing receipt requires its exact current participant role' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_loan_receipt_participant_guard BEFORE INSERT ON resource_loan_receipts
  FOR EACH ROW EXECUTE FUNCTION guard_resource_loan_receipt_participant();
REVOKE ALL ON FUNCTION guard_resource_loan_receipt_participant() FROM PUBLIC;

-- Lists and the no-reopen-after-reissue check follow recorded custody order,
-- including two physical issues reported at the same selected clock instant.
DROP INDEX resource_loans_holding_idx;
CREATE INDEX resource_loans_holding_idx ON resource_loans(school_id,holding_id,issue_order DESC);
CREATE INDEX resource_loans_recorded_order_idx ON resource_loans(school_id,issue_order DESC);
