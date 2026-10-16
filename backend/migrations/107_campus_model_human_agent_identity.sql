-- Person-stable human agents with dated account and approved-channel endpoints.
-- Domain-facing APIs may continue to use user_id, but the Model Core resolves that
-- endpoint to one institution-scoped school person. No name, email or phone matching
-- is used, and no identity is merged across institutions.

ALTER TABLE staff_profiles ADD COLUMN person_id uuid;

CREATE TEMP TABLE campus_model_identity_backfill (
  school_id uuid NOT NULL,
  user_id uuid NOT NULL,
  person_id uuid NOT NULL,
  source_kind text NOT NULL,
  PRIMARY KEY(school_id,user_id,person_id,source_kind)
) ON COMMIT DROP;

-- Existing person links are authoritative because they are already attached to the
-- account by the owning People domain. Shared contact details are deliberately absent.
INSERT INTO campus_model_identity_backfill(school_id,user_id,person_id,source_kind)
SELECT student.school_id,student.user_id,student.person_id,'student_profile'
FROM students student
WHERE student.user_id IS NOT NULL
UNION ALL
SELECT profile.school_id,parent.user_id,profile.person_id,'guardian_profile'
FROM guardian_school_profiles profile
JOIN parents parent ON parent.id=profile.guardian_id
WHERE parent.user_id IS NOT NULL
UNION ALL
SELECT DISTINCT appointment.school_id,appointment.linked_user_id,appointment.person_id,'governance_appointment'
FROM institution_governance_appointments appointment
WHERE appointment.linked_user_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM campus_model_identity_backfill
    GROUP BY school_id,user_id HAVING count(DISTINCT person_id)>1
  ) THEN
    RAISE EXCEPTION 'A campus account is linked to more than one person; review it before creating a human agent'
      USING ERRCODE='23514';
  END IF;
END $$;

-- A staff profile becomes person-backed. Reuse only an exact existing account link
-- inside the same institution; otherwise create a new person for this staff record.
UPDATE staff_profiles profile SET person_id=candidate.person_id
FROM (
  SELECT school_id,user_id,min(person_id::text)::uuid AS person_id
  FROM campus_model_identity_backfill
  GROUP BY school_id,user_id
) candidate
WHERE profile.school_id=candidate.school_id AND profile.user_id=candidate.user_id;

DO $$
DECLARE profile record; created_person_id uuid;
BEGIN
  FOR profile IN
    SELECT id,school_id,first_name,last_name,phone,email
    FROM staff_profiles WHERE person_id IS NULL ORDER BY school_id,id
  LOOP
    INSERT INTO school_people(school_id,first_name,last_name,contact_phone,contact_email)
    VALUES(profile.school_id,profile.first_name,profile.last_name,profile.phone,profile.email)
    RETURNING id INTO created_person_id;
    UPDATE staff_profiles SET person_id=created_person_id WHERE id=profile.id;
  END LOOP;
END $$;

