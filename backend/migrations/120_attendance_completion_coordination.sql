-- Institution-owned timing for attendance completion work. These values are
-- configuration, not hidden runtime defaults: every overdue projection and
-- notification snapshots the effective rule revision that produced it.
ALTER TABLE public.institution_operating_rules
  ADD COLUMN attendance_overdue_reminder_minutes integer NOT NULL DEFAULT 15
    CHECK(attendance_overdue_reminder_minutes BETWEEN 0 AND 1440),
  ADD COLUMN attendance_overdue_escalation_minutes integer NOT NULL DEFAULT 60
    CHECK(attendance_overdue_escalation_minutes BETWEEN 1 AND 2880),
  ADD CONSTRAINT institution_attendance_completion_timing_valid CHECK(
    attendance_overdue_escalation_minutes>attendance_overdue_reminder_minutes
  );

INSERT INTO public.event_maintenance_leases(task_name,last_claimed_at)
VALUES('attendance_register_completion_coordination',NULL)
ON CONFLICT(task_name) DO NOTHING;
