-- Campus Model Core: private cross-domain identity, relationships, actors,
-- observations, commands and outcomes. Domain tables remain authoritative.

CREATE TABLE campus_model_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  kind varchar(64) NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{1,63}$'),
  domain varchar(64) NOT NULL CHECK (domain ~ '^[a-z][a-z0-9_]{1,63}$'),
  domain_id text NOT NULL CHECK (length(btrim(domain_id)) BETWEEN 1 AND 160),
  label varchar(200) NOT NULL,
  lifecycle_state varchar(24) NOT NULL DEFAULT 'active'
    CHECK (lifecycle_state IN ('planned','active','inactive','retired','archived')),
  source_revision integer NOT NULL DEFAULT 1 CHECK (source_revision > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, domain, domain_id),
  UNIQUE (id, school_id)
);
CREATE INDEX campus_model_entities_school_kind_idx
  ON campus_model_entities(school_id,kind,lifecycle_state,label);

CREATE TABLE campus_model_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  relation_type varchar(64) NOT NULL CHECK (relation_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  source_entity_id uuid NOT NULL,
  target_entity_id uuid NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  source_domain varchar(64) NOT NULL CHECK (source_domain ~ '^[a-z][a-z0-9_]{1,63}$'),
  source_record_id text NOT NULL CHECK (length(btrim(source_record_id)) BETWEEN 1 AND 160),
  source_revision integer NOT NULL DEFAULT 1 CHECK (source_revision > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_entity_id <> target_entity_id),
  CHECK (effective_until IS NULL OR effective_until > effective_from),
  UNIQUE (school_id, relation_type, source_entity_id, target_entity_id, effective_from),
  FOREIGN KEY (source_entity_id,school_id) REFERENCES campus_model_entities(id,school_id) ON DELETE CASCADE,
  FOREIGN KEY (target_entity_id,school_id) REFERENCES campus_model_entities(id,school_id) ON DELETE CASCADE
);
CREATE INDEX campus_model_relationships_source_current_idx
  ON campus_model_relationships(school_id,source_entity_id,relation_type,effective_from DESC)
  WHERE effective_until IS NULL;
CREATE INDEX campus_model_relationships_target_current_idx
  ON campus_model_relationships(school_id,target_entity_id,relation_type,effective_from DESC)
  WHERE effective_until IS NULL;

CREATE TABLE campus_model_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  agent_kind varchar(20) NOT NULL
    CHECK (agent_kind IN ('human','team','device','integration','software')),
  user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  external_ref text,
  label varchar(200) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, school_id),
  CHECK (
    (agent_kind='human' AND user_id IS NOT NULL AND external_ref IS NULL)
    OR (agent_kind<>'human' AND user_id IS NULL AND external_ref IS NOT NULL AND length(btrim(external_ref))>0)
  )
);
CREATE UNIQUE INDEX campus_model_agents_human_idx
  ON campus_model_agents(school_id,user_id) WHERE agent_kind='human';
CREATE UNIQUE INDEX campus_model_agents_external_idx
  ON campus_model_agents(school_id,agent_kind,external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE campus_model_agent_authorities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL,
  capability varchar(120) NOT NULL CHECK (length(btrim(capability)) BETWEEN 3 AND 120),
  scope_entity_id uuid,
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  grant_source varchar(80) NOT NULL,
  grant_reference_id text NOT NULL,
  approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  operating_rule_version_ref text,
  constraints jsonb NOT NULL DEFAULT '{}'::jsonb,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until > effective_from),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  FOREIGN KEY (agent_id,school_id) REFERENCES campus_model_agents(id,school_id) ON DELETE CASCADE,
  FOREIGN KEY (scope_entity_id,school_id) REFERENCES campus_model_entities(id,school_id) ON DELETE RESTRICT
);
CREATE INDEX campus_model_agent_authorities_current_idx
  ON campus_model_agent_authorities(school_id,agent_id,capability,effective_from,effective_until)
  WHERE revoked_at IS NULL;