ALTER TABLE staff_profiles ALTER COLUMN person_id SET NOT NULL;
ALTER TABLE staff_profiles
  ADD CONSTRAINT staff_profiles_person_scope_fk
    FOREIGN KEY(school_id,person_id) REFERENCES school_people(school_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT staff_profiles_person_unique UNIQUE(school_id,person_id);

-- People owns the person record. Keep future staff writes compatible while making
-- the linkage explicit: reuse only a person already tied to the exact same account,
-- otherwise create one for that staff record. Mutable contact fields are never used
-- to discover or merge identity.
CREATE FUNCTION ensure_staff_profile_person_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE explicit_person_id uuid; explicit_person_count integer;
BEGIN
  IF NEW.person_id IS NULL THEN
    SELECT count(DISTINCT linked.person_id),min(linked.person_id::text)::uuid
    INTO explicit_person_count,explicit_person_id
    FROM (
      SELECT student.person_id FROM students student
      WHERE NEW.user_id IS NOT NULL AND student.school_id=NEW.school_id AND student.user_id=NEW.user_id
      UNION ALL
      SELECT profile.person_id FROM parents parent
      JOIN guardian_school_profiles profile ON profile.guardian_id=parent.id
      WHERE NEW.user_id IS NOT NULL AND profile.school_id=NEW.school_id AND parent.user_id=NEW.user_id
      UNION ALL
      SELECT appointment.person_id FROM institution_governance_appointments appointment
      WHERE NEW.user_id IS NOT NULL AND appointment.school_id=NEW.school_id
        AND appointment.linked_user_id=NEW.user_id
    ) linked;
    IF explicit_person_count>1 THEN
      RAISE EXCEPTION 'The staff account is linked to more than one campus person'
        USING ERRCODE='23514';
    ELSIF explicit_person_count=1 THEN
      NEW.person_id:=explicit_person_id;
    ELSE
      INSERT INTO school_people(school_id,first_name,last_name,contact_phone,contact_email)
      VALUES(NEW.school_id,NEW.first_name,NEW.last_name,NEW.phone,NEW.email)
      RETURNING id INTO NEW.person_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER staff_profile_person_identity
  BEFORE INSERT ON staff_profiles
  FOR EACH ROW EXECUTE FUNCTION ensure_staff_profile_person_identity();

TRUNCATE campus_model_identity_backfill;
INSERT INTO campus_model_identity_backfill(school_id,user_id,person_id,source_kind)
SELECT student.school_id,student.user_id,student.person_id,'student_profile'
FROM students student
WHERE student.user_id IS NOT NULL
UNION ALL
SELECT profile.school_id,parent.user_id,profile.person_id,'guardian_profile'
FROM guardian_school_profiles profile
JOIN parents parent ON parent.id=profile.guardian_id
WHERE parent.user_id IS NOT NULL
UNION ALL
SELECT profile.school_id,profile.user_id,profile.person_id,'staff_profile'
FROM staff_profiles profile
WHERE profile.user_id IS NOT NULL
UNION ALL
SELECT DISTINCT appointment.school_id,appointment.linked_user_id,appointment.person_id,'governance_appointment'
FROM institution_governance_appointments appointment
WHERE appointment.linked_user_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM campus_model_identity_backfill
    GROUP BY school_id,user_id HAVING count(DISTINCT person_id)>1
  ) THEN
    RAISE EXCEPTION 'A campus account is linked to more than one person; review it before creating a human agent'
      USING ERRCODE='23514';
  END IF;
END $$;

-- Administrators and other exact membership accounts may not yet have a domain
-- profile. Create one person per explicit account+institution pair; never search by
-- name, email or phone. Existing agent rows are included to preserve their lineage
-- even if their membership was later disabled.
DO $$
DECLARE account record; created_person_id uuid;
BEGIN
  FOR account IN
    SELECT identity.school_id,identity.user_id,user_account.first_name,user_account.last_name,user_account.email
    FROM (
      SELECT agent.school_id,agent.user_id
      FROM campus_model_agents agent
      WHERE agent.agent_kind='human' AND agent.user_id IS NOT NULL
      UNION
      SELECT membership.school_id,membership.user_id
      FROM school_memberships membership
      WHERE membership.is_active AND membership.role='admin'
    ) identity
    JOIN users user_account ON user_account.id=identity.user_id
    WHERE NOT EXISTS (
      SELECT 1 FROM campus_model_identity_backfill mapped
      WHERE mapped.school_id=identity.school_id AND mapped.user_id=identity.user_id
    )
    ORDER BY identity.school_id,identity.user_id
  LOOP
    INSERT INTO school_people(school_id,first_name,last_name,contact_email)
    VALUES(account.school_id,account.first_name,account.last_name,account.email)
    RETURNING id INTO created_person_id;
    INSERT INTO campus_model_identity_backfill(school_id,user_id,person_id,source_kind)
    VALUES(account.school_id,account.user_id,created_person_id,'membership_account');
  END LOOP;
END $$;

ALTER TABLE campus_model_agents ADD COLUMN person_id uuid;

UPDATE campus_model_agents agent SET person_id=mapped.person_id
FROM (
  SELECT school_id,user_id,min(person_id::text)::uuid AS person_id
  FROM campus_model_identity_backfill
  GROUP BY school_id,user_id
) mapped
WHERE agent.agent_kind='human' AND agent.school_id=mapped.school_id AND agent.user_id=mapped.user_id;

-- Active account members receive a stable agent now. Account-less people do not.
INSERT INTO campus_model_agents(school_id,agent_kind,user_id,person_id,label,status)
SELECT mapped.school_id,'human',mapped.user_id,mapped.person_id,
  COALESCE(NULLIF(trim(concat_ws(' ',user_account.first_name,user_account.last_name)),''),user_account.username),
  CASE WHEN user_account.is_active THEN 'active' ELSE 'suspended' END
