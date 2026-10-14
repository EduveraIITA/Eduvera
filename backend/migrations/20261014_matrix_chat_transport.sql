-- Matrix is opt-in. Existing schools/messages are not migrated or enabled implicitly.
CREATE TABLE IF NOT EXISTS chat_matrix_schools (
  school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamptz,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chat_matrix_rooms (
  conversation_id uuid PRIMARY KEY REFERENCES chat_conversations(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  matrix_room_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chat_matrix_outbox (
  id bigserial PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('send','edit','redact')),
  -- Immutable snapshot: a later edit must never rewrite a queued earlier event.
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','delivered','blocked')),
  matrix_event_id text,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_matrix_one_initial_send ON chat_matrix_outbox(message_id) WHERE action='send';
CREATE INDEX IF NOT EXISTS chat_matrix_pending_delivery ON chat_matrix_outbox(conversation_id,id) WHERE state='pending';
CREATE INDEX IF NOT EXISTS chat_matrix_school_delivery ON chat_matrix_outbox(school_id,state,available_at);

CREATE OR REPLACE FUNCTION chat_matrix_enqueue_message() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tenant uuid; event_action text;
BEGIN
  SELECT school_id INTO tenant FROM chat_conversations WHERE id=NEW.conversation_id;
  IF NOT EXISTS(SELECT 1 FROM chat_matrix_schools WHERE school_id=tenant AND enabled) THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN event_action := 'send';
  ELSIF NEW.is_deleted AND NOT OLD.is_deleted THEN event_action := 'redact';
  ELSIF NEW.body IS DISTINCT FROM OLD.body THEN event_action := 'edit';
  ELSE RETURN NEW;
  END IF;
  INSERT INTO chat_matrix_outbox(school_id,conversation_id,message_id,action,payload)
    VALUES(tenant,NEW.conversation_id,NEW.id,event_action,
      jsonb_build_object('body',NEW.body,'sender_id',NEW.sender_id,'message_type',NEW.message_type,
        'reply_to_id',NEW.reply_to_id,'created_at',NEW.created_at));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS chat_matrix_message_outbox ON chat_messages;
CREATE TRIGGER chat_matrix_message_outbox AFTER INSERT OR UPDATE OF body,is_deleted ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION chat_matrix_enqueue_message();
