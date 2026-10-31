-- Bounded physical custody of existing exact campus resources, not an inventory ERP.
ALTER TABLE campus_resource_holdings ADD CONSTRAINT campus_resource_holdings_id_school_unique UNIQUE(id,school_id);

CREATE TABLE resource_loans (
 id uuid PRIMARY KEY,issue_order bigint GENERATED ALWAYS AS IDENTITY,school_id uuid NOT NULL REFERENCES schools(id), holding_id uuid NOT NULL,
 borrower_person_id uuid NOT NULL,custodian_person_id uuid NOT NULL,issued_by_user_id uuid NOT NULL REFERENCES users(id),
 item_name varchar(160) NOT NULL,asset_tag varchar(80) NOT NULL,issued_at timestamptz NOT NULL,due_at timestamptz NOT NULL,
 custody_purpose varchar(500) NOT NULL CHECK(length(trim(custody_purpose))>=5),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL,UNIQUE(id,school_id),CHECK(due_at>issued_at),
 FOREIGN KEY(holding_id,school_id) REFERENCES campus_resource_holdings(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(borrower_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(custodian_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT
);
CREATE INDEX resource_loans_holding_idx ON resource_loans(school_id,holding_id,issued_at DESC,id);
CREATE INDEX resource_loans_borrower_idx ON resource_loans(school_id,borrower_person_id,due_at,id);
CREATE INDEX resource_loans_custodian_idx ON resource_loans(school_id,custodian_person_id,due_at,id);

CREATE TABLE resource_loan_parts (
 id uuid PRIMARY KEY,school_id uuid NOT NULL,loan_id uuid NOT NULL,kind varchar(12) NOT NULL CHECK(kind IN('item','component')),
 label varchar(160) NOT NULL CHECK(length(trim(label))>0),quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 100),
 UNIQUE(id,school_id,loan_id),FOREIGN KEY(loan_id,school_id) REFERENCES resource_loans(id,school_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX resource_loan_one_main_part_idx ON resource_loan_parts(loan_id) WHERE kind='item';
CREATE INDEX resource_loan_parts_loan_idx ON resource_loan_parts(school_id,loan_id,id);

CREATE TABLE resource_loan_questions (
 id uuid PRIMARY KEY,school_id uuid NOT NULL,loan_id uuid NOT NULL,reporter_person_id uuid NOT NULL,
 kind varchar(20) NOT NULL CHECK(kind IN('question','returned_claim')),note varchar(2000) NOT NULL CHECK(length(trim(note))>=3),
 state varchar(12) NOT NULL DEFAULT'open' CHECK(state IN('open','resolved')),revision integer NOT NULL CHECK(revision>0),
 created_at timestamptz NOT NULL,resolved_at timestamptz,claimed_return_at timestamptz,
 coordination_receipt jsonb NOT NULL DEFAULT'{}',
 UNIQUE(id,school_id,loan_id),FOREIGN KEY(loan_id,school_id) REFERENCES resource_loans(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(reporter_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 CHECK((state='open')=(resolved_at IS NULL)),CHECK((kind='returned_claim')=(claimed_return_at IS NOT NULL)),CHECK(claimed_return_at IS NULL OR claimed_return_at<=created_at)
);
CREATE UNIQUE INDEX resource_loan_question_open_idx ON resource_loan_questions(school_id,loan_id,reporter_person_id) WHERE state='open';
CREATE INDEX resource_loan_questions_work_idx ON resource_loan_questions(school_id,state,created_at,id);

CREATE TABLE resource_loan_receipts (
 id uuid PRIMARY KEY,school_id uuid NOT NULL,loan_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),command_id uuid NOT NULL,
 action varchar(24) NOT NULL CHECK(action IN('issued','return_recorded','return_corrected','due_changed','question_asked','replied','resolved')),
 actor_person_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES users(id),observed_at timestamptz,recorded_at timestamptz NOT NULL,
 reason varchar(1000) NOT NULL DEFAULT'',note varchar(2000) NOT NULL DEFAULT'',due_at timestamptz,previous_due_at timestamptz,
 supersedes_receipt_id uuid,question_id uuid,
 UNIQUE(id,school_id,loan_id),UNIQUE(school_id,loan_id,revision),UNIQUE(school_id,command_id),
 FOREIGN KEY(loan_id,school_id) REFERENCES resource_loans(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(actor_person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(supersedes_receipt_id,school_id,loan_id) REFERENCES resource_loan_receipts(id,school_id,loan_id) ON DELETE RESTRICT,
 FOREIGN KEY(question_id,school_id,loan_id) REFERENCES resource_loan_questions(id,school_id,loan_id) ON DELETE RESTRICT,
 CHECK((action IN('issued','return_recorded','return_corrected'))=(observed_at IS NOT NULL)),
 CHECK(observed_at IS NULL OR observed_at<=recorded_at),
 CHECK((action='due_changed')=(due_at IS NOT NULL AND previous_due_at IS NOT NULL)),
 CHECK(action NOT IN('return_corrected','due_changed') OR length(trim(reason))>=3),
 CHECK(supersedes_receipt_id IS NULL OR action='return_corrected' AND supersedes_receipt_id<>id),
 CHECK((action IN('question_asked','replied','resolved'))=(question_id IS NOT NULL)),
 CHECK(action NOT IN('question_asked','replied','resolved') OR length(trim(note))>=3)
);
CREATE UNIQUE INDEX resource_loan_receipt_supersession_idx ON resource_loan_receipts(school_id,supersedes_receipt_id) WHERE supersedes_receipt_id IS NOT NULL;
CREATE INDEX resource_loan_receipts_history_idx ON resource_loan_receipts(school_id,loan_id,revision DESC);
CREATE INDEX resource_loan_receipts_actor_idx ON resource_loan_receipts(school_id,actor_person_id);
CREATE INDEX resource_loan_receipts_question_idx ON resource_loan_receipts(school_id,question_id) WHERE question_id IS NOT NULL;

CREATE TABLE resource_loan_receipt_parts (
 school_id uuid NOT NULL,loan_id uuid NOT NULL,receipt_id uuid NOT NULL,part_id uuid NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 100),condition varchar(12) NOT NULL CHECK(condition IN('usable','damaged','held')),
 PRIMARY KEY(receipt_id,part_id),FOREIGN KEY(receipt_id,school_id,loan_id) REFERENCES resource_loan_receipts(id,school_id,loan_id) ON DELETE RESTRICT,
 FOREIGN KEY(part_id,school_id,loan_id) REFERENCES resource_loan_parts(id,school_id,loan_id) ON DELETE RESTRICT
);
CREATE INDEX resource_loan_receipt_parts_part_idx ON resource_loan_receipt_parts(school_id,loan_id,part_id);

CREATE VIEW resource_loan_balances AS
 SELECT part.id,part.school_id,part.loan_id,part.kind,part.label,part.quantity,
  coalesce(sum(received.quantity),0)::int AS returned_quantity,
  (part.quantity-coalesce(sum(received.quantity),0))::int AS outstanding_quantity,
  CASE WHEN coalesce(bool_or(received.condition='damaged'),false) THEN 'damaged'
   WHEN coalesce(bool_or(received.condition='held'),false) THEN 'held' ELSE 'usable' END AS condition
 FROM resource_loan_parts part LEFT JOIN (
  SELECT item.* FROM resource_loan_receipt_parts item JOIN resource_loan_receipts receipt ON receipt.id=item.receipt_id
  WHERE NOT EXISTS(SELECT 1 FROM resource_loan_receipts replacement WHERE replacement.school_id=receipt.school_id AND replacement.supersedes_receipt_id=receipt.id)
 ) received ON received.part_id=part.id AND received.school_id=part.school_id AND received.loan_id=part.loan_id
 GROUP BY part.id,part.school_id,part.loan_id,part.kind,part.label,part.quantity;
CREATE VIEW resource_loan_status AS
 SELECT loan.id,loan.school_id,coalesce(sum(part.outstanding_quantity),0)::int AS outstanding_count,
  coalesce(bool_or(part.condition<>'usable'),false) AS held
 FROM resource_loans loan LEFT JOIN resource_loan_balances part ON part.loan_id=loan.id AND part.school_id=loan.school_id
 GROUP BY loan.id,loan.school_id;

CREATE FUNCTION protect_resource_loan_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Resource custody evidence is append-only; record a correction.' USING ERRCODE='23514';END $$;
CREATE TRIGGER resource_loan_parts_immutable BEFORE UPDATE OR DELETE ON resource_loan_parts FOR EACH ROW EXECUTE FUNCTION protect_resource_loan_history();
CREATE TRIGGER resource_loan_receipts_immutable BEFORE UPDATE OR DELETE ON resource_loan_receipts FOR EACH ROW EXECUTE FUNCTION protect_resource_loan_history();
CREATE TRIGGER resource_loan_receipt_parts_immutable BEFORE UPDATE OR DELETE ON resource_loan_receipt_parts FOR EACH ROW EXECUTE FUNCTION protect_resource_loan_history();
CREATE FUNCTION guard_resource_loan_part_creation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM resource_loan_receipts WHERE school_id=NEW.school_id AND loan_id=NEW.loan_id AND action='issued')
 THEN RAISE EXCEPTION 'Issued kit components are fixed by its original issue' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER resource_loan_part_creation_guard BEFORE INSERT ON resource_loan_parts FOR EACH ROW EXECUTE FUNCTION guard_resource_loan_part_creation();
CREATE FUNCTION guard_resource_loan_current() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Issued loans retain their custody history' USING ERRCODE='23514';END IF;
 IF (to_jsonb(NEW)-'revision'-'due_at') IS DISTINCT FROM (to_jsonb(OLD)-'revision'-'due_at') OR NEW.revision<>OLD.revision+1
 THEN RAISE EXCEPTION 'Only the reviewed loan revision and due date may change' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER resource_loan_current_guard BEFORE UPDATE OR DELETE ON resource_loans FOR EACH ROW EXECUTE FUNCTION guard_resource_loan_current();
CREATE FUNCTION guard_resource_loan_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original resource_loan_receipts;issue_time timestamptz;
BEGIN
 SELECT issued_at INTO issue_time FROM resource_loans WHERE id=NEW.loan_id AND school_id=NEW.school_id;
 IF NEW.observed_at<issue_time THEN RAISE EXCEPTION 'Physical return cannot precede issue' USING ERRCODE='23514';END IF;
 IF NEW.supersedes_receipt_id IS NOT NULL THEN
  SELECT * INTO original FROM resource_loan_receipts WHERE id=NEW.supersedes_receipt_id AND loan_id=NEW.loan_id AND school_id=NEW.school_id;
  IF NOT FOUND OR original.action NOT IN('return_recorded','return_corrected') THEN RAISE EXCEPTION 'Only an exact return receipt can be corrected' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER resource_loan_receipt_guard BEFORE INSERT ON resource_loan_receipts FOR EACH ROW EXECUTE FUNCTION guard_resource_loan_receipt();
CREATE FUNCTION guard_resource_loan_return_part() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NOT EXISTS(SELECT 1 FROM resource_loan_receipts WHERE id=NEW.receipt_id AND school_id=NEW.school_id AND loan_id=NEW.loan_id AND action IN('return_recorded','return_corrected'))
 THEN RAISE EXCEPTION 'Received component quantities require an exact return receipt' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER resource_loan_return_part_guard BEFORE INSERT ON resource_loan_receipt_parts FOR EACH ROW EXECUTE FUNCTION guard_resource_loan_return_part();
CREATE FUNCTION guard_resource_loan_received_quantity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF EXISTS(SELECT 1 FROM resource_loan_balances WHERE id=NEW.part_id AND school_id=NEW.school_id AND outstanding_quantity<0)
 THEN RAISE EXCEPTION 'Returned quantity cannot exceed the issued component quantity' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE CONSTRAINT TRIGGER resource_loan_received_quantity_guard AFTER INSERT ON resource_loan_receipt_parts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_resource_loan_received_quantity();
CREATE FUNCTION guard_loaned_resource_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF EXISTS(SELECT 1 FROM resource_loans WHERE school_id=OLD.school_id AND holding_id=OLD.id)
 AND (NEW.id,NEW.school_id,NEW.resource_type_id,NEW.quantity,NEW.asset_tag) IS DISTINCT FROM (OLD.id,OLD.school_id,OLD.resource_type_id,OLD.quantity,OLD.asset_tag)
 THEN RAISE EXCEPTION 'Issued resource identity, tracking type and quantity retain their loan history' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER campus_resource_loan_identity_guard BEFORE UPDATE ON campus_resource_holdings FOR EACH ROW EXECUTE FUNCTION guard_loaned_resource_identity();
CREATE FUNCTION guard_loaned_resource_type() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.tracking_mode IS DISTINCT FROM OLD.tracking_mode AND EXISTS(SELECT 1 FROM campus_resource_holdings holding JOIN resource_loans loan ON loan.school_id=holding.school_id AND loan.holding_id=holding.id WHERE holding.resource_type_id=OLD.id AND holding.school_id=OLD.school_id)
 THEN RAISE EXCEPTION 'Loan history preserves the original exact resource tracking mode' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER campus_resource_loan_type_guard BEFORE UPDATE ON campus_resource_types FOR EACH ROW EXECUTE FUNCTION guard_loaned_resource_type();

CREATE FUNCTION guard_resource_loan_question() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Borrowing questions retain their private history' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.claimed_return_at<(SELECT issued_at FROM resource_loans WHERE id=NEW.loan_id AND school_id=NEW.school_id)
  THEN RAISE EXCEPTION 'A reported return claim cannot precede physical issue' USING ERRCODE='23514';END IF;
 ELSE
  IF (to_jsonb(NEW)-'state'-'resolved_at'-'coordination_receipt') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'resolved_at'-'coordination_receipt')
   OR OLD.state='resolved' OR NEW.coordination_receipt IS DISTINCT FROM OLD.coordination_receipt AND OLD.coordination_receipt<>'{}'::jsonb
  THEN RAISE EXCEPTION 'Question facts and retained delivery cannot be rewritten' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER resource_loan_question_guard BEFORE INSERT OR UPDATE OR DELETE ON resource_loan_questions FOR EACH ROW EXECUTE FUNCTION guard_resource_loan_question();
CREATE FUNCTION guard_resource_loan_question_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_question resource_loan_questions;
BEGIN
 SELECT * INTO current_question FROM resource_loan_questions WHERE id=NEW.id AND school_id=NEW.school_id AND loan_id=NEW.loan_id;
 IF NOT EXISTS(SELECT 1 FROM resource_loan_receipts receipt JOIN resource_loans loan ON loan.id=receipt.loan_id AND loan.school_id=receipt.school_id
  WHERE receipt.school_id=NEW.school_id AND receipt.loan_id=NEW.loan_id AND receipt.question_id=NEW.id AND receipt.action='question_asked'
   AND receipt.revision=NEW.revision AND receipt.actor_person_id=NEW.reporter_person_id AND loan.borrower_person_id=NEW.reporter_person_id
   AND receipt.note=NEW.note AND receipt.recorded_at=NEW.created_at)
 THEN RAISE EXCEPTION 'A borrowing question requires its exact immutable borrower receipt' USING ERRCODE='23514';END IF;
 IF current_question.state='resolved' AND NOT EXISTS(SELECT 1 FROM resource_loan_receipts receipt JOIN resource_loans loan ON loan.id=receipt.loan_id AND loan.school_id=receipt.school_id
  WHERE receipt.school_id=NEW.school_id AND receipt.loan_id=NEW.loan_id AND receipt.question_id=NEW.id AND receipt.action='resolved'
   AND receipt.actor_person_id=loan.custodian_person_id AND receipt.recorded_at=current_question.resolved_at)
 THEN RAISE EXCEPTION 'Question resolution requires its exact immutable custodian receipt' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER resource_loan_question_receipt_guard AFTER INSERT OR UPDATE ON resource_loan_questions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_resource_loan_question_receipt();
CREATE FUNCTION guard_resource_loan_revision_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM resource_loan_receipts WHERE school_id=NEW.school_id AND loan_id=NEW.id AND revision=NEW.revision)
 THEN RAISE EXCEPTION 'Each loan revision requires its immutable native action receipt' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' AND (NOT EXISTS(SELECT 1 FROM resource_loan_parts WHERE loan_id=NEW.id AND kind='item' AND quantity=1)
  OR NOT EXISTS(SELECT 1 FROM resource_loan_receipts WHERE school_id=NEW.school_id AND loan_id=NEW.id AND revision=1 AND action='issued'))
 THEN RAISE EXCEPTION 'Physical issue requires its exact main item and issue receipt' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND NEW.due_at IS DISTINCT FROM OLD.due_at AND NOT EXISTS(SELECT 1 FROM resource_loan_receipts WHERE school_id=NEW.school_id AND loan_id=NEW.id AND revision=NEW.revision AND action='due_changed' AND due_at=NEW.due_at AND previous_due_at=OLD.due_at)
 THEN RAISE EXCEPTION 'Due changes require their exact old/new dated receipt' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER resource_loan_revision_receipt_guard AFTER INSERT OR UPDATE ON resource_loans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_resource_loan_revision_receipt();

ALTER TABLE resource_loans ENABLE ROW LEVEL SECURITY;ALTER TABLE resource_loan_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_loan_questions ENABLE ROW LEVEL SECURITY;ALTER TABLE resource_loan_receipts ENABLE ROW LEVEL SECURITY;ALTER TABLE resource_loan_receipt_parts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON resource_loans,resource_loan_parts,resource_loan_questions,resource_loan_receipts,resource_loan_receipt_parts FROM PUBLIC;
REVOKE ALL ON resource_loan_balances,resource_loan_status FROM PUBLIC;
COMMENT ON TABLE resource_loan_receipts IS 'Closed typed physical-custody and question history. Observed time is reported physical evidence; recorded time is retained selected-world knowledge. No automatic expiry or overwrite.';
COMMENT ON TABLE resource_loan_parts IS 'Parts of one exact identified kit, not an independent inventory catalogue. The whole holding stays unavailable until every part is returned usable.';
