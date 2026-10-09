-- Sandbox transactions are deliberately labelled and enabled only in demo mode.
ALTER TABLE fee_payments DROP CONSTRAINT fee_payments_method_check;
ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_method_check CHECK(method IN ('cash','bank_transfer','cheque','razorpay_test'));
CREATE TABLE fee_gateway_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  amount_paise integer NOT NULL CHECK(amount_paise > 0),
  currency text NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
  key_id text NOT NULL CHECK(key_id LIKE 'rzp_test_%'),
  provider_order_id text UNIQUE,
  provider_payment_id text UNIQUE,
  payment_id uuid REFERENCES fee_payments(id),
  state text NOT NULL DEFAULT 'created' CHECK(state IN ('created','captured','review_required')),
  created_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  FOREIGN KEY(school_id,invoice_id) REFERENCES fee_invoices(school_id,id),
  CHECK((state='created' AND provider_payment_id IS NULL AND payment_id IS NULL)
    OR (state='captured' AND provider_payment_id IS NOT NULL AND payment_id IS NOT NULL)
    OR (state='review_required' AND provider_payment_id IS NOT NULL AND payment_id IS NULL))
);
CREATE UNIQUE INDEX fee_gateway_orders_active_invoice ON fee_gateway_orders(school_id,invoice_id) WHERE state='created';
CREATE INDEX fee_gateway_orders_reconcile ON fee_gateway_orders(checked_at) WHERE state='created';
CREATE TABLE fee_gateway_webhooks (
  event_id text PRIMARY KEY,
  payload_hash text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE owner_name text; table_name text; BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='students'::regclass;
 FOREACH table_name IN ARRAY ARRAY['fee_gateway_orders','fee_gateway_webhooks'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',table_name);
  EXECUTE format('ALTER TABLE %I OWNER TO %I',table_name,owner_name);
 END LOOP;
END $$;
