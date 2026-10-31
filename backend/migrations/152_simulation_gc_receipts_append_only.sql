-- Retention cleanup evidence survives retries and world deletion. This is a
-- control-plane receipt, not an operational record or a mutable job row.
CREATE FUNCTION reject_simulation_gc_receipt_change() RETURNS trigger
LANGUAGE plpgsql AS $body$
BEGIN
  RAISE EXCEPTION 'Simulation garbage-collection receipts are append-only';
END
$body$;

CREATE TRIGGER simulation_gc_receipt_immutable
BEFORE UPDATE OR DELETE ON simulation_run_gc_receipts
FOR EACH ROW EXECUTE FUNCTION reject_simulation_gc_receipt_change();

CREATE TRIGGER simulation_gc_receipt_no_truncate
BEFORE TRUNCATE ON simulation_run_gc_receipts
FOR EACH STATEMENT EXECUTE FUNCTION reject_simulation_gc_receipt_change();