CREATE TABLE campus_model_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  kind varchar(100) NOT NULL CHECK (length(btrim(kind)) BETWEEN 3 AND 100),
  subject_entity_id uuid NOT NULL,
  context_entity_id uuid,
  captured_by_agent_id uuid NOT NULL,
  source_type varchar(40) NOT NULL,
  source_ref text,
  source_record_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  evidence_refs text[] NOT NULL DEFAULT ARRAY[]::text[],
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  state varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','accepted','rejected','quarantined','superseded')),
  idempotency_key text NOT NULL,
  domain_event_id uuid REFERENCES event_outbox(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id,source_type,source_record_id),
  UNIQUE (school_id,idempotency_key),
  FOREIGN KEY (subject_entity_id,school_id) REFERENCES campus_model_entities(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY (context_entity_id,school_id) REFERENCES campus_model_entities(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY (captured_by_agent_id,school_id) REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT,
  CHECK (received_at >= observed_at - interval '365 days')
);
CREATE INDEX campus_model_observations_subject_time_idx
  ON campus_model_observations(school_id,subject_entity_id,observed_at DESC);
CREATE INDEX campus_model_observations_pending_idx
  ON campus_model_observations(school_id,received_at) WHERE state IN ('pending','quarantined');

CREATE TABLE campus_model_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  command_type varchar(120) NOT NULL CHECK (length(btrim(command_type)) BETWEEN 3 AND 120),
  target_entity_id uuid,
  actor_agent_id uuid NOT NULL,
  state varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','review_required','accepted','rejected','conflicted','expired','failed','cancelled')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  effective_at timestamptz,
  expected_revision integer CHECK (expected_revision IS NULL OR expected_revision >= 0),
  authority_evidence text[] NOT NULL DEFAULT ARRAY[]::text[],
  operating_rule_version_ref text,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  idempotency_key text NOT NULL,
  source_domain varchar(64) NOT NULL,
  safe_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id,idempotency_key),
  FOREIGN KEY (target_entity_id,school_id) REFERENCES campus_model_entities(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_agent_id,school_id) REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT
);
CREATE INDEX campus_model_commands_target_time_idx
  ON campus_model_commands(school_id,target_entity_id,requested_at DESC);
CREATE INDEX campus_model_commands_actor_time_idx
  ON campus_model_commands(school_id,actor_agent_id,requested_at DESC);

