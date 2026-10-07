CREATE TABLE IF NOT EXISTS chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  kind varchar(16) NOT NULL DEFAULT 'direct' CHECK (kind IN ('direct', 'group', 'announcement')),
  title varchar(180) NOT NULL DEFAULT '',
  context_student_id uuid REFERENCES students(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_conversation_school_activity_idx
  ON chat_conversations(school_id, last_message_at DESC NULLS LAST, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_participants (
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  participant_role varchar(16) NOT NULL DEFAULT 'member' CHECK (participant_role IN ('member', 'moderator')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  is_muted boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS chat_participant_user_active_idx
  ON chat_participants(user_id, is_active, conversation_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_id uuid,
  body text NOT NULL DEFAULT '',
  message_type varchar(16) NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'file', 'system')),
  reply_to_id uuid REFERENCES chat_messages(id) ON DELETE SET NULL,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(body) <= 4000),
  UNIQUE (conversation_id, client_id)
);
CREATE INDEX IF NOT EXISTS chat_message_conversation_time_idx
  ON chat_messages(conversation_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS chat_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL UNIQUE REFERENCES chat_messages(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  original_name varchar(255) NOT NULL,
  content_type varchar(120) NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_message_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  reported_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason varchar(500) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed', 'actioned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, reported_by)
);
CREATE INDEX IF NOT EXISTS chat_report_school_review_idx
  ON chat_message_reports(status, created_at DESC);
