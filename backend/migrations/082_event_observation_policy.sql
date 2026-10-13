CREATE TABLE campus_event_attendance_policies (
  school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  observation_hours_before integer NOT NULL DEFAULT 2 CHECK (observation_hours_before BETWEEN 0 AND 168),
  observation_hours_after integer NOT NULL DEFAULT 4 CHECK (observation_hours_after BETWEEN 0 AND 168),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
