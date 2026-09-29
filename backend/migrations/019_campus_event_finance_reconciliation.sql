-- Paid campus-event reconciliation extends the existing immutable fee ledger.
-- Posted invoices and payments remain untouched: obligation reductions and
-- returned money are represented by new append-only credit/refund facts.

-- Composite keys prevent a school_id supplied by an application bug from
-- being paired with an invoice that belongs to another tenant. The existing
-- single-column invoice/payment keys remain valid for older callers.
CREATE UNIQUE INDEX fee_invoices_school_identity_idx
  ON fee_invoices(school_id,id);
ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_school_invoice_fk
  FOREIGN KEY(school_id,invoice_id) REFERENCES fee_invoices(school_id,id) ON DELETE RESTRICT;

-- A withdrawal is the durable participation fact. Financial reconciliation
-- refers to it; the withdrawal never points back to or mutates a later credit.
CREATE TABLE campus_event_participant_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  event_id uuid NOT NULL,
  student_id uuid NOT NULL,
  reason varchar(500) NOT NULL CHECK(length(trim(reason))>=3),
  idempotency_key uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  withdrawn_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  withdrawn_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  UNIQUE(school_id,event_id,student_id,id),
  UNIQUE(school_id,idempotency_key),
  UNIQUE(event_id,student_id),
  FOREIGN KEY(school_id,event_id,student_id)
    REFERENCES campus_event_participants(school_id,event_id,student_id) ON DELETE RESTRICT
);
CREATE INDEX campus_event_withdrawals_student_time_idx
  ON campus_event_participant_withdrawals(school_id,student_id,withdrawn_at DESC,id);

-- Include fee_invoice_id in the referenced participant key so an adjustment
-- cannot attach some other invoice belonging to the same student.
CREATE UNIQUE INDEX campus_event_participant_invoice_identity_idx
  ON campus_event_participants(school_id,event_id,student_id,fee_invoice_id);

