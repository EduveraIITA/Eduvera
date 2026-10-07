ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS group_type text CHECK (group_type IN ('student_group','parent_group','activity','staff','child_support','announcement')),
  ADD COLUMN IF NOT EXISTS posting_mode text NOT NULL DEFAULT 'all' CHECK (posting_mode IN ('all','moderators'));

CREATE TABLE IF NOT EXISTS chat_policies (
  school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  student_teacher_direct_enabled boolean NOT NULL DEFAULT true,
  guardian_teacher_direct_enabled boolean NOT NULL DEFAULT true,
  student_group_replies boolean NOT NULL DEFAULT true,
  guardian_group_replies boolean NOT NULL DEFAULT false,
  attachments_enabled boolean NOT NULL DEFAULT true,
  enforce_communication_hours boolean NOT NULL DEFAULT false,
  communication_start time NOT NULL DEFAULT '06:00',
  communication_end time NOT NULL DEFAULT '21:00',
  retention_days integer NOT NULL DEFAULT 455 CHECK (retention_days BETWEEN 30 AND 3650),
  privacy_notice_version text NOT NULL DEFAULT '2026-09',
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO chat_policies (school_id)
SELECT id FROM schools
ON CONFLICT (school_id) DO NOTHING;
