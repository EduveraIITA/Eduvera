-- Responsibility changes retain real issue/return evidence; they do not move an item.
ALTER TABLE resource_loan_receipts
 ADD COLUMN previous_custodian_person_id uuid,
 ADD COLUMN custodian_person_id uuid,
 ADD COLUMN custody_basis varchar(24),
 ADD COLUMN previous_question_message_id uuid,
 ADD CONSTRAINT resource_custody_previous_person_fk FOREIGN KEY(previous_custodian_person_id,school_id) REFERENCES school_people(id,school_id),
 ADD CONSTRAINT resource_custody_next_person_fk FOREIGN KEY(custodian_person_id,school_id) REFERENCES school_people(id,school_id),
 ADD CONSTRAINT resource_custody_receipt_shape CHECK(
   CASE WHEN action='custody_changed' THEN previous_custodian_person_id IS NOT NULL AND custodian_person_id IS NOT NULL
     AND previous_custodian_person_id<>custodian_person_id AND custody_basis IN('named_custodian','orphan_recovery')
     AND length(trim(reason))>=3 AND ((question_id IS NULL)=(previous_question_message_id IS NULL))
   ELSE previous_custodian_person_id IS NULL AND custodian_person_id IS NULL AND custody_basis IS NULL AND previous_question_message_id IS NULL END);

-- Discover the old anonymous checks by their exact semantics rather than guessed suffixes.
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
   WHERE conrelid='resource_loan_receipts'::regclass AND contype='c' LOOP
   IF item.definition LIKE '%action%issued%return_recorded%return_corrected%due_changed%question_asked%replied%resolved%'
     AND item.definition NOT LIKE '%observed_at%' AND item.definition NOT LIKE '%question_id%'
     OR item.definition LIKE '%question_asked%replied%resolved%question_id%'
   THEN EXECUTE format('ALTER TABLE resource_loan_receipts DROP CONSTRAINT %I',item.conname); END IF;
 END LOOP;
END $$;
ALTER TABLE resource_loan_receipts ADD CONSTRAINT resource_loan_action_v2 CHECK(action IN(
 'issued','return_recorded','return_corrected','due_changed','question_asked','replied','resolved','custody_changed'));
ALTER TABLE resource_loan_receipts ADD CONSTRAINT resource_loan_question_action_v2 CHECK(
 CASE WHEN action IN('question_asked','replied','resolved') THEN question_id IS NOT NULL
   WHEN action='custody_changed' THEN true ELSE question_id IS NULL END);

CREATE OR REPLACE FUNCTION guard_resource_loan_current() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Issued loans retain their custody history' USING ERRCODE='23514';END IF;
 IF (to_jsonb(NEW)-'revision'-'due_at'-'custodian_person_id') IS DISTINCT FROM (to_jsonb(OLD)-'revision'-'due_at'-'custodian_person_id') OR NEW.revision<>OLD.revision+1
 THEN RAISE EXCEPTION 'Only reviewed loan terms and responsibility may change' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_resource_loan_receipt_participant() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE borrower uuid;custodian uuid;
BEGIN
 SELECT borrower_person_id,custodian_person_id INTO borrower,custodian FROM resource_loans WHERE id=NEW.loan_id AND school_id=NEW.school_id;
 IF NEW.action='custody_changed' THEN
   IF NEW.custodian_person_id IS DISTINCT FROM custodian
     OR NOT EXISTS(SELECT 1 FROM campus_model_current_account_endpoints(NEW.school_id,NULL,now()) endpoint
       WHERE endpoint.person_id=NEW.custodian_person_id AND institution_resource_actor_can_manage(NEW.school_id,endpoint.user_id))
     OR NEW.custody_basis='named_custodian' AND NEW.actor_person_id IS DISTINCT FROM NEW.previous_custodian_person_id
     OR NEW.custody_basis='orphan_recovery' AND (NOT institution_resource_actor_can_manage(NEW.school_id,NEW.actor_user_id)
       OR EXISTS(SELECT 1 FROM campus_model_current_account_endpoints(NEW.school_id,NULL,now()) endpoint
         WHERE endpoint.person_id=NEW.previous_custodian_person_id AND institution_resource_actor_can_manage(NEW.school_id,endpoint.user_id)))
   THEN RAISE EXCEPTION 'Responsibility change requires its eligible recipient and exact custodian or orphan-recovery authority' USING ERRCODE='23514';END IF;
 ELSIF (NEW.action='question_asked' AND NEW.actor_person_id IS DISTINCT FROM borrower)
   OR (NEW.action='replied' AND NEW.actor_person_id IS DISTINCT FROM borrower AND NEW.actor_person_id IS DISTINCT FROM custodian)
   OR (NEW.action NOT IN('question_asked','replied') AND NEW.actor_person_id IS DISTINCT FROM custodian)
 THEN RAISE EXCEPTION 'A borrowing receipt requires its exact current participant role' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_resource_loan_revision_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM resource_loan_receipts WHERE school_id=NEW.school_id AND loan_id=NEW.id AND revision=NEW.revision)
 THEN RAISE EXCEPTION 'Each loan revision requires its immutable native action receipt' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' AND (NOT EXISTS(SELECT 1 FROM resource_loan_parts WHERE loan_id=NEW.id AND kind='item' AND quantity=1)
   OR NOT EXISTS(SELECT 1 FROM resource_loan_receipts WHERE school_id=NEW.school_id AND loan_id=NEW.id AND revision=1 AND action='issued'))
 THEN RAISE EXCEPTION 'Physical issue requires its exact main item and issue receipt' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' THEN
   IF NEW.due_at IS DISTINCT FROM OLD.due_at AND NOT EXISTS(SELECT 1 FROM resource_loan_receipts WHERE school_id=NEW.school_id AND loan_id=NEW.id AND revision=NEW.revision AND action='due_changed' AND due_at=NEW.due_at AND previous_due_at=OLD.due_at)
   THEN RAISE EXCEPTION 'Due changes require their exact old/new dated receipt' USING ERRCODE='23514';END IF;
   IF NEW.custodian_person_id IS DISTINCT FROM OLD.custodian_person_id AND NOT EXISTS(SELECT 1 FROM resource_loan_receipts
     WHERE school_id=NEW.school_id AND loan_id=NEW.id AND revision=NEW.revision AND action='custody_changed'
       AND previous_custodian_person_id=OLD.custodian_person_id AND custodian_person_id=NEW.custodian_person_id)
   THEN RAISE EXCEPTION 'Responsibility change requires its exact retained previous and next custodian receipt' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_resource_loan_question() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Borrowing questions retain their private history' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.claimed_return_at<(SELECT issued_at FROM resource_loans WHERE id=NEW.loan_id AND school_id=NEW.school_id)
   THEN RAISE EXCEPTION 'A reported return claim cannot precede physical issue' USING ERRCODE='23514';END IF;
 ELSE
   IF (to_jsonb(NEW)-'state'-'resolved_at'-'coordination_receipt') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'resolved_at'-'coordination_receipt') OR OLD.state='resolved'
   THEN RAISE EXCEPTION 'Question facts cannot be rewritten' USING ERRCODE='23514';END IF;
   IF NEW.coordination_receipt IS DISTINCT FROM OLD.coordination_receipt AND OLD.coordination_receipt<>'{}'::jsonb
     AND NOT EXISTS(SELECT 1 FROM resource_loan_receipts receipt JOIN resource_loans loan ON loan.school_id=receipt.school_id AND loan.id=receipt.loan_id
       WHERE receipt.school_id=NEW.school_id AND receipt.loan_id=NEW.loan_id AND receipt.question_id=NEW.id
         AND receipt.action='custody_changed' AND receipt.revision=loan.revision
         AND receipt.previous_question_message_id::text=OLD.coordination_receipt->'message_ids'->>0
         AND NEW.coordination_receipt->>'source_revision'=receipt.revision::text
         AND NEW.coordination_receipt->>'recipient_person_id'=loan.custodian_person_id::text)
   THEN RAISE EXCEPTION 'Question delivery changes require exact custody handover evidence' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;