CREATE TABLE fee_invoice_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  event_id uuid NOT NULL,
  student_id uuid NOT NULL,
  participant_withdrawal_id uuid,
  amount_paise integer NOT NULL CHECK(amount_paise>0),
  source varchar(24) NOT NULL CHECK(source IN ('event_cancelled','participant_withdrawn')),
  reason varchar(500) NOT NULL CHECK(length(trim(reason))>=3),
  idempotency_key uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  UNIQUE(school_id,id,invoice_id,event_id,student_id),
  UNIQUE(school_id,idempotency_key),
  FOREIGN KEY(school_id,invoice_id,student_id)
    REFERENCES fee_invoices(school_id,id,student_id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,event_id,student_id,invoice_id)
    REFERENCES campus_event_participants(school_id,event_id,student_id,fee_invoice_id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,event_id,student_id,participant_withdrawal_id)
    REFERENCES campus_event_participant_withdrawals(school_id,event_id,student_id,id) ON DELETE RESTRICT,
  CHECK(
    (source='event_cancelled' AND participant_withdrawal_id IS NULL)
    OR (source='participant_withdrawn' AND participant_withdrawal_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX fee_invoice_cancelled_event_credit_once_idx
  ON fee_invoice_credits(invoice_id) WHERE source='event_cancelled';
CREATE UNIQUE INDEX fee_invoice_withdrawal_credit_once_idx
  ON fee_invoice_credits(invoice_id,participant_withdrawal_id)
  WHERE source='participant_withdrawn';
CREATE INDEX fee_invoice_credits_invoice_time_idx
  ON fee_invoice_credits(school_id,invoice_id,created_at DESC,id);
CREATE INDEX fee_invoice_credits_event_student_idx
  ON fee_invoice_credits(school_id,event_id,student_id,created_at DESC,id);

-- Refunds are invoice-level ledger facts. Office staff do not have to choose a
-- receipt row when several payments fund one invoice; aggregate database
-- guards ensure returned money never exceeds either credits or funds received.
CREATE TABLE fee_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  credit_id uuid NOT NULL,
  event_id uuid NOT NULL,
  student_id uuid NOT NULL,
  amount_paise integer NOT NULL CHECK(amount_paise>0),
  method varchar(24) NOT NULL CHECK(method IN ('cash','bank_transfer','cheque')),
  reference varchar(120) NOT NULL CHECK(length(trim(reference))>0),
  reason varchar(500) NOT NULL CHECK(length(trim(reason))>=3),
  idempotency_key uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  UNIQUE(school_id,idempotency_key),
  FOREIGN KEY(school_id,invoice_id,student_id)
    REFERENCES fee_invoices(school_id,id,student_id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,credit_id,invoice_id,event_id,student_id)
    REFERENCES fee_invoice_credits(school_id,id,invoice_id,event_id,student_id) ON DELETE RESTRICT
);
CREATE INDEX fee_refunds_invoice_time_idx
  ON fee_refunds(school_id,invoice_id,created_at DESC,id);
CREATE INDEX fee_refunds_credit_time_idx
  ON fee_refunds(school_id,credit_id,created_at DESC,id);
CREATE INDEX fee_refunds_event_student_idx
  ON fee_refunds(school_id,event_id,student_id,created_at DESC,id);
CREATE INDEX fee_refunds_reference_idx
  ON fee_refunds(school_id,method,reference);

-- Every insert touching an invoice takes the same row lock. This serializes
-- payment, credit and refund limits under concurrency without changing posted
-- fee_invoices or fee_payments.
CREATE FUNCTION serialize_fee_payment_against_invoice()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  invoice_amount integer;
  credited_amount bigint;
  paid_amount bigint;
  refunded_amount bigint;
BEGIN
  SELECT invoice.amount_paise INTO invoice_amount
  FROM fee_invoices invoice
  WHERE invoice.school_id=NEW.school_id AND invoice.id=NEW.invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment invoice does not exist in this school' USING ERRCODE='23503';
  END IF;

  SELECT COALESCE(sum(credit.amount_paise),0) INTO credited_amount
  FROM fee_invoice_credits credit
  WHERE credit.school_id=NEW.school_id AND credit.invoice_id=NEW.invoice_id;
  SELECT COALESCE(sum(payment.amount_paise),0) INTO paid_amount
  FROM fee_payments payment
  WHERE payment.school_id=NEW.school_id AND payment.invoice_id=NEW.invoice_id;
  SELECT COALESCE(sum(refund.amount_paise),0) INTO refunded_amount
  FROM fee_refunds refund
  WHERE refund.school_id=NEW.school_id AND refund.invoice_id=NEW.invoice_id;

  IF paid_amount-refunded_amount+NEW.amount_paise>invoice_amount-credited_amount THEN
    RAISE EXCEPTION 'Payment exceeds the reconciled invoice balance' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION validate_fee_invoice_credit()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  invoice_amount integer;
  credited_amount bigint;
BEGIN
  SELECT invoice.amount_paise INTO invoice_amount
  FROM fee_invoices invoice
  WHERE invoice.school_id=NEW.school_id AND invoice.id=NEW.invoice_id
    AND invoice.student_id=NEW.student_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit invoice does not belong to this school and student' USING ERRCODE='23503';
  END IF;

  IF NEW.source='event_cancelled' AND NOT EXISTS (
    SELECT 1 FROM campus_events event
    WHERE event.school_id=NEW.school_id AND event.id=NEW.event_id AND event.status='cancelled'
  ) THEN
    RAISE EXCEPTION 'Cancellation credit requires a cancelled event' USING ERRCODE='23514';
  END IF;
  IF NEW.source='participant_withdrawn' AND NOT EXISTS (
    SELECT 1 FROM campus_event_participant_withdrawals withdrawal
    WHERE withdrawal.school_id=NEW.school_id AND withdrawal.id=NEW.participant_withdrawal_id
      AND withdrawal.event_id=NEW.event_id AND withdrawal.student_id=NEW.student_id
  ) THEN
    RAISE EXCEPTION 'Withdrawal credit requires the matching withdrawal record' USING ERRCODE='23514';
  END IF;

  SELECT COALESCE(sum(credit.amount_paise),0) INTO credited_amount
  FROM fee_invoice_credits credit
  WHERE credit.school_id=NEW.school_id AND credit.invoice_id=NEW.invoice_id;
  IF credited_amount+NEW.amount_paise>invoice_amount THEN
    RAISE EXCEPTION 'Credits exceed the invoice amount' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION validate_fee_refund()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  invoice_amount integer;
  credited_amount bigint;
  paid_amount bigint;
  refunded_amount bigint;
BEGIN
  SELECT invoice.amount_paise INTO invoice_amount
  FROM fee_invoices invoice
  WHERE invoice.school_id=NEW.school_id AND invoice.id=NEW.invoice_id
    AND invoice.student_id=NEW.student_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refund invoice does not belong to this school and student' USING ERRCODE='23503';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM fee_invoice_credits credit
    WHERE credit.school_id=NEW.school_id AND credit.id=NEW.credit_id
      AND credit.invoice_id=NEW.invoice_id AND credit.event_id=NEW.event_id
      AND credit.student_id=NEW.student_id
  ) THEN
    RAISE EXCEPTION 'Refund credit does not belong to this invoice and event participant' USING ERRCODE='23503';
  END IF;

  SELECT COALESCE(sum(credit.amount_paise),0) INTO credited_amount
  FROM fee_invoice_credits credit
  WHERE credit.school_id=NEW.school_id AND credit.invoice_id=NEW.invoice_id;
  SELECT COALESCE(sum(payment.amount_paise),0) INTO paid_amount
  FROM fee_payments payment
  WHERE payment.school_id=NEW.school_id AND payment.invoice_id=NEW.invoice_id;
  SELECT COALESCE(sum(refund.amount_paise),0) INTO refunded_amount
  FROM fee_refunds refund
  WHERE refund.school_id=NEW.school_id AND refund.invoice_id=NEW.invoice_id;
  IF refunded_amount+NEW.amount_paise>credited_amount THEN
    RAISE EXCEPTION 'Refunds exceed credited obligations' USING ERRCODE='23514';
  END IF;
  IF refunded_amount+NEW.amount_paise>paid_amount THEN
    RAISE EXCEPTION 'Refunds exceed payments received' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION prevent_campus_event_finance_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Campus-event finance reconciliation records are append-only' USING ERRCODE='55000';
