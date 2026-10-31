-- The registered participation worker is the only attendance finalizer.
-- Retain historical migrations/audits; retire only this unused worker lease.
DELETE FROM event_maintenance_leases WHERE task_name='attendance_register_auto_finalize';