-- Extend only the closed command mapping, preserving the complete existing source validator.
DO $$ DECLARE body text; BEGIN
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='resource_loan_event_source_is_valid(uuid,text,text,uuid,jsonb)'::regprocedure;
 IF position('WHEN ''resolved'' THEN ''resource_loans.question.resolve'' ELSE NULL END' in body)=0
 THEN RAISE EXCEPTION 'Resource source command mapping changed; review custody migration';END IF;
 body:=replace(body,'WHEN ''resolved'' THEN ''resource_loans.question.resolve'' ELSE NULL END',
   'WHEN ''resolved'' THEN ''resource_loans.question.resolve'' WHEN ''custody_changed'' THEN ''resource_loans.custody.change'' ELSE NULL END');
 body:=replace(body,'(event_payload-CASE WHEN v_public THEN ARRAY[''loan_id'',''revision'',''action'',''command_id'',''refresh'']
        ELSE ARRAY[''loan_id'',''revision'',''action'',''command_id''] END)',
   '(event_payload-(CASE WHEN v_public THEN ARRAY[''loan_id'',''revision'',''action'',''command_id'',''refresh'']
        ELSE ARRAY[''loan_id'',''revision'',''action'',''command_id''] END || CASE WHEN event_payload->>''action''=''custody_changed'' THEN ARRAY[''source_command_id''] ELSE ARRAY[]::text[] END))');
 body:=replace(body,'v_revision:=(event_payload->>''revision'')::integer;v_action:=event_payload->>''action'';',
   'v_revision:=(event_payload->>''revision'')::integer;v_action:=event_payload->>''action'';
    IF v_action=''custody_changed'' AND event_payload->>''source_command_id'' IS DISTINCT FROM event_payload->>''command_id'' THEN RETURN false;END IF;');
 body:=replace(body,'''loan_id'',loan.id::text,''revision'',v_revision,''action'',v_action,''command_id'',command.id::text)',
   '''loan_id'',loan.id::text,''revision'',v_revision,''action'',v_action,''command_id'',command.id::text)
      || CASE WHEN v_action=''custody_changed'' THEN jsonb_build_object(''source_command_id'',command.id::text) ELSE ''{}''::jsonb END');
 -- The deferred receipt validator reconstructs the exact safe event for new custody actions.
 EXECUTE format('CREATE OR REPLACE FUNCTION resource_loan_event_source_is_valid(institution uuid,event_name text,aggregate_kind text,aggregate uuid,event_payload jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO public AS %L',body);
END $$;

CREATE OR REPLACE FUNCTION validate_resource_loan_receipt_completion() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO public AS $$
BEGIN
 IF NOT coalesce(resource_loan_event_source_is_valid(NEW.school_id,'resource_loans.'||NEW.action,
   'resource_loan_event',NEW.loan_id,jsonb_build_object('loan_id',NEW.loan_id::text,
     'revision',NEW.revision,'action',NEW.action,'command_id',NEW.command_id::text)
       || CASE WHEN NEW.action='custody_changed' THEN jsonb_build_object('source_command_id',NEW.command_id::text) ELSE '{}'::jsonb END),false)
 THEN RAISE EXCEPTION 'Resource loan receipt requires its exact accepted command and source envelope in the selected world' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

COMMENT ON COLUMN resource_loan_receipts.custody_basis IS 'Exact signer handover or recovery only when the prior named custodian has no currently eligible account. Never physical return evidence.';
