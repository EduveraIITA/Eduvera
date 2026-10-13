CREATE TABLE institution_operating_rules (
  school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  event_entry_hours_before integer NOT NULL DEFAULT 2 CHECK (event_entry_hours_before BETWEEN 0 AND 168),
  event_staff_hours_after integer NOT NULL DEFAULT 24 CHECK (event_staff_hours_after BETWEEN 0 AND 720),
  journey_lead_minutes integer NOT NULL DEFAULT 30 CHECK (journey_lead_minutes BETWEEN 0 AND 240),
  message_edit_minutes integer NOT NULL DEFAULT 2 CHECK (message_edit_minutes BETWEEN 0 AND 60),
  message_attachment_mb integer NOT NULL DEFAULT 10 CHECK (message_attachment_mb BETWEEN 1 AND 10),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
