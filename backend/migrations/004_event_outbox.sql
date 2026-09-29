CREATE TABLE IF NOT EXISTS event_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  event_type varchar(120) NOT NULL,
  aggregate_type varchar(80) NOT NULL,
  aggregate_id uuid NOT NULL,
  audience_user_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL UNIQUE,
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_outbox_pending_idx
  ON event_outbox(available_at, created_at, id)
  WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS event_outbox_school_created_idx
  ON event_outbox(school_id, created_at DESC);

CREATE INDEX IF NOT EXISTS event_outbox_audience_gin_idx
  ON event_outbox USING gin(audience_user_ids);