END $$;

CREATE TRIGGER fee_payments_serialize_invoice_before_insert
  BEFORE INSERT ON fee_payments
  FOR EACH ROW EXECUTE FUNCTION serialize_fee_payment_against_invoice();
CREATE TRIGGER fee_invoice_credits_validate_before_insert
  BEFORE INSERT ON fee_invoice_credits
  FOR EACH ROW EXECUTE FUNCTION validate_fee_invoice_credit();
CREATE TRIGGER fee_refunds_validate_before_insert
  BEFORE INSERT ON fee_refunds
  FOR EACH ROW EXECUTE FUNCTION validate_fee_refund();
CREATE TRIGGER campus_event_participant_withdrawals_append_only
  BEFORE UPDATE OR DELETE ON campus_event_participant_withdrawals
  FOR EACH ROW EXECUTE FUNCTION prevent_campus_event_finance_ledger_mutation();
CREATE TRIGGER fee_invoice_credits_append_only
  BEFORE UPDATE OR DELETE ON fee_invoice_credits
  FOR EACH ROW EXECUTE FUNCTION prevent_campus_event_finance_ledger_mutation();
CREATE TRIGGER fee_refunds_append_only
  BEFORE UPDATE OR DELETE ON fee_refunds
  FOR EACH ROW EXECUTE FUNCTION prevent_campus_event_finance_ledger_mutation();

