-- Stage-only rehearsal clock. This controls the synthetic Cambridge harness,
-- not an institution operating rule or any production-campus clock.
ALTER TABLE hosted_campus_lab_controls
  ADD COLUMN clock_mode text NOT NULL DEFAULT '60m',
  ADD CONSTRAINT hosted_campus_lab_clock_mode_check
    CHECK (clock_mode IN ('realtime', '1m', '15m', '60m'));

COMMENT ON COLUMN hosted_campus_lab_controls.clock_mode IS
  'Realtime or accelerated per-school-day clock used by the stage Cambridge Campus Lab.';