CREATE TABLE campus_model_command_outcomes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  command_id uuid NOT NULL REFERENCES campus_model_commands(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  status varchar(20) NOT NULL
    CHECK (status IN ('review_required','accepted','rejected','conflicted','expired','failed','cancelled')),
  code varchar(80) NOT NULL,
  explanation varchar(500) NOT NULL,
  resulting_entity_id uuid,
  resulting_revision integer CHECK (resulting_revision IS NULL OR resulting_revision >= 0),
  domain_event_id uuid REFERENCES event_outbox(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (command_id,sequence),
  FOREIGN KEY (resulting_entity_id) REFERENCES campus_model_entities(id) ON DELETE SET NULL
);

CREATE TABLE campus_model_projection_checkpoints (
  consumer varchar(100) PRIMARY KEY,
  last_delivery_sequence bigint NOT NULL DEFAULT 0 CHECK (last_delivery_sequence >= 0),
  last_event_id uuid REFERENCES event_outbox(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Backfill stable identities. The source domain retains every business invariant.
INSERT INTO campus_model_entities(school_id,kind,domain,domain_id,label,lifecycle_state,source_revision)
SELECT id,'institution','institutions',id::text,name,'active',1 FROM schools
ON CONFLICT(school_id,domain,domain_id) DO NOTHING;

INSERT INTO campus_model_entities(school_id,kind,domain,domain_id,label,lifecycle_state,source_revision)
SELECT school_id,'campus','campus_topology',id::text,name,status,revision FROM institution_campuses
ON CONFLICT(school_id,domain,domain_id) DO NOTHING;

INSERT INTO campus_model_entities(school_id,kind,domain,domain_id,label,lifecycle_state,source_revision)
SELECT school_id,'space','campus_topology',id::text,name,status,revision FROM campus_spaces
ON CONFLICT(school_id,domain,domain_id) DO NOTHING;

INSERT INTO campus_model_entities(school_id,kind,domain,domain_id,label,lifecycle_state,source_revision)
SELECT school_id,'resource_type','campus_topology',id::text,name,CASE WHEN is_active THEN 'active' ELSE 'inactive' END,revision
FROM campus_resource_types ON CONFLICT(school_id,domain,domain_id) DO NOTHING;

INSERT INTO campus_model_entities(school_id,kind,domain,domain_id,label,lifecycle_state,source_revision)
SELECT school_id,'resource','campus_topology',id::text,name,CASE state WHEN 'retired' THEN 'retired' ELSE 'active' END,revision
FROM campus_resource_holdings ON CONFLICT(school_id,domain,domain_id) DO NOTHING;

INSERT INTO campus_model_entities(school_id,kind,domain,domain_id,label,lifecycle_state,source_revision)
SELECT school_id,'class','academic_structure',id::text,'Class '||grade||section,'active',revision FROM class_sections
ON CONFLICT(school_id,domain,domain_id) DO NOTHING;

INSERT INTO campus_model_entities(school_id,kind,domain,domain_id,label,lifecycle_state,source_revision)
SELECT school_id,'staff','people',id::text,trim(concat_ws(' ',first_name,last_name)),
  CASE status WHEN 'inactive' THEN 'inactive' ELSE 'active' END,revision FROM staff_profiles
ON CONFLICT(school_id,domain,domain_id) DO NOTHING;

INSERT INTO campus_model_agents(school_id,agent_kind,user_id,label,status)
SELECT membership.school_id,'human',membership.user_id,
  COALESCE(NULLIF(trim(concat_ws(' ',actor.first_name,actor.last_name)),''),actor.username),
  CASE WHEN actor.is_active AND bool_or(membership.is_active) THEN 'active' ELSE 'revoked' END
FROM school_memberships membership JOIN users actor ON actor.id=membership.user_id
GROUP BY membership.school_id,membership.user_id,actor.first_name,actor.last_name,actor.username,actor.is_active
ON CONFLICT(school_id,user_id) WHERE agent_kind='human' DO NOTHING;

-- Half-open effective intervals: [effective_from, effective_until).
INSERT INTO campus_model_relationships(
  school_id,relation_type,source_entity_id,target_entity_id,effective_from,
  source_domain,source_record_id,source_revision)
SELECT campus.school_id,'part_of',campus_entity.id,institution_entity.id,campus.created_at,
  'campus_topology',campus.id::text,campus.revision
FROM institution_campuses campus
JOIN campus_model_entities campus_entity ON campus_entity.school_id=campus.school_id AND campus_entity.domain='campus_topology' AND campus_entity.domain_id=campus.id::text
JOIN campus_model_entities institution_entity ON institution_entity.school_id=campus.school_id AND institution_entity.domain='institutions' AND institution_entity.domain_id=campus.school_id::text
ON CONFLICT DO NOTHING;

INSERT INTO campus_model_relationships(
  school_id,relation_type,source_entity_id,target_entity_id,effective_from,
  source_domain,source_record_id,source_revision)
SELECT space.school_id,'part_of',space_entity.id,COALESCE(parent_entity.id,campus_entity.id),space.created_at,
  'campus_topology',space.id::text,space.revision
FROM campus_spaces space
JOIN campus_model_entities space_entity ON space_entity.school_id=space.school_id AND space_entity.domain='campus_topology' AND space_entity.domain_id=space.id::text
JOIN campus_model_entities campus_entity ON campus_entity.school_id=space.school_id AND campus_entity.domain='campus_topology' AND campus_entity.domain_id=space.campus_id::text
LEFT JOIN campus_model_entities parent_entity ON parent_entity.school_id=space.school_id AND parent_entity.domain='campus_topology' AND parent_entity.domain_id=space.parent_space_id::text
ON CONFLICT DO NOTHING;

INSERT INTO campus_model_relationships(
  school_id,relation_type,source_entity_id,target_entity_id,effective_from,effective_until,
  source_domain,source_record_id,source_revision)
SELECT placement.school_id,'located_in',class_entity.id,campus_entity.id,
  placement.effective_from::timestamp AT TIME ZONE campus.timezone,
  CASE WHEN placement.effective_until IS NULL THEN NULL ELSE (placement.effective_until+1)::timestamp AT TIME ZONE campus.timezone END,
  'campus_topology',placement.id::text,placement.revision
FROM class_campus_placements placement
JOIN institution_campuses campus ON campus.id=placement.campus_id
JOIN campus_model_entities class_entity ON class_entity.school_id=placement.school_id AND class_entity.domain='academic_structure' AND class_entity.domain_id=placement.class_section_id::text
JOIN campus_model_entities campus_entity ON campus_entity.school_id=placement.school_id AND campus_entity.domain='campus_topology' AND campus_entity.domain_id=placement.campus_id::text
ON CONFLICT DO NOTHING;

INSERT INTO campus_model_relationships(
  school_id,relation_type,source_entity_id,target_entity_id,effective_from,effective_until,
  source_domain,source_record_id,source_revision)
SELECT placement.school_id,'home_space',class_entity.id,space_entity.id,
  placement.effective_from::timestamp AT TIME ZONE campus.timezone,
  CASE WHEN placement.effective_until IS NULL THEN NULL ELSE (placement.effective_until+1)::timestamp AT TIME ZONE campus.timezone END,
  'campus_topology',placement.id::text,placement.revision
FROM class_campus_placements placement
JOIN institution_campuses campus ON campus.id=placement.campus_id
JOIN campus_model_entities class_entity ON class_entity.school_id=placement.school_id AND class_entity.domain='academic_structure' AND class_entity.domain_id=placement.class_section_id::text
JOIN campus_model_entities space_entity ON space_entity.school_id=placement.school_id AND space_entity.domain='campus_topology' AND space_entity.domain_id=placement.home_space_id::text
WHERE placement.home_space_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO campus_model_relationships(
  school_id,relation_type,source_entity_id,target_entity_id,effective_from,effective_until,
  source_domain,source_record_id,source_revision)
SELECT assignment.school_id,'assigned_to',staff_entity.id,campus_entity.id,
  assignment.effective_from::timestamp AT TIME ZONE campus.timezone,
  CASE WHEN assignment.effective_until IS NULL THEN NULL ELSE (assignment.effective_until+1)::timestamp AT TIME ZONE campus.timezone END,
  'campus_topology',assignment.id::text,assignment.revision
FROM staff_campus_assignments assignment
JOIN institution_campuses campus ON campus.id=assignment.campus_id
JOIN campus_model_entities staff_entity ON staff_entity.school_id=assignment.school_id AND staff_entity.domain='people' AND staff_entity.domain_id=assignment.staff_profile_id::text
JOIN campus_model_entities campus_entity ON campus_entity.school_id=assignment.school_id AND campus_entity.domain='campus_topology' AND campus_entity.domain_id=assignment.campus_id::text
ON CONFLICT DO NOTHING;

INSERT INTO campus_model_relationships(
  school_id,relation_type,source_entity_id,target_entity_id,effective_from,
  source_domain,source_record_id,source_revision)
SELECT holding.school_id,'instance_of',holding_entity.id,type_entity.id,holding.created_at,
  'campus_topology',holding.id::text,holding.revision
FROM campus_resource_holdings holding
JOIN campus_model_entities holding_entity ON holding_entity.school_id=holding.school_id AND holding_entity.domain='campus_topology' AND holding_entity.domain_id=holding.id::text
JOIN campus_model_entities type_entity ON type_entity.school_id=holding.school_id AND type_entity.domain='campus_topology' AND type_entity.domain_id=holding.resource_type_id::text
ON CONFLICT DO NOTHING;

INSERT INTO campus_model_relationships(
  school_id,relation_type,source_entity_id,target_entity_id,effective_from,
  source_domain,source_record_id,source_revision)
SELECT holding.school_id,'located_in',holding_entity.id,COALESCE(space_entity.id,campus_entity.id),holding.created_at,
  'campus_topology',holding.id::text,holding.revision
FROM campus_resource_holdings holding
JOIN campus_model_entities holding_entity ON holding_entity.school_id=holding.school_id AND holding_entity.domain='campus_topology' AND holding_entity.domain_id=holding.id::text
JOIN campus_model_entities campus_entity ON campus_entity.school_id=holding.school_id AND campus_entity.domain='campus_topology' AND campus_entity.domain_id=holding.campus_id::text
LEFT JOIN campus_model_entities space_entity ON space_entity.school_id=holding.school_id AND space_entity.domain='campus_topology' AND space_entity.domain_id=holding.space_id::text
ON CONFLICT DO NOTHING;

ALTER TABLE campus_model_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_agent_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_command_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_projection_checkpoints ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON campus_model_entities,campus_model_relationships,campus_model_agents,
  campus_model_agent_authorities,campus_model_observations,campus_model_commands,
  campus_model_command_outcomes,campus_model_projection_checkpoints FROM PUBLIC;

DO $$
DECLARE application_owner name;
BEGIN
  SELECT tableowner INTO application_owner FROM pg_tables WHERE schemaname='public' AND tablename='schools';
  IF application_owner IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.campus_model_entities OWNER TO %I',application_owner);
    EXECUTE format('ALTER TABLE public.campus_model_relationships OWNER TO %I',application_owner);
    EXECUTE format('ALTER TABLE public.campus_model_agents OWNER TO %I',application_owner);
    EXECUTE format('ALTER TABLE public.campus_model_agent_authorities OWNER TO %I',application_owner);
    EXECUTE format('ALTER TABLE public.campus_model_observations OWNER TO %I',application_owner);
    EXECUTE format('ALTER TABLE public.campus_model_commands OWNER TO %I',application_owner);
    EXECUTE format('ALTER TABLE public.campus_model_command_outcomes OWNER TO %I',application_owner);
    EXECUTE format('ALTER TABLE public.campus_model_projection_checkpoints OWNER TO %I',application_owner);
    IF to_regclass('public.campus_model_command_outcomes_id_seq') IS NOT NULL THEN
      EXECUTE format('ALTER SEQUENCE public.campus_model_command_outcomes_id_seq OWNER TO %I',application_owner);
    END IF;
  END IF;
END $$;
