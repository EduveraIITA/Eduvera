-- One reviewed Finance command creates several independent immutable invoices.
-- Existing invoices and their command/basis commitments are never rewritten.
CREATE TABLE fee_charge_batches (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id),
  created_by uuid NOT NULL REFERENCES users(id),
  command_id uuid NOT NULL UNIQUE REFERENCES campus_model_commands(id),
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  audience_hash char(64) NOT NULL CHECK(audience_hash ~ '^[a-f0-9]{64}$'),
  audience_snapshot jsonb NOT NULL CHECK(COALESCE(jsonb_typeof(audience_snapshot)='object'
    AND jsonb_typeof(audience_snapshot->'people')='array',false)),
  reference varchar(74) NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 74),
  description varchar(200) NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 200),
  amount_paise integer NOT NULL CHECK(amount_paise BETWEEN 1 AND 100000000),
  due_on date NOT NULL,
  person_count integer NOT NULL CHECK(person_count BETWEEN 1 AND 500),
  total_amount_paise bigint NOT NULL CHECK(total_amount_paise=amount_paise::bigint*person_count),
  created_at timestamptz NOT NULL,
  UNIQUE(school_id,id), UNIQUE(school_id,reference)
);
CREATE TABLE fee_charge_batch_items (
  school_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 500),
  invoice_id uuid NOT NULL,
  person_id uuid NOT NULL,
  selected_person_revision integer NOT NULL CHECK(selected_person_revision>0),
  reference varchar(80) NOT NULL,
  name varchar(301) NOT NULL CHECK(length(btrim(name))>0),
  PRIMARY KEY(school_id,batch_id,person_id), UNIQUE(school_id,batch_id,ordinal), UNIQUE(school_id,invoice_id),
  FOREIGN KEY(school_id,batch_id) REFERENCES fee_charge_batches(school_id,id),
  FOREIGN KEY(school_id,invoice_id,person_id) REFERENCES fee_invoices(school_id,id,person_id)
);
CREATE INDEX fee_charge_batches_creator ON fee_charge_batches(school_id,created_by,created_at DESC,id);
CREATE INDEX fee_charge_batch_person ON fee_charge_batch_items(school_id,person_id,batch_id);

CREATE FUNCTION fee_charge_batch_item_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM fee_charge_batches b JOIN campus_model_commands c ON c.id=b.command_id
    JOIN fee_invoices i ON i.school_id=b.school_id AND i.id=NEW.invoice_id AND i.person_id=NEW.person_id
    WHERE b.school_id=NEW.school_id AND b.id=NEW.batch_id AND c.state='pending' AND c.school_id=b.school_id AND c.source_domain='finance'
      AND c.command_type='finance.charge_batch.issue' AND c.handler_key='finance.charge_batch' AND c.handler_version=1
      AND NEW.ordinal<=b.person_count AND i.selected_person_revision=NEW.selected_person_revision
      AND i.reference=NEW.reference AND i.reference=b.reference||'/'||lpad(NEW.ordinal::text,3,'0')
      AND i.amount_paise=b.amount_paise AND i.description=b.description AND i.due_on=b.due_on AND i.created_by=b.created_by)
  THEN RAISE EXCEPTION 'A collection item must match its pending exact Finance command and immutable invoice'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fee_charge_batch_item_source BEFORE INSERT ON fee_charge_batch_items FOR EACH ROW EXECUTE FUNCTION fee_charge_batch_item_guard();

CREATE FUNCTION fee_charge_batch_complete_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE item_count integer; total_paise bigint; invalid_count integer;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM campus_model_commands c JOIN campus_model_entities e ON e.id=c.target_entity_id
      JOIN campus_model_command_outcomes o ON o.command_id=c.id AND o.status='accepted'
    WHERE c.id=NEW.command_id AND c.school_id=NEW.school_id AND c.source_domain='finance'
      AND c.command_type='finance.charge_batch.issue' AND c.handler_key='finance.charge_batch' AND c.handler_version=1
      AND c.state='accepted' AND e.school_id=NEW.school_id AND e.kind='fee_charge_batch' AND e.domain='finance' AND e.domain_id=NEW.id::text
      AND c.safe_context->>'payload_hash'=NEW.request_hash AND c.safe_context->>'audience_hash'=NEW.audience_hash
      AND o.metadata->>'batch_id'=NEW.id::text)
  THEN RAISE EXCEPTION 'A charge collection requires its exact accepted Finance command'; END IF;
  SELECT count(*)::int,coalesce(sum(invoice.amount_paise::bigint),0),count(*) FILTER(WHERE
      NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.audience_snapshot->'people') p
        WHERE p->>'person_id'=item.person_id::text AND(p->>'revision')::integer=item.selected_person_revision AND p->>'name'=item.name))::int
    INTO item_count,total_paise,invalid_count FROM fee_charge_batch_items item JOIN fee_invoices invoice
      ON invoice.school_id=item.school_id AND invoice.id=item.invoice_id WHERE item.school_id=NEW.school_id AND item.batch_id=NEW.id;
  IF item_count<>NEW.person_count OR total_paise<>NEW.total_amount_paise OR invalid_count<>0
    OR jsonb_array_length(NEW.audience_snapshot->'people')<>NEW.person_count
  THEN RAISE EXCEPTION 'A charge collection must commit its complete reviewed audience and total atomically'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER fee_charge_batch_complete AFTER INSERT ON fee_charge_batches DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fee_charge_batch_complete_guard();
CREATE TRIGGER fee_charge_batch_immutable BEFORE UPDATE OR DELETE ON fee_charge_batches FOR EACH ROW EXECUTE FUNCTION protect_fee_record();
CREATE TRIGGER fee_charge_batch_item_immutable BEFORE UPDATE OR DELETE ON fee_charge_batch_items FOR EACH ROW EXECUTE FUNCTION protect_fee_record();

CREATE FUNCTION fee_charge_batch_event_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.event_type='finance.charge_batch.issued' AND(NEW.aggregate_type<>'fee_charge_batch'
    OR NEW.aggregate_id::text IS DISTINCT FROM NEW.payload->>'batch_id' OR NEW.payload->>'revision' IS DISTINCT FROM '1'
    OR NOT EXISTS(SELECT 1 FROM fee_charge_batches b WHERE b.school_id=NEW.school_id AND b.id=NEW.aggregate_id))
  THEN RAISE EXCEPTION 'Charge collection event must identify its exact Finance source'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fee_charge_batch_event_source BEFORE INSERT OR UPDATE ON event_outbox FOR EACH ROW EXECUTE FUNCTION fee_charge_batch_event_guard();

DO $$ DECLARE item text; restricted text; app_owner text; fn regprocedure; BEGIN
  SELECT pg_get_userbyid(relowner) INTO app_owner FROM pg_class WHERE oid='fee_invoices'::regclass;
  FOREACH item IN ARRAY ARRAY['fee_charge_batches','fee_charge_batch_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item); EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',item);
    EXECUTE format('ALTER TABLE %I OWNER TO %I',item,app_owner);
    FOREACH restricted IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=restricted) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',item,restricted);END IF;END LOOP;
  END LOOP;
  FOR fn IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace
    AND proname IN('fee_charge_batch_item_guard','fee_charge_batch_complete_guard','fee_charge_batch_event_guard')
  LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO %I',fn,app_owner);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
    FOREACH restricted IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=restricted) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',fn,restricted);END IF;END LOOP;
  END LOOP;
END $$;
