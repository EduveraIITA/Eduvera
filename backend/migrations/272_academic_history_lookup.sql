-- Historical rosters cannot use the existing is_active-only indexes. Keep a
-- bounded class/term/date access path without duplicating enrollment state.
CREATE INDEX enrollments_class_term_history_idx
  ON enrollments(class_section_id,term_id,enrolled_on,student_id);
