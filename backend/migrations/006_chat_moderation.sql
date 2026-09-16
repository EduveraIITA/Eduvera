-- Moderation workflow for reported chat messages.
ALTER TABLE chat_message_reports
  DROP CONSTRAINT IF EXISTS chat_message_reports_status_check;

UPDATE chat_message_reports SET status='under_review' WHERE status='reviewed';
UPDATE chat_message_reports SET status='resolved' WHERE status='actioned';

ALTER TABLE chat_message_reports
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolution_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS action_taken varchar(32) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

ALTER TABLE chat_message_reports
  ADD CONSTRAINT chat_message_reports_status_check
    CHECK (status IN ('open', 'under_review', 'resolved', 'dismissed')),
  ADD CONSTRAINT chat_message_reports_action_check
    CHECK (action_taken IN ('none', 'no_action', 'warning', 'restrict', 'escalate'));

CREATE INDEX IF NOT EXISTS chat_report_assignee_status_idx
  ON chat_message_reports(assigned_to, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messaging_restrictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_id uuid NOT NULL REFERENCES chat_message_reports(id) ON DELETE CASCADE,
  reason text NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_restriction_user_school_idx
  ON chat_messaging_restrictions(user_id, school_id, expires_at DESC);