FROM (
  SELECT school_id,user_id,min(person_id::text)::uuid AS person_id
  FROM campus_model_identity_backfill
  GROUP BY school_id,user_id
) mapped
JOIN users user_account ON user_account.id=mapped.user_id
WHERE EXISTS (
  SELECT 1 FROM school_memberships membership
  WHERE membership.school_id=mapped.school_id AND membership.user_id=mapped.user_id AND membership.is_active
)
ON CONFLICT(school_id,user_id) WHERE agent_kind='human' DO UPDATE SET
  person_id=EXCLUDED.person_id,
  label=EXCLUDED.label,
  status=CASE WHEN campus_model_agents.status='revoked' THEN 'revoked' ELSE EXCLUDED.status END,
  revision=CASE
    WHEN campus_model_agents.person_id IS DISTINCT FROM EXCLUDED.person_id
      OR campus_model_agents.label IS DISTINCT FROM EXCLUDED.label
      OR campus_model_agents.status IS DISTINCT FROM
        CASE WHEN campus_model_agents.status='revoked' THEN 'revoked' ELSE EXCLUDED.status END
    THEN campus_model_agents.revision+1 ELSE campus_model_agents.revision END,
  updated_at=now();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM campus_model_agents WHERE agent_kind='human' AND person_id IS NULL) THEN
    RAISE EXCEPTION 'Every existing human agent must resolve to one school person'
      USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM campus_model_agents WHERE agent_kind='human'
    GROUP BY school_id,person_id HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'More than one human agent resolves to the same institution person; review before migration'
      USING ERRCODE='23514';
  END IF;
END $$;

CREATE TABLE campus_model_agent_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL,
  endpoint_kind varchar(20) NOT NULL CHECK(endpoint_kind IN ('account','external_channel')),
  provider varchar(40) NOT NULL CHECK(provider ~ '^[a-z][a-z0-9_.-]{1,39}$'),
  user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  external_subject text,
  status varchar(16) NOT NULL CHECK(status IN ('active','suspended','revoked')),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  source_domain varchar(64) NOT NULL CHECK(source_domain ~ '^[a-z][a-z0-9_]{1,63}$'),
  source_record_id text NOT NULL CHECK(length(btrim(source_record_id)) BETWEEN 1 AND 160),
  source_revision integer NOT NULL CHECK(source_revision>0),
  linked_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object'),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,school_id),
  UNIQUE(school_id,source_domain,source_record_id,source_revision),
  CHECK(effective_until IS NULL OR effective_until>effective_from),
  CHECK(
    (endpoint_kind='account' AND provider='thatcampus' AND user_id IS NOT NULL AND external_subject IS NULL)
    OR
    (endpoint_kind='external_channel' AND user_id IS NULL AND external_subject IS NOT NULL
      AND length(btrim(external_subject)) BETWEEN 1 AND 160)
  ),
  FOREIGN KEY(agent_id,school_id) REFERENCES campus_model_agents(id,school_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX campus_model_agent_endpoints_current_account_idx
  ON campus_model_agent_endpoints(school_id,user_id)
  WHERE endpoint_kind='account' AND effective_until IS NULL AND status='active';
CREATE UNIQUE INDEX campus_model_agent_endpoints_current_channel_idx
  ON campus_model_agent_endpoints(school_id,provider,external_subject)
  WHERE endpoint_kind='external_channel' AND effective_until IS NULL AND status='active';
CREATE INDEX campus_model_agent_endpoints_agent_time_idx
  ON campus_model_agent_endpoints(school_id,agent_id,endpoint_kind,effective_from DESC,effective_until);
CREATE INDEX campus_model_agent_endpoints_account_history_idx
  ON campus_model_agent_endpoints(user_id,school_id,effective_from DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX campus_model_agent_endpoints_linked_by_idx
  ON campus_model_agent_endpoints(linked_by_user_id)
  WHERE linked_by_user_id IS NOT NULL;

-- Endpoint state transitions are durable evidence. Closing or revoking an account
-- never edits away the interval that was valid before the transition, and an exact
-- retry can be distinguished from an attempt to reuse a command for different work.
CREATE TABLE campus_model_agent_endpoint_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  endpoint_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  transition_kind varchar(16) NOT NULL CHECK(transition_kind IN ('ended','revoked')),
  previous_status varchar(16) NOT NULL CHECK(previous_status IN ('active','suspended','revoked')),
  next_status varchar(16) NOT NULL CHECK(next_status IN ('active','suspended','revoked')),
  previous_effective_until timestamptz,
  effective_at timestamptz NOT NULL,
  resulting_endpoint_revision integer NOT NULL CHECK(resulting_endpoint_revision>0),
  reason varchar(500) NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),
  source_domain varchar(64) NOT NULL CHECK(source_domain ~ '^[a-z][a-z0-9_]{1,63}$'),
  source_record_id text NOT NULL CHECK(length(btrim(source_record_id)) BETWEEN 1 AND 160),
  source_revision integer NOT NULL CHECK(source_revision>0),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key varchar(220) NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,school_id),
  UNIQUE(school_id,idempotency_key),
  UNIQUE(school_id,source_domain,source_record_id,source_revision),
  FOREIGN KEY(endpoint_id,school_id) REFERENCES campus_model_agent_endpoints(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(agent_id,school_id) REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT
);
CREATE INDEX campus_model_agent_endpoint_transitions_endpoint_idx
  ON campus_model_agent_endpoint_transitions(school_id,endpoint_id,created_at DESC);