-- Cancellation reconciles every linked event invoice inside the same database
-- transaction as the lifecycle transition. Locks are acquired in invoice-id
-- order and each credit is the then-current uncredited obligation.
CREATE FUNCTION append_campus_event_cancellation_credits(
  target_school_id uuid,
  target_event_id uuid,
  actor_id uuid,
  cancellation_note text
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE
  item record;
  already_credited bigint;
  remaining_amount integer;
  credit_reason text;
  command_key uuid;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Cancelled event must identify the actor recording credits' USING ERRCODE='23514';
  END IF;
  credit_reason:=left('Event cancelled: ' || COALESCE(NULLIF(trim(cancellation_note),''),'cancelled by school'),500);

  FOR item IN
    SELECT participant.fee_invoice_id AS invoice_id,participant.student_id,invoice.amount_paise
    FROM campus_event_participants participant
    JOIN fee_invoices invoice ON invoice.school_id=participant.school_id
      AND invoice.id=participant.fee_invoice_id AND invoice.student_id=participant.student_id
    WHERE participant.school_id=target_school_id AND participant.event_id=target_event_id
      AND participant.fee_invoice_id IS NOT NULL
    ORDER BY participant.fee_invoice_id
  LOOP
    PERFORM 1 FROM fee_invoices invoice
    WHERE invoice.school_id=target_school_id AND invoice.id=item.invoice_id
    FOR UPDATE;
    SELECT COALESCE(sum(credit.amount_paise),0) INTO already_credited
    FROM fee_invoice_credits credit
    WHERE credit.school_id=target_school_id AND credit.invoice_id=item.invoice_id;
    remaining_amount:=item.amount_paise-already_credited;
    IF remaining_amount>0 THEN
      command_key:=md5('campus-event-cancel-credit:' || target_school_id::text || ':'
        || target_event_id::text || ':' || item.invoice_id::text)::uuid;
      INSERT INTO fee_invoice_credits(
        school_id,invoice_id,event_id,student_id,amount_paise,source,reason,
        idempotency_key,request_hash,recorded_by
      ) VALUES (
        target_school_id,item.invoice_id,target_event_id,item.student_id,remaining_amount,
        'event_cancelled',credit_reason,command_key,
        encode(digest(concat_ws('|',target_school_id::text,item.invoice_id::text,
          target_event_id::text,item.student_id::text,remaining_amount::text,
          'event_cancelled',credit_reason),'sha256'),'hex'),actor_id
      );
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION reconcile_cancelled_campus_event()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF NEW.status='cancelled' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM append_campus_event_cancellation_credits(
      NEW.school_id,NEW.id,NEW.cancelled_by,NEW.cancellation_internal_reason
    );
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campus_event_cancelled_finance_reconciliation
  AFTER UPDATE OF status ON campus_events
  FOR EACH ROW EXECUTE FUNCTION reconcile_cancelled_campus_event();

-- Reconcile any event that was already cancelled before this extension was
-- deployed. The same function and deterministic key are used as live writes.
DO $$
DECLARE cancelled_event record;
BEGIN
  FOR cancelled_event IN
    SELECT event.school_id,event.id,event.cancelled_by,event.cancellation_internal_reason
    FROM campus_events event WHERE event.status='cancelled' ORDER BY event.id
  LOOP
    PERFORM append_campus_event_cancellation_credits(
      cancelled_event.school_id,cancelled_event.id,cancelled_event.cancelled_by,
      cancelled_event.cancellation_internal_reason
    );
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION serialize_fee_payment_against_invoice() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_fee_invoice_credit() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_fee_refund() FROM PUBLIC;
REVOKE ALL ON FUNCTION prevent_campus_event_finance_ledger_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION append_campus_event_cancellation_credits(uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION reconcile_cancelled_campus_event() FROM PUBLIC;

DO $$ DECLARE table_name text; owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='students'::regclass;
  FOREACH table_name IN ARRAY ARRAY[
    'campus_event_participant_withdrawals','fee_invoice_credits','fee_refunds'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',table_name);
    EXECUTE format('ALTER TABLE %I OWNER TO %I',table_name,owner_name);
  END LOOP;
  EXECUTE format('ALTER FUNCTION serialize_fee_payment_against_invoice() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION validate_fee_invoice_credit() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION validate_fee_refund() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION prevent_campus_event_finance_ledger_mutation() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION append_campus_event_cancellation_credits(uuid,uuid,uuid,text) OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION reconcile_cancelled_campus_event() OWNER TO %I',owner_name);
END $$;
