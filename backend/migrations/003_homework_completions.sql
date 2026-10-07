CREATE TABLE IF NOT EXISTS homework_completions (
  item_id uuid NOT NULL REFERENCES diary_items(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  completed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, student_id)
);
CREATE INDEX IF NOT EXISTS homework_completions_student_idx ON homework_completions(student_id);