CREATE FUNCTION guard_campus_model_agent_endpoint_overlap()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE endpoint_key text;
BEGIN
  endpoint_key:=NEW.school_id::text||':'||NEW.endpoint_kind||':'||NEW.provider||':'||
    COALESCE(NEW.user_id::text,NEW.external_subject);
  PERFORM pg_advisory_xact_lock(hashtext(endpoint_key));
  IF NEW.endpoint_kind='account' THEN
    PERFORM pg_advisory_xact_lock(hashtext(
      NEW.school_id::text||':human-agent-account:'||NEW.agent_id::text
    ));
  END IF;
  IF EXISTS (
    SELECT 1 FROM campus_model_agent_endpoints endpoint
    WHERE endpoint.school_id=NEW.school_id AND endpoint.endpoint_kind=NEW.endpoint_kind
      AND endpoint.provider=NEW.provider AND endpoint.id<>NEW.id
      AND (
        (NEW.endpoint_kind='account' AND endpoint.user_id=NEW.user_id)
        OR (NEW.endpoint_kind='external_channel' AND endpoint.external_subject=NEW.external_subject)
      )
      AND tstzrange(endpoint.effective_from,endpoint.effective_until,'[)')
        && tstzrange(NEW.effective_from,NEW.effective_until,'[)')
  ) THEN
    RAISE EXCEPTION 'Agent endpoint intervals cannot overlap for one institution identity'
      USING ERRCODE='23P01';
  END IF;
  IF NEW.endpoint_kind='account' AND EXISTS (
    SELECT 1 FROM campus_model_agent_endpoints endpoint
    WHERE endpoint.school_id=NEW.school_id AND endpoint.agent_id=NEW.agent_id
      AND endpoint.endpoint_kind='account' AND endpoint.id<>NEW.id
      AND tstzrange(endpoint.effective_from,endpoint.effective_until,'[)')
        && tstzrange(NEW.effective_from,NEW.effective_until,'[)')
  ) THEN
    RAISE EXCEPTION 'A human agent cannot have overlapping campus account endpoints'
      USING ERRCODE='23P01';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campus_model_agent_endpoint_overlap_guard
  BEFORE INSERT OR UPDATE OF school_id,endpoint_kind,provider,user_id,external_subject,effective_from,effective_until
  ON campus_model_agent_endpoints
  FOR EACH ROW EXECUTE FUNCTION guard_campus_model_agent_endpoint_overlap();

-- Preserve the legacy account reference as an endpoint, then remove it from the
-- stable agent record so future account replacement does not replace the agent.
INSERT INTO campus_model_agent_endpoints(
  school_id,agent_id,endpoint_kind,provider,user_id,status,effective_from,
  source_domain,source_record_id,source_revision,metadata
)
SELECT agent.school_id,agent.id,'account','thatcampus',agent.user_id,
  CASE WHEN agent.status='active' AND user_account.is_active AND EXISTS (
    SELECT 1 FROM school_memberships membership
    WHERE membership.school_id=agent.school_id AND membership.user_id=agent.user_id AND membership.is_active
      AND (
        membership.role='admin'
        OR (membership.role='staff' AND EXISTS (
          SELECT 1 FROM staff_profiles profile
          WHERE profile.school_id=agent.school_id AND profile.user_id=agent.user_id
            AND profile.person_id=agent.person_id AND profile.status='active'
        ))
        OR (membership.role='student' AND EXISTS (
          SELECT 1 FROM students student
          WHERE student.school_id=agent.school_id AND student.user_id=agent.user_id
            AND student.person_id=agent.person_id
        ))
        OR (membership.role='guardian' AND EXISTS (
          SELECT 1 FROM parents parent
          JOIN guardian_school_profiles profile ON profile.guardian_id=parent.id
          WHERE profile.school_id=agent.school_id AND parent.user_id=agent.user_id
            AND profile.person_id=agent.person_id
        ))
      )
  ) THEN 'active' ELSE 'suspended' END,
  agent.created_at,'auth',agent.user_id::text,1,
  jsonb_build_object('backfilled_from','campus_model_agents.user_id')
