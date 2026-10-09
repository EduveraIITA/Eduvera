ALTER TABLE fee_gateway_orders ADD COLUMN last_payment_status text;
ALTER TABLE fee_gateway_orders ADD COLUMN last_attempt_id text;
CREATE TABLE fee_payment_emails (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES fee_gateway_orders(id),
 provider_payment_id text NOT NULL,
 payment_state text NOT NULL CHECK(payment_state IN ('captured','review_required','failed','pending')),
 delivery_state text NOT NULL DEFAULT 'queued' CHECK(delivery_state IN ('queued','sending','accepted','unknown','skipped')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(order_id,provider_payment_id,payment_state)
);
CREATE INDEX fee_payment_emails_pending ON fee_payment_emails(created_at) WHERE delivery_state='queued';
DO $$ DECLARE owner_name text; BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='students'::regclass;
 ALTER TABLE fee_payment_emails ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON fee_payment_emails FROM PUBLIC;
 EXECUTE format('ALTER TABLE fee_payment_emails OWNER TO %I',owner_name);
END $$;
