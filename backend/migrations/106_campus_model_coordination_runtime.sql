-- Provider-neutral, behaviour-configured coordination runtime for the private
-- Campus Model Core. This migration installs no behaviour and no subscription:
-- institutions must approve an effective version before an event can react.

ALTER TABLE event_outbox
  ADD CONSTRAINT event_outbox_id_school_unique UNIQUE(id,school_id);

ALTER TABLE campus_model_events
  DROP CONSTRAINT campus_model_events_event_kind_check,
  ADD CONSTRAINT campus_model_events_event_kind_check
    CHECK(event_kind IN ('plan','observation','decision','command_outcome','domain_event')),
  ADD COLUMN source_outbox_event_id uuid;

ALTER TABLE campus_model_events
  ADD CONSTRAINT campus_model_events_source_outbox_school_fk
  FOREIGN KEY(source_outbox_event_id,school_id)
  REFERENCES event_outbox(id,school_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX campus_model_events_source_outbox_idx
  ON campus_model_events(school_id,source_outbox_event_id)
  WHERE source_outbox_event_id IS NOT NULL;

CREATE TABLE campus_model_behaviour_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  behaviour_key varchar(64) NOT NULL CHECK(behaviour_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  version integer NOT NULL CHECK(version>0),
  status varchar(16) NOT NULL CHECK(status IN ('draft','approved','retired')),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  configuration jsonb NOT NULL CHECK(jsonb_typeof(configuration)='object'),
  configuration_schema_version integer NOT NULL CHECK(configuration_schema_version>0),
  created_by_agent_id uuid NOT NULL,
  approved_by_agent_id uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  UNIQUE(id,school_id),
  UNIQUE(school_id,behaviour_key,version),
  CHECK(effective_until IS NULL OR effective_until>effective_from),
  CHECK(
    (status='draft' AND approved_by_agent_id IS NULL AND approved_at IS NULL AND retired_at IS NULL)
    OR (status='approved' AND approved_by_agent_id IS NOT NULL AND approved_at IS NOT NULL AND retired_at IS NULL)
    OR (status='retired' AND approved_by_agent_id IS NOT NULL AND approved_at IS NOT NULL AND retired_at IS NOT NULL)
  ),
  FOREIGN KEY(created_by_agent_id,school_id) REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(approved_by_agent_id,school_id) REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT
);
CREATE INDEX campus_model_behaviour_versions_effective_idx
  ON campus_model_behaviour_versions(school_id,behaviour_key,effective_from,effective_until)
  WHERE status='approved';

CREATE TABLE campus_model_event_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  behaviour_version_id uuid NOT NULL,
  subscription_key varchar(64) NOT NULL CHECK(subscription_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  source_domain varchar(64) NOT NULL CHECK(source_domain ~ '^[a-z][a-z0-9_]{1,63}$'),
  event_type varchar(120) NOT NULL CHECK(length(btrim(event_type)) BETWEEN 3 AND 120),
  reaction_kind varchar(80) NOT NULL CHECK(reaction_kind ~ '^[a-z][a-z0-9_]{1,79}$'),
  message_kind varchar(16) NOT NULL CHECK(message_kind IN ('request','task','offer','update')),
  message_schema_version integer NOT NULL CHECK(message_schema_version>0),
  recipient_selector jsonb NOT NULL CHECK(
    jsonb_typeof(recipient_selector)='object'
    AND recipient_selector ?& ARRAY[
      'mode','selector_key','required_capability','scope_mode','min_recipients','max_recipients'
    ]
    AND recipient_selector->>'mode'='explicit_authorized_agents'
    AND recipient_selector->>'selector_key' ~ '^[a-z][a-z0-9_]{1,63}$'
    AND length(btrim(recipient_selector->>'required_capability')) BETWEEN 3 AND 120
    AND recipient_selector->>'scope_mode' IN ('institution','event_scope')
  ),
  response_due_after_seconds integer CHECK(response_due_after_seconds IS NULL OR response_due_after_seconds BETWEEN 0 AND 31536000),
  expires_after_seconds integer CHECK(expires_after_seconds IS NULL OR expires_after_seconds BETWEEN 1 AND 31536000),
  max_attempts integer NOT NULL CHECK(max_attempts BETWEEN 1 AND 100),
  retry_after_seconds integer CHECK(retry_after_seconds IS NULL OR retry_after_seconds BETWEEN 1 AND 604800),
  priority smallint NOT NULL CHECK(priority BETWEEN 0 AND 9),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,school_id),
  UNIQUE(id,behaviour_version_id,school_id),
  UNIQUE(behaviour_version_id,subscription_key),
  FOREIGN KEY(behaviour_version_id,school_id)
    REFERENCES campus_model_behaviour_versions(id,school_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX campus_model_event_subscriptions_match_idx
  ON campus_model_event_subscriptions(
    behaviour_version_id,source_domain,event_type,(recipient_selector->>'selector_key')
  );

CREATE TABLE campus_model_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  trigger_event_id uuid NOT NULL,
  source_outbox_event_id uuid NOT NULL,
  behaviour_version_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  recipient_agent_id uuid NOT NULL,
  reaction_kind varchar(80) NOT NULL,
  state varchar(20) NOT NULL CHECK(state IN (
    'queued','delivered','acknowledged','completed','expired','cancelled','dead_letter'
  )),
  selector_snapshot jsonb NOT NULL CHECK(jsonb_typeof(selector_snapshot)='object'),
  behaviour_snapshot jsonb NOT NULL CHECK(jsonb_typeof(behaviour_snapshot)='object'),
  correlation_id uuid NOT NULL,
  causation_event_id uuid,
  attempt_count integer NOT NULL CHECK(attempt_count>=0),
  max_attempts integer NOT NULL CHECK(max_attempts BETWEEN 1 AND 100),
  next_attempt_at timestamptz,
  response_due_at timestamptz,
  expires_at timestamptz,
  idempotency_key varchar(240) NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(id,school_id),
  UNIQUE(school_id,idempotency_key),
  UNIQUE(trigger_event_id,subscription_id,recipient_agent_id),
  CHECK(response_due_at IS NULL OR next_attempt_at IS NULL OR response_due_at>=next_attempt_at),
  CHECK(expires_at IS NULL OR next_attempt_at IS NULL OR expires_at>next_attempt_at),
  CHECK(response_due_at IS NULL OR expires_at IS NULL OR response_due_at<=expires_at),
  FOREIGN KEY(trigger_event_id,school_id) REFERENCES campus_model_events(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(source_outbox_event_id,school_id) REFERENCES event_outbox(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(behaviour_version_id,school_id) REFERENCES campus_model_behaviour_versions(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(subscription_id,behaviour_version_id,school_id)
    REFERENCES campus_model_event_subscriptions(id,behaviour_version_id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(recipient_agent_id,school_id) REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(causation_event_id,school_id) REFERENCES campus_model_events(id,school_id) ON DELETE RESTRICT
);
CREATE INDEX campus_model_reactions_queue_idx
  ON campus_model_reactions(school_id,state,next_attempt_at,created_at)
  WHERE state IN ('queued','delivered','acknowledged');
CREATE INDEX campus_model_reactions_recipient_idx
  ON campus_model_reactions(school_id,recipient_agent_id,state,created_at DESC);

CREATE TABLE campus_model_coordination_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  trigger_event_id uuid NOT NULL,
  source_outbox_event_id uuid NOT NULL,
  exception_code varchar(40) NOT NULL CHECK(exception_code IN (
    'configuration_missing','configuration_invalid','selector_invalid',
    'recipient_unresolved','recipient_unauthorized'
  )),
  status varchar(16) NOT NULL CHECK(status IN ('open','resolved')),
  selector_key varchar(64) NOT NULL,
  explanation varchar(500) NOT NULL CHECK(length(btrim(explanation))>=3),
  details jsonb NOT NULL CHECK(jsonb_typeof(details)='object'),
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by_agent_id uuid,
  UNIQUE(id,school_id),
  UNIQUE(trigger_event_id),
  CHECK((status='open' AND resolved_at IS NULL AND resolved_by_agent_id IS NULL)
    OR (status='resolved' AND resolved_at IS NOT NULL AND resolved_by_agent_id IS NOT NULL)),
  FOREIGN KEY(trigger_event_id,school_id) REFERENCES campus_model_events(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(source_outbox_event_id,school_id) REFERENCES event_outbox(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(resolved_by_agent_id,school_id) REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT
);
CREATE INDEX campus_model_coordination_exceptions_open_idx
  ON campus_model_coordination_exceptions(school_id,created_at)
  WHERE status='open';

CREATE TABLE campus_model_operational_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  reaction_id uuid NOT NULL,
  sender_agent_id uuid NOT NULL,
  recipient_agent_id uuid NOT NULL,
  owner_agent_id uuid NOT NULL,
  message_kind varchar(16) NOT NULL CHECK(message_kind IN ('request','task','offer','update')),
  state varchar(20) NOT NULL CHECK(state IN (
    'queued','delivered','acknowledged','responded','expired','cancelled','dead_letter'
  )),
  subject varchar(200) NOT NULL CHECK(length(btrim(subject))>0),
  summary varchar(1000) NOT NULL CHECK(length(btrim(summary))>0),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  schema_version integer NOT NULL CHECK(schema_version>0),
  correlation_id uuid NOT NULL,
  causation_event_id uuid,
  source_outbox_event_id uuid NOT NULL,
  dispatch_outbox_event_id uuid,
  response_due_at timestamptz,
  expires_at timestamptz,
  queued_at timestamptz NOT NULL,
  delivered_at timestamptz,
  acknowledged_at timestamptz,
  responded_at timestamptz,
  expired_at timestamptz,
  cancelled_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,school_id),
  UNIQUE(reaction_id),
  CHECK(response_due_at IS NULL OR response_due_at>=queued_at),
  CHECK(expires_at IS NULL OR expires_at>queued_at),
  CHECK(response_due_at IS NULL OR expires_at IS NULL OR response_due_at<=expires_at),
  FOREIGN KEY(reaction_id,school_id) REFERENCES campus_model_reactions(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(sender_agent_id,school_id) REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(recipient_agent_id,school_id) REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(owner_agent_id,school_id) REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(causation_event_id,school_id) REFERENCES campus_model_events(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(source_outbox_event_id,school_id) REFERENCES event_outbox(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(dispatch_outbox_event_id,school_id) REFERENCES event_outbox(id,school_id) ON DELETE RESTRICT
);
CREATE INDEX campus_model_operational_messages_owner_idx
  ON campus_model_operational_messages(school_id,owner_agent_id,state,queued_at DESC);
CREATE INDEX campus_model_operational_messages_delivery_idx
  ON campus_model_operational_messages(school_id,state,queued_at)
  WHERE state IN ('queued','delivered','acknowledged');

CREATE TABLE campus_model_operational_message_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  message_id uuid NOT NULL,
  sequence integer NOT NULL CHECK(sequence>0),
  state varchar(20) NOT NULL CHECK(state IN (
    'delivered','acknowledged','responded','expired','cancelled','dead_letter'
  )),
  actor_agent_id uuid,
  source_outbox_event_id uuid,
  code varchar(64) NOT NULL CHECK(code ~ '^[a-z][a-z0-9_]{1,63}$'),
  explanation varchar(500) NOT NULL CHECK(length(btrim(explanation))>=3),
  response jsonb,
  occurred_at timestamptz NOT NULL,
  idempotency_key varchar(240) NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,school_id),
  UNIQUE(message_id,sequence),
  UNIQUE(school_id,idempotency_key),
  CHECK(response IS NULL OR jsonb_typeof(response)='object'),
  CHECK((state='responded' AND response IS NOT NULL AND source_outbox_event_id IS NOT NULL) OR (state<>'responded' AND response IS NULL)),
  CHECK((state IN ('acknowledged','responded') AND actor_agent_id IS NOT NULL) OR state NOT IN ('acknowledged','responded')),
  FOREIGN KEY(message_id,school_id) REFERENCES campus_model_operational_messages(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(actor_agent_id,school_id) REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(source_outbox_event_id,school_id) REFERENCES event_outbox(id,school_id) ON DELETE RESTRICT
);
CREATE INDEX campus_model_operational_message_outcomes_message_idx
  ON campus_model_operational_message_outcomes(school_id,message_id,sequence);

ALTER TABLE campus_model_behaviour_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_event_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_coordination_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_operational_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_operational_message_outcomes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE campus_model_behaviour_versions,campus_model_event_subscriptions,
  campus_model_reactions,campus_model_coordination_exceptions,campus_model_operational_messages,
  campus_model_operational_message_outcomes FROM PUBLIC;

DO $$
DECLARE application_owner text; role_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner FROM pg_class WHERE oid='public.students'::regclass;
  EXECUTE format('ALTER TABLE public.campus_model_behaviour_versions OWNER TO %I',application_owner);
  EXECUTE format('ALTER TABLE public.campus_model_event_subscriptions OWNER TO %I',application_owner);
  EXECUTE format('ALTER TABLE public.campus_model_reactions OWNER TO %I',application_owner);
  EXECUTE format('ALTER TABLE public.campus_model_coordination_exceptions OWNER TO %I',application_owner);
  EXECUTE format('ALTER TABLE public.campus_model_operational_messages OWNER TO %I',application_owner);
  EXECUTE format('ALTER TABLE public.campus_model_operational_message_outcomes OWNER TO %I',application_owner);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public.campus_model_behaviour_versions,public.campus_model_event_subscriptions,public.campus_model_reactions,public.campus_model_coordination_exceptions,public.campus_model_operational_messages,public.campus_model_operational_message_outcomes FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END $$;