FROM campus_model_agents agent
JOIN users user_account ON user_account.id=agent.user_id
WHERE agent.agent_kind='human' AND agent.user_id IS NOT NULL;

-- Approved external assistant connections become delivery endpoints for the same
-- person-stable agent. Provider possession never grants campus authority. This is a
-- migration backfill only; the Agent Channels domain must publish later link/revoke
-- changes through its domain adapter before those endpoints are used by coordination.
INSERT INTO campus_model_agent_endpoints(
  school_id,agent_id,endpoint_kind,provider,external_subject,status,effective_from,effective_until,
  source_domain,source_record_id,source_revision,linked_by_user_id,metadata
)
SELECT connection.school_id,account_endpoint.agent_id,'external_channel',connection.provider,
  connection.external_user_id,
  CASE
    WHEN connection.state='revoked' THEN 'revoked'
    WHEN account_endpoint.status='active' THEN 'active'
    ELSE 'suspended'
  END,
  connection.linked_at,connection.revoked_at,'agent_channels',connection.id::text,connection.revision,
  connection.owner_id,
  jsonb_build_object('connection_id',connection.id,'portal',connection.portal)
FROM agent_channel_connections connection
JOIN campus_model_agent_endpoints account_endpoint
  ON account_endpoint.school_id=connection.school_id
  AND account_endpoint.endpoint_kind='account'
  AND account_endpoint.provider='thatcampus'
  AND account_endpoint.user_id=connection.owner_id
  AND account_endpoint.effective_until IS NULL;

DO $$
DECLARE identity_constraint text;
BEGIN
  SELECT constraint_name INTO identity_constraint
  FROM information_schema.table_constraints
  WHERE table_schema='public' AND table_name='campus_model_agents'
    AND constraint_type='CHECK'
    AND constraint_name IN (
      SELECT constraint_name FROM information_schema.check_constraints
      WHERE check_clause LIKE '%agent_kind%human%user_id%external_ref%'
    )
  LIMIT 1;
  IF identity_constraint IS NULL THEN
    RAISE EXCEPTION 'The legacy campus_model_agents identity constraint was not found';
  END IF;
  EXECUTE format('ALTER TABLE campus_model_agents DROP CONSTRAINT %I',identity_constraint);
END $$;

DROP INDEX campus_model_agents_human_idx;
UPDATE campus_model_agents SET user_id=NULL WHERE agent_kind='human';
ALTER TABLE campus_model_agents
  ADD CONSTRAINT campus_model_agents_human_person_scope_fk
    FOREIGN KEY(school_id,person_id) REFERENCES school_people(school_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_agents_identity_check CHECK(
    (agent_kind='human' AND person_id IS NOT NULL AND user_id IS NULL AND external_ref IS NULL)
    OR
    (agent_kind<>'human' AND person_id IS NULL AND user_id IS NULL
      AND external_ref IS NOT NULL AND length(btrim(external_ref))>0)
  );
CREATE UNIQUE INDEX campus_model_agents_human_person_idx
  ON campus_model_agents(school_id,person_id) WHERE agent_kind='human';

ALTER TABLE campus_model_agent_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_agent_endpoint_transitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE campus_model_agent_endpoints,campus_model_agent_endpoint_transitions FROM PUBLIC;
REVOKE ALL ON FUNCTION guard_campus_model_agent_endpoint_overlap() FROM PUBLIC;
REVOKE ALL ON FUNCTION ensure_staff_profile_person_identity() FROM PUBLIC;

DO $$
DECLARE application_owner text; role_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner
  FROM pg_class WHERE oid='public.students'::regclass;
  EXECUTE format('ALTER TABLE public.campus_model_agent_endpoints OWNER TO %I',application_owner);
  EXECUTE format('ALTER TABLE public.campus_model_agent_endpoint_transitions OWNER TO %I',application_owner);
  EXECUTE format('ALTER FUNCTION public.guard_campus_model_agent_endpoint_overlap() OWNER TO %I',application_owner);
  EXECUTE format('ALTER FUNCTION public.ensure_staff_profile_person_identity() OWNER TO %I',application_owner);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.campus_model_agent_endpoints FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON TABLE public.campus_model_agent_endpoint_transitions FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON FUNCTION public.guard_campus_model_agent_endpoint_overlap() FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON FUNCTION public.ensure_staff_profile_person_identity() FROM %I',role_name);
    END IF;
  END LOOP;
END $$;
