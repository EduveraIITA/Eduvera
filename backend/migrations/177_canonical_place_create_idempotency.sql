-- Retain exact explicit place-create retries in the existing owning audit journal.
-- Old setup events have no client key and are deliberately outside this constraint.
CREATE UNIQUE INDEX institution_setup_explicit_place_command_key
  ON institution_setup_audits(school_id,actor_id,(metadata->>'idempotency_key'))
  WHERE action='space.created' AND metadata ? 'idempotency_key';
