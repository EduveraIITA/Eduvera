-- A missing institution automation policy is an explicit manual fallback, not
-- an invented approved version or an implicitly activated automatic rule.
ALTER TABLE activity_attendance_registers
  DROP CONSTRAINT activity_attendance_registers_policy_revision_check,
  ADD CONSTRAINT activity_attendance_registers_policy_revision_check CHECK(policy_revision >= 0);
