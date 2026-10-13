-- Only explicitly contracted, durable notifications may enter the cross-portal
-- attention projection. Existing bell notifications intentionally remain
-- ineligible; no title/body inference or legacy backfill is permitted.
ALTER TABLE notifications
  ADD COLUMN attention_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN attention_school_id uuid REFERENCES schools(id) ON DELETE CASCADE,
  ADD COLUMN attention_student_id uuid REFERENCES students(id) ON DELETE CASCADE,
  ADD COLUMN attention_class_section_id uuid REFERENCES class_sections(id) ON DELETE CASCADE,
  ADD COLUMN attention_portal varchar(16),
  ADD COLUMN attention_module varchar(32),
  ADD COLUMN attention_source_kind varchar(48),
  ADD COLUMN attention_source_id uuid,
  ADD COLUMN attention_source_revision integer,
  ADD COLUMN attention_topic_key varchar(255),
  ADD CONSTRAINT notifications_typed_attention_contract_ck CHECK (
    (
      NOT attention_eligible
      AND attention_school_id IS NULL
      AND attention_student_id IS NULL
      AND attention_class_section_id IS NULL
      AND attention_portal IS NULL
      AND attention_module IS NULL
      AND attention_source_kind IS NULL
      AND attention_source_id IS NULL
      AND attention_source_revision IS NULL
      AND attention_topic_key IS NULL
    ) OR (
      attention_eligible
      AND attention_school_id IS NOT NULL
      AND attention_portal IN ('parent','teacher','principal')
      AND attention_module IN ('leave','results','calendar','timetable')
      AND attention_source_kind IN (
        'student_leave_decision',
        'staff_leave_decision',
        'assessment_publication',
        'report_publication',
        'day_plan_publication',
        'timetable_publication',
        'calendar_change'
      )
      AND attention_source_id IS NOT NULL
      AND attention_source_revision >= 1
      AND length(trim(attention_topic_key)) BETWEEN 1 AND 255
      AND CASE attention_source_kind
        WHEN 'student_leave_decision' THEN attention_portal='parent' AND attention_module='leave'
        WHEN 'staff_leave_decision' THEN attention_portal='teacher' AND attention_module='leave'
        WHEN 'assessment_publication' THEN attention_portal='parent' AND attention_module='results'
        WHEN 'report_publication' THEN attention_portal='parent' AND attention_module='results'
        WHEN 'day_plan_publication' THEN attention_portal IN ('parent','teacher','principal') AND attention_module='timetable'
        WHEN 'timetable_publication' THEN attention_portal IN ('parent','teacher','principal') AND attention_module='timetable'
        WHEN 'calendar_change' THEN attention_portal IN ('parent','teacher','principal') AND attention_module='calendar'
        ELSE false
      END
    )
  );

-- Ranking must see read and unread revisions together; otherwise an older
-- unread revision can reappear after the latest revision is opened.
CREATE INDEX notifications_typed_attention_topic_idx
  ON notifications(
    recipient_id,
    attention_school_id,
    attention_topic_key,
    attention_source_revision DESC,
    created_at DESC,
    id DESC
  )
  WHERE attention_eligible;

CREATE INDEX notifications_typed_attention_unread_idx
  ON notifications(recipient_id, attention_school_id, created_at DESC, id DESC)
  WHERE attention_eligible AND read_at IS NULL;

CREATE INDEX notifications_typed_attention_student_idx
  ON notifications(recipient_id, attention_student_id, created_at DESC)
  WHERE attention_eligible AND attention_student_id IS NOT NULL;

COMMENT ON COLUMN notifications.attention_eligible IS
  'Explicit producer opt-in for the authorized attention projection; never inferred from notification copy.';
COMMENT ON COLUMN notifications.attention_portal IS
  'Portal context selected by the producer; prevents a multi-role account from seeing one role''s update in another role.';
COMMENT ON COLUMN notifications.attention_topic_key IS
  'Stable per-recipient outcome topic used to collapse superseded revisions before unread filtering.';
