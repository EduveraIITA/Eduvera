-- Canonical responsibility assignments for the responsibility-composed workspace.
--
-- Roles may be used by setup flows as templates, but this table captures the
-- actual effective capability, action, owner, ModelAddress scope and authority
-- source.  It is environment-qualified so a Simulation can diverge without
-- changing Live.  Domain records remain authoritative; this is the reviewed
-- access/coordination contract consumed by application composition APIs.

CREATE TABLE campus_responsibility_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  realm_id uuid NOT NULL REFERENCES operational_realms(id) ON DELETE RESTRICT,
  environment_namespace_id text NOT NULL,
  owner_agent_id uuid NOT NULL,
  capability_key varchar(120) NOT NULL
    CHECK(capability_key ~ '^[a-z][a-z0-9_.-]{1,119}$'),
  action_key varchar(160) NOT NULL
    CHECK(action_key ~ '^[a-z][a-z0-9_.:-]{1,159}$'),
  scope_entity_id uuid NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  effective_schedule jsonb,
  status varchar(16) NOT NULL DEFAULT 'active'
    CHECK(status IN ('offered','active','suspended','completed','revoked')),
  authority_source_kind varchar(40) NOT NULL
    CHECK(authority_source_kind IN (
      'permission_assignment','appointment','delegation','team_responsibility',
      'emergency_mandate','relationship_entitlement'
    )),
  authority_source_ref varchar(240) NOT NULL
    CHECK(length(btrim(authority_source_ref)) BETWEEN 3 AND 240),
  authority_source_revision integer NOT NULL CHECK(authority_source_revision>0),
  fallback_agent_id uuid,
  template_ref varchar(240),
  source_domain varchar(64) NOT NULL
    CHECK(source_domain ~ '^[a-z][a-z0-9_]{1,63}$'),
  source_record_id varchar(240) NOT NULL
    CHECK(length(btrim(source_record_id)) BETWEEN 1 AND 240),
  source_revision integer NOT NULL CHECK(source_revision>0),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(provenance)='object'),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(effective_until IS NULL OR effective_until>effective_from),
  CHECK(fallback_agent_id IS NULL OR fallback_agent_id<>owner_agent_id),
  CHECK(effective_schedule IS NULL OR (
    jsonb_typeof(effective_schedule)='object'
    AND effective_schedule ? 'time_zone'
    AND effective_schedule ? 'weekly_windows'
    AND jsonb_typeof(effective_schedule->'time_zone')='string'
    AND jsonb_typeof(effective_schedule->'weekly_windows')='array'
  )),
  UNIQUE(id,realm_id,environment_namespace_id),
  UNIQUE(realm_id,environment_namespace_id,source_domain,source_record_id),
  FOREIGN KEY(environment_namespace_id,realm_id)
    REFERENCES execution_environment_namespaces(namespace_id,realm_id) ON DELETE RESTRICT,
  FOREIGN KEY(owner_agent_id,school_id)
    REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(fallback_agent_id,school_id)
    REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(scope_entity_id,realm_id,environment_namespace_id)
    REFERENCES campus_model_entities(id,realm_id,environment_namespace_id) ON DELETE RESTRICT
);
CREATE INDEX campus_responsibility_owner_effective_idx
  ON campus_responsibility_assignments(
    realm_id,environment_namespace_id,owner_agent_id,status,effective_from,effective_until
  );
CREATE INDEX campus_responsibility_scope_effective_idx
  ON campus_responsibility_assignments(
    realm_id,environment_namespace_id,scope_entity_id,capability_key,status,effective_from
  );

-- Teams can own one responsibility while a concrete human remains the actor who
-- signs a decision.  Membership is independently effective-dated and never
-- inferred from an organisation-chart node or job title.
CREATE TABLE campus_responsibility_team_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  realm_id uuid NOT NULL REFERENCES operational_realms(id) ON DELETE RESTRICT,
  environment_namespace_id text NOT NULL,
  team_agent_id uuid NOT NULL,
  member_agent_id uuid NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  status varchar(16) NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','suspended','revoked')),
  source_domain varchar(64) NOT NULL
    CHECK(source_domain ~ '^[a-z][a-z0-9_]{1,63}$'),
  source_record_id varchar(240) NOT NULL
    CHECK(length(btrim(source_record_id)) BETWEEN 1 AND 240),
  source_revision integer NOT NULL CHECK(source_revision>0),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(provenance)='object'),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(team_agent_id<>member_agent_id),
  CHECK(effective_until IS NULL OR effective_until>effective_from),
  UNIQUE(id,realm_id,environment_namespace_id),
  UNIQUE(realm_id,environment_namespace_id,source_domain,source_record_id),
  FOREIGN KEY(environment_namespace_id,realm_id)
    REFERENCES execution_environment_namespaces(namespace_id,realm_id) ON DELETE RESTRICT,
  FOREIGN KEY(team_agent_id,school_id)
    REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(member_agent_id,school_id)
    REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT
);
CREATE INDEX campus_responsibility_team_member_effective_idx
  ON campus_responsibility_team_memberships(
    realm_id,environment_namespace_id,member_agent_id,status,effective_from,effective_until
  );

CREATE OR REPLACE FUNCTION guard_campus_responsibility_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE realm_school_id uuid;
DECLARE owner_kind varchar(20);
DECLARE owner_status varchar(16);
DECLARE fallback_kind varchar(20);
BEGIN
  SELECT legacy_school_id INTO realm_school_id FROM operational_realms
  WHERE id=NEW.realm_id AND status IN ('setup','active');
  IF realm_school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Responsibility realm must belong to the same institution'
      USING ERRCODE='23514';
  END IF;
  SELECT agent_kind,status INTO owner_kind,owner_status FROM campus_model_agents
  WHERE id=NEW.owner_agent_id AND school_id=NEW.school_id;
  IF owner_kind IS NULL OR owner_kind NOT IN ('human','team') THEN
    RAISE EXCEPTION 'Responsibility owner must be one stable human or team agent'
      USING ERRCODE='23514';
  END IF;
  IF (owner_status='suspended' AND NEW.status IN ('offered','active'))
    OR (owner_status='revoked' AND NEW.status NOT IN ('completed','revoked')) THEN
    RAISE EXCEPTION 'Responsibility state cannot exceed the current owner-agent state'
      USING ERRCODE='23514';
  END IF;
  IF NEW.fallback_agent_id IS NOT NULL THEN
    SELECT agent_kind INTO fallback_kind FROM campus_model_agents
    WHERE id=NEW.fallback_agent_id AND school_id=NEW.school_id AND status='active';
    IF fallback_kind IS NULL OR fallback_kind NOT IN ('human','team') THEN
      RAISE EXCEPTION 'Responsibility fallback must be one active human or team agent'
        USING ERRCODE='23514';
    END IF;
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM campus_model_entities entity
    WHERE entity.id=NEW.scope_entity_id AND entity.school_id=NEW.school_id
      AND entity.realm_id=NEW.realm_id
      AND entity.environment_namespace_id=NEW.environment_namespace_id
  ) THEN
    RAISE EXCEPTION 'Responsibility scope must be one reviewed ModelAddress in this environment'
      USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.school_id IS DISTINCT FROM OLD.school_id
      OR NEW.realm_id IS DISTINCT FROM OLD.realm_id
      OR NEW.environment_namespace_id IS DISTINCT FROM OLD.environment_namespace_id
      OR NEW.owner_agent_id IS DISTINCT FROM OLD.owner_agent_id
      OR NEW.capability_key IS DISTINCT FROM OLD.capability_key
      OR NEW.action_key IS DISTINCT FROM OLD.action_key
      OR NEW.scope_entity_id IS DISTINCT FROM OLD.scope_entity_id
      OR NEW.source_domain IS DISTINCT FROM OLD.source_domain
      OR NEW.source_record_id IS DISTINCT FROM OLD.source_record_id THEN
      RAISE EXCEPTION 'Responsibility identity is immutable; close it and assign a new responsibility'
        USING ERRCODE='23514';
    END IF;
    NEW.revision:=OLD.revision+1;
    NEW.updated_at:=now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campus_responsibility_assignment_guard
  BEFORE INSERT OR UPDATE ON campus_responsibility_assignments
  FOR EACH ROW EXECUTE FUNCTION guard_campus_responsibility_assignment();

CREATE OR REPLACE FUNCTION guard_campus_responsibility_team_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE realm_school_id uuid;
BEGIN
  SELECT legacy_school_id INTO realm_school_id FROM operational_realms
  WHERE id=NEW.realm_id AND status IN ('setup','active');
  IF realm_school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Team-membership realm must belong to the same institution'
      USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM campus_model_agents
    WHERE id=NEW.team_agent_id AND school_id=NEW.school_id
      AND agent_kind='team' AND status='active') THEN
    RAISE EXCEPTION 'Responsibility team must be one active team agent'
      USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM campus_model_agents
    WHERE id=NEW.member_agent_id AND school_id=NEW.school_id
      AND agent_kind='human' AND status='active') THEN
    RAISE EXCEPTION 'Responsibility team member must be one active human agent'
      USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.school_id IS DISTINCT FROM OLD.school_id
      OR NEW.realm_id IS DISTINCT FROM OLD.realm_id
      OR NEW.environment_namespace_id IS DISTINCT FROM OLD.environment_namespace_id
      OR NEW.team_agent_id IS DISTINCT FROM OLD.team_agent_id
      OR NEW.member_agent_id IS DISTINCT FROM OLD.member_agent_id
      OR NEW.source_domain IS DISTINCT FROM OLD.source_domain
      OR NEW.source_record_id IS DISTINCT FROM OLD.source_record_id THEN
      RAISE EXCEPTION 'Team membership identity is immutable; close it and create another interval'
        USING ERRCODE='23514';
    END IF;
    NEW.revision:=OLD.revision+1;
    NEW.updated_at:=now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campus_responsibility_team_membership_guard
  BEFORE INSERT OR UPDATE ON campus_responsibility_team_memberships
  FOR EACH ROW EXECUTE FUNCTION guard_campus_responsibility_team_membership();

-- Register ModelAddresses for current scoped access records that predate the
-- canonical responsibility contract.  These are compatibility registrations;
-- their owning domains remain authoritative.
INSERT INTO campus_model_entities(
  school_id,realm_id,environment_namespace_id,kind,domain,domain_id,label,
  lifecycle_state,source_revision,metadata
)
SELECT event.school_id,realm.id,namespace.namespace_id,'event','events',event.id::text,
  event.title,CASE WHEN event.status IN ('cancelled','completed') THEN 'inactive' ELSE 'active' END,
  event.revision,jsonb_build_object('registered_by','responsibility_workspace.v1')
FROM campus_events event
JOIN operational_realms realm ON realm.legacy_school_id=event.school_id
JOIN execution_environment_namespaces namespace
  ON namespace.realm_id=realm.id AND namespace.environment_kind='live'
ON CONFLICT(realm_id,environment_namespace_id,domain,domain_id) DO NOTHING;

INSERT INTO campus_model_entities(
  school_id,realm_id,environment_namespace_id,kind,domain,domain_id,label,
  lifecycle_state,source_revision,metadata
)
SELECT assessment.school_id,realm.id,namespace.namespace_id,'assessment','assessments',assessment.id::text,
  assessment.title,CASE WHEN assessment.status='cancelled' THEN 'inactive' ELSE 'active' END,
  assessment.revision,jsonb_build_object('registered_by','responsibility_workspace.v1')
FROM assessments assessment
JOIN operational_realms realm ON realm.legacy_school_id=assessment.school_id
JOIN execution_environment_namespaces namespace
  ON namespace.realm_id=realm.id AND namespace.environment_kind='live'
ON CONFLICT(realm_id,environment_namespace_id,domain,domain_id) DO NOTHING;

INSERT INTO campus_model_entities(
  school_id,realm_id,environment_namespace_id,kind,domain,domain_id,label,
  lifecycle_state,source_revision,metadata
)
SELECT trip.school_id,realm.id,namespace.namespace_id,'trip','transport',trip.id::text,
  route.name,CASE WHEN trip.state IN ('planned','boarding','in_progress') THEN 'active' ELSE 'inactive' END,
  trip.revision,jsonb_build_object('registered_by','responsibility_workspace.v1')
FROM transport_trips trip
JOIN transport_routes route ON route.id=trip.route_id AND route.school_id=trip.school_id
JOIN operational_realms realm ON realm.legacy_school_id=trip.school_id
JOIN execution_environment_namespaces namespace
  ON namespace.realm_id=realm.id AND namespace.environment_kind='live'
ON CONFLICT(realm_id,environment_namespace_id,domain,domain_id) DO NOTHING;

-- Operational domains remain authoritative for an assignment.  This projector
-- translates every effective assignment into one action-level responsibility in
-- the same database transaction as the domain write.  It deliberately does not
-- infer work from membership or job title.  Roles remain templates whose current
-- revision is retained as provenance, while the concrete source row and person
-- remain the authority-bearing assignment.
CREATE FUNCTION ensure_live_responsibility_scope(
  p_school_id uuid,
  p_context_kind text,
  p_scope_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE resolved_realm_id uuid;
DECLARE resolved_namespace_id text;
DECLARE resolved_kind text;
DECLARE resolved_domain text;
DECLARE resolved_label text;
DECLARE resolved_lifecycle text;
DECLARE resolved_source_revision integer;
DECLARE resolved_entity_id uuid;
BEGIN
  SELECT realm.id,namespace.namespace_id
  INTO resolved_realm_id,resolved_namespace_id
  FROM operational_realms realm
  JOIN execution_environment_namespaces namespace
    ON namespace.realm_id=realm.id AND namespace.environment_kind='live'
      AND namespace.status='active'
  WHERE realm.legacy_school_id=p_school_id AND realm.status IN ('setup','active');
  IF resolved_realm_id IS NULL OR resolved_namespace_id IS NULL THEN
    RAISE EXCEPTION 'The assignment institution has no active Live operational realm'
      USING ERRCODE='23514';
  END IF;

  IF p_context_kind='institution' THEN
    IF p_scope_id IS DISTINCT FROM p_school_id THEN
      RAISE EXCEPTION 'Institution responsibility scope must identify its own institution'
        USING ERRCODE='23514';
    END IF;
    SELECT 'institution','institutions',school.name,'active',1
    INTO resolved_kind,resolved_domain,resolved_label,resolved_lifecycle,resolved_source_revision
    FROM schools school WHERE school.id=p_school_id;
  ELSIF p_context_kind='class' THEN
    SELECT 'class','academic_structure','Class '||section.grade||section.section,'active',section.revision
    INTO resolved_kind,resolved_domain,resolved_label,resolved_lifecycle,resolved_source_revision
    FROM class_sections section WHERE section.school_id=p_school_id AND section.id=p_scope_id;
  ELSIF p_context_kind='event' THEN
    SELECT 'event','events',event.title,
      CASE WHEN event.status='draft' THEN 'planned'
        WHEN event.status IN ('cancelled','completed') THEN 'inactive' ELSE 'active' END,
      event.revision
    INTO resolved_kind,resolved_domain,resolved_label,resolved_lifecycle,resolved_source_revision
    FROM campus_events event WHERE event.school_id=p_school_id AND event.id=p_scope_id;
  ELSIF p_context_kind='assessment' THEN
    SELECT 'assessment','assessments',assessment.title,
      CASE WHEN assessment.status='draft' THEN 'planned'
        WHEN assessment.status='cancelled' THEN 'inactive' ELSE 'active' END,
      assessment.revision
    INTO resolved_kind,resolved_domain,resolved_label,resolved_lifecycle,resolved_source_revision
    FROM assessments assessment
    WHERE assessment.school_id=p_school_id AND assessment.id=p_scope_id;
  ELSIF p_context_kind='trip' THEN
    SELECT 'trip','transport',route.name,
      CASE WHEN trip.state IN ('planned','boarding','in_progress') THEN 'active' ELSE 'inactive' END,
      trip.revision
    INTO resolved_kind,resolved_domain,resolved_label,resolved_lifecycle,resolved_source_revision
    FROM transport_trips trip
    JOIN transport_routes route ON route.id=trip.route_id AND route.school_id=trip.school_id
    WHERE trip.school_id=p_school_id AND trip.id=p_scope_id;
  ELSE
    RAISE EXCEPTION 'Unsupported responsibility scope kind: %',p_context_kind
      USING ERRCODE='23514';
  END IF;

  IF resolved_kind IS NULL THEN
    RAISE EXCEPTION 'The responsibility scope does not exist in its owning domain'
      USING ERRCODE='23514';
  END IF;

  INSERT INTO campus_model_entities(
    school_id,realm_id,environment_namespace_id,kind,domain,domain_id,label,
    lifecycle_state,source_revision,metadata
  ) VALUES(
    p_school_id,resolved_realm_id,resolved_namespace_id,resolved_kind,resolved_domain,
    p_scope_id::text,resolved_label,resolved_lifecycle,resolved_source_revision,
    jsonb_build_object('registered_by','responsibility_assignment_projection.v1')
  ) ON CONFLICT(realm_id,environment_namespace_id,domain,domain_id) DO UPDATE SET
    kind=EXCLUDED.kind,
    label=EXCLUDED.label,
    lifecycle_state=EXCLUDED.lifecycle_state,
    source_revision=GREATEST(campus_model_entities.source_revision,EXCLUDED.source_revision),
    metadata=campus_model_entities.metadata||EXCLUDED.metadata,
    revision=CASE WHEN campus_model_entities.kind IS DISTINCT FROM EXCLUDED.kind
        OR campus_model_entities.label IS DISTINCT FROM EXCLUDED.label
        OR campus_model_entities.lifecycle_state IS DISTINCT FROM EXCLUDED.lifecycle_state
        OR campus_model_entities.source_revision<EXCLUDED.source_revision
      THEN campus_model_entities.revision+1 ELSE campus_model_entities.revision END,
    updated_at=CASE WHEN campus_model_entities.kind IS DISTINCT FROM EXCLUDED.kind
        OR campus_model_entities.label IS DISTINCT FROM EXCLUDED.label
        OR campus_model_entities.lifecycle_state IS DISTINCT FROM EXCLUDED.lifecycle_state
        OR campus_model_entities.source_revision<EXCLUDED.source_revision
      THEN now() ELSE campus_model_entities.updated_at END
  RETURNING id INTO resolved_entity_id;
  RETURN resolved_entity_id;
END $$;

CREATE FUNCTION reconcile_campus_responsibility_binding_source(
  p_school_id uuid,
  p_source_kind text,
  p_source_id uuid,
  p_transition_revision integer DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE binding record;
DECLARE permission_key text;
DECLARE resolved_realm_id uuid;
DECLARE resolved_namespace_id text;
DECLARE resolved_agent_id uuid;
DECLARE resolved_agent_status text;
DECLARE resolved_profile_status text;
DECLARE resolved_scope_entity_id uuid;
DECLARE school_timezone text;
DECLARE desired_status text;
DECLARE desired_source_record_id text;
DECLARE desired_source_record_ids text[]:=ARRAY[]::text[];
DECLARE desired_effective_from timestamptz;
DECLARE desired_effective_until timestamptz;
BEGIN
  IF p_source_kind NOT IN (
    'assignment','class_assignment','event_assignment','assessment_assignment','transport_trip'
  ) THEN
    RAISE EXCEPTION 'Unsupported operational responsibility source: %',p_source_kind
      USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'responsibility-source:'||p_school_id::text||':'||p_source_kind||':'||p_source_id::text,0
  ));
  SELECT school.timezone,realm.id,namespace.namespace_id
  INTO school_timezone,resolved_realm_id,resolved_namespace_id
  FROM schools school
  JOIN operational_realms realm ON realm.legacy_school_id=school.id
    AND realm.status IN ('setup','active')
  JOIN execution_environment_namespaces namespace ON namespace.realm_id=realm.id
    AND namespace.environment_kind='live' AND namespace.status='active'
  WHERE school.id=p_school_id;
  IF resolved_realm_id IS NULL OR resolved_namespace_id IS NULL THEN
    RAISE EXCEPTION 'The assignment institution has no active Live operational realm'
      USING ERRCODE='23514';
  END IF;

  FOR binding IN
    SELECT access.*,role.revision AS template_revision
    FROM staff_role_bindings access
    JOIN staff_responsibility_types role
      ON role.school_id=access.school_id AND role.id=access.role_id
    WHERE access.school_id=p_school_id AND access.source_kind=p_source_kind
      AND access.source_id=p_source_id
    ORDER BY access.user_id,access.role_id,access.scope_id
  LOOP
    -- The responsibility belongs to the stable human agent, not to an account
    -- endpoint.  Closing a login must never rewrite or transfer the person's
    -- operational appointment.  Every supported assignment source is a staff
    -- assignment, so its staff-person identity is the canonical bridge.
    SELECT agent.id,agent.status,profile.status
    INTO resolved_agent_id,resolved_agent_status,resolved_profile_status
    FROM staff_profiles profile
    JOIN campus_model_agents agent ON agent.school_id=profile.school_id
      AND agent.person_id=profile.person_id AND agent.agent_kind='human'
    WHERE profile.school_id=binding.school_id AND profile.user_id=binding.user_id
    ORDER BY CASE agent.status WHEN 'active' THEN 0 WHEN 'suspended' THEN 1 ELSE 2 END,
      agent.created_at
    LIMIT 1;
    IF resolved_agent_id IS NULL THEN
      CONTINUE;
    END IF;
    resolved_scope_entity_id:=ensure_live_responsibility_scope(
      binding.school_id,binding.context_kind,binding.scope_id
    );
    desired_status:=CASE
      WHEN binding.status='completed' THEN 'completed'
      WHEN binding.status NOT IN ('active','offered') THEN 'revoked'
      WHEN resolved_agent_status='revoked' THEN 'revoked'
      WHEN resolved_agent_status='suspended' OR resolved_profile_status<>'active'
        OR NOT binding.role_active THEN 'suspended'
      WHEN binding.status='active' THEN 'active'
      ELSE 'offered' END;
    desired_effective_from:=binding.starts_on::timestamp AT TIME ZONE school_timezone;
    desired_effective_until:=CASE WHEN binding.ends_on IS NULL THEN NULL
      ELSE (binding.ends_on+1)::timestamp AT TIME ZONE school_timezone END;

    FOREACH permission_key IN ARRAY binding.permissions LOOP
      desired_source_record_id:=concat_ws(':',
        'binding',binding.source_kind,binding.source_id::text,
        encode(digest(concat_ws(':',
          resolved_agent_id::text,binding.user_id::text,binding.context_kind,
          binding.scope_id::text,permission_key
        ),'sha256'),'hex')
      );
      desired_source_record_ids:=array_append(desired_source_record_ids,desired_source_record_id);
      INSERT INTO campus_responsibility_assignments(
        school_id,realm_id,environment_namespace_id,owner_agent_id,
        capability_key,action_key,scope_entity_id,effective_from,effective_until,status,
        authority_source_kind,authority_source_ref,authority_source_revision,
        template_ref,source_domain,source_record_id,source_revision,provenance
      ) VALUES(
        binding.school_id,resolved_realm_id,resolved_namespace_id,resolved_agent_id,
        split_part(permission_key,'.',1),permission_key,resolved_scope_entity_id,
        desired_effective_from,desired_effective_until,desired_status,
        'permission_assignment',
        concat_ws(':',binding.source_kind,binding.source_id::text,binding.user_id::text),
        binding.revision,'access-template:'||binding.role_id::text,'access_assignments',
        desired_source_record_id,binding.revision,
        jsonb_strip_nulls(jsonb_build_object(
          'projection_contract','responsibility_assignment.v1',
          'source_kind',binding.source_kind,
          'source_id',binding.source_id,
          'source_user_id',binding.user_id,
          'scope_label',binding.scope_label,
          'subject_id',binding.subject_id,
          'template_id',binding.role_id,
          'template_revision',binding.template_revision,
          'assignment_status',binding.status
        ))
      ) ON CONFLICT(realm_id,environment_namespace_id,source_domain,source_record_id)
      DO UPDATE SET
        effective_from=EXCLUDED.effective_from,
        effective_until=EXCLUDED.effective_until,
        status=EXCLUDED.status,
        authority_source_ref=EXCLUDED.authority_source_ref,
        authority_source_revision=EXCLUDED.authority_source_revision,
        template_ref=EXCLUDED.template_ref,
        source_revision=EXCLUDED.source_revision,
        provenance=EXCLUDED.provenance
      WHERE campus_responsibility_assignments.effective_from IS DISTINCT FROM EXCLUDED.effective_from
        OR campus_responsibility_assignments.effective_until IS DISTINCT FROM EXCLUDED.effective_until
        OR campus_responsibility_assignments.status IS DISTINCT FROM EXCLUDED.status
        OR campus_responsibility_assignments.authority_source_ref IS DISTINCT FROM EXCLUDED.authority_source_ref
        OR campus_responsibility_assignments.authority_source_revision IS DISTINCT FROM EXCLUDED.authority_source_revision
        OR campus_responsibility_assignments.template_ref IS DISTINCT FROM EXCLUDED.template_ref
        OR campus_responsibility_assignments.source_revision IS DISTINCT FROM EXCLUDED.source_revision
        OR campus_responsibility_assignments.provenance IS DISTINCT FROM EXCLUDED.provenance;
    END LOOP;
  END LOOP;

  UPDATE campus_responsibility_assignments responsibility SET
    status='revoked',
    authority_source_revision=GREATEST(
      responsibility.authority_source_revision,
      COALESCE(p_transition_revision,responsibility.authority_source_revision)
    ),
    source_revision=GREATEST(
      responsibility.source_revision,
      COALESCE(p_transition_revision,responsibility.source_revision)
    ),
    provenance=responsibility.provenance||jsonb_strip_nulls(jsonb_build_object(
      'projected_revocation_revision',p_transition_revision
    ))
  WHERE responsibility.school_id=p_school_id
    AND responsibility.realm_id=resolved_realm_id
    AND responsibility.environment_namespace_id=resolved_namespace_id
    AND responsibility.source_domain='access_assignments'
    AND responsibility.provenance->>'source_kind'=p_source_kind
    AND responsibility.provenance->>'source_id'=p_source_id::text
    AND NOT (responsibility.source_record_id=ANY(desired_source_record_ids))
    AND responsibility.status IN ('active','offered','suspended');
END $$;

CREATE FUNCTION reconcile_campus_responsibility_role(
  p_school_id uuid,
  p_role_id uuid,
  p_transition_revision integer DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE source record;
BEGIN
  FOR source IN
    SELECT DISTINCT binding.source_kind,binding.source_id
    FROM staff_role_bindings binding
    WHERE binding.school_id=p_school_id AND binding.role_id=p_role_id
    ORDER BY binding.source_kind,binding.source_id
  LOOP
    PERFORM reconcile_campus_responsibility_binding_source(
      p_school_id,source.source_kind,source.source_id,p_transition_revision
    );
  END LOOP;
END $$;

-- An accepted timetable substitution is a bounded delegation of the normal
-- class-work actions for one exact occurrence.  The Staff domain remains the
-- authority for the cover decision; this projection makes the accepted cover
-- visible to workspace composition without turning an offer or a generic
-- administrator relationship into operational authority.
CREATE FUNCTION reconcile_campus_responsibility_substitution(
  p_school_id uuid,
  p_substitution_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE substitution record;
DECLARE permission_key text;
DECLARE resolved_realm_id uuid;
DECLARE resolved_namespace_id text;
DECLARE resolved_agent_id uuid;
DECLARE resolved_agent_status text;
DECLARE resolved_profile_status text;
DECLARE resolved_scope_entity_id uuid;
DECLARE school_timezone text;
DECLARE desired_status text;
DECLARE desired_source_record_id text;
DECLARE desired_source_record_ids text[]:=ARRAY[]::text[];
DECLARE desired_effective_from timestamptz;
DECLARE desired_effective_until timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'responsibility-substitution:'||p_school_id::text||':'||p_substitution_id::text,0
  ));
  SELECT cover.*,school.timezone
  INTO substitution
  FROM staff_timetable_substitutions cover
  JOIN schools school ON school.id=cover.school_id
  WHERE cover.school_id=p_school_id AND cover.id=p_substitution_id;

  SELECT realm.id,namespace.namespace_id
  INTO resolved_realm_id,resolved_namespace_id
  FROM operational_realms realm
  JOIN execution_environment_namespaces namespace
    ON namespace.realm_id=realm.id AND namespace.environment_kind='live'
      AND namespace.status='active'
  WHERE realm.legacy_school_id=p_school_id AND realm.status IN ('setup','active');
  IF resolved_realm_id IS NULL OR resolved_namespace_id IS NULL THEN
    RAISE EXCEPTION 'The substitution institution has no active Live operational realm'
      USING ERRCODE='23514';
  END IF;

  IF substitution.id IS NOT NULL THEN
    SELECT agent.id,agent.status,profile.status
    INTO resolved_agent_id,resolved_agent_status,resolved_profile_status
    FROM staff_profiles profile
    JOIN campus_model_agents agent ON agent.school_id=profile.school_id
      AND agent.person_id=profile.person_id AND agent.agent_kind='human'
    WHERE profile.school_id=substitution.school_id
      AND profile.id=substitution.replacement_staff_profile_id
    ORDER BY CASE agent.status WHEN 'active' THEN 0 WHEN 'suspended' THEN 1 ELSE 2 END,
      agent.created_at
    LIMIT 1;

    IF resolved_agent_id IS NOT NULL THEN
      resolved_scope_entity_id:=ensure_live_responsibility_scope(
        substitution.school_id,'class',substitution.class_section_id
      );
      desired_status:=CASE
        WHEN substitution.state<>'effective' THEN 'revoked'
        WHEN resolved_agent_status='revoked' THEN 'revoked'
        WHEN resolved_agent_status='suspended' OR resolved_profile_status<>'active' THEN 'suspended'
        WHEN resolved_agent_status='active' THEN 'active'
        ELSE 'revoked' END;
      desired_effective_from:=(substitution.duty_date+substitution.starts_at)
        AT TIME ZONE substitution.timezone;
      desired_effective_until:=(substitution.duty_date+substitution.ends_at)
        AT TIME ZONE substitution.timezone;

      FOREACH permission_key IN ARRAY ARRAY[
        'attendance.view','attendance.record','photo.use','timetable.view',
        'followups.manage','messages.view','messages.send','groups.create'
      ]::text[] LOOP
        desired_source_record_id:=concat_ws(':',
          'timetable_substitution',substitution.id::text,resolved_agent_id::text,permission_key
        );
        desired_source_record_ids:=array_append(
          desired_source_record_ids,desired_source_record_id
        );
        INSERT INTO campus_responsibility_assignments(
          school_id,realm_id,environment_namespace_id,owner_agent_id,
          capability_key,action_key,scope_entity_id,effective_from,effective_until,status,
          authority_source_kind,authority_source_ref,authority_source_revision,
          source_domain,source_record_id,source_revision,provenance
        ) VALUES(
          substitution.school_id,resolved_realm_id,resolved_namespace_id,resolved_agent_id,
          split_part(permission_key,'.',1),permission_key,resolved_scope_entity_id,
          desired_effective_from,desired_effective_until,desired_status,
          'delegation','staff_coverage_task:'||substitution.coverage_task_id::text,
          substitution.coverage_task_revision,'staff_coverage',desired_source_record_id,
          substitution.coverage_task_revision,
          jsonb_build_object(
            'projection_contract','accepted_timetable_substitution.v1',
            'substitution_id',substitution.id,
            'coverage_task_id',substitution.coverage_task_id,
            'coverage_task_revision',substitution.coverage_task_revision,
            'source_occurrence_key',substitution.source_occurrence_key,
            'source_kind',substitution.source_kind,
            'source_record_id',substitution.source_record_id,
            'source_revision',substitution.source_revision,
            'source_version',substitution.source_version,
            'original_teacher_user_id',substitution.original_teacher_user_id,
            'replacement_staff_profile_id',substitution.replacement_staff_profile_id,
            'accepted_by',substitution.accepted_by,
            'accepted_at',substitution.accepted_at,
            'substitution_state',substitution.state
          )
        ) ON CONFLICT(realm_id,environment_namespace_id,source_domain,source_record_id)
        DO UPDATE SET
          effective_from=EXCLUDED.effective_from,
          effective_until=EXCLUDED.effective_until,
          status=EXCLUDED.status,
          authority_source_ref=EXCLUDED.authority_source_ref,
          authority_source_revision=EXCLUDED.authority_source_revision,
          source_revision=EXCLUDED.source_revision,
          provenance=EXCLUDED.provenance
        WHERE campus_responsibility_assignments.effective_from IS DISTINCT FROM EXCLUDED.effective_from
          OR campus_responsibility_assignments.effective_until IS DISTINCT FROM EXCLUDED.effective_until
          OR campus_responsibility_assignments.status IS DISTINCT FROM EXCLUDED.status
          OR campus_responsibility_assignments.authority_source_ref IS DISTINCT FROM EXCLUDED.authority_source_ref
          OR campus_responsibility_assignments.authority_source_revision IS DISTINCT FROM EXCLUDED.authority_source_revision
          OR campus_responsibility_assignments.source_revision IS DISTINCT FROM EXCLUDED.source_revision
          OR campus_responsibility_assignments.provenance IS DISTINCT FROM EXCLUDED.provenance;
      END LOOP;
    END IF;
  END IF;

  UPDATE campus_responsibility_assignments responsibility SET
    status='revoked',
    provenance=responsibility.provenance||jsonb_build_object(
      'projected_revocation_reason',
      CASE WHEN substitution.id IS NULL THEN 'source_missing'
        WHEN substitution.state<>'effective' THEN 'substitution_closed'
        WHEN resolved_agent_id IS NULL THEN 'owner_agent_missing'
        ELSE 'permission_removed' END
    )
  WHERE responsibility.school_id=p_school_id
    AND responsibility.realm_id=resolved_realm_id
    AND responsibility.environment_namespace_id=resolved_namespace_id
    AND responsibility.source_domain='staff_coverage'
    AND responsibility.provenance->>'substitution_id'=p_substitution_id::text
    AND NOT (responsibility.source_record_id=ANY(desired_source_record_ids))
    AND responsibility.status IN ('active','offered','suspended');
END $$;

CREATE FUNCTION reconcile_campus_responsibility_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE affected_school_id uuid;
DECLARE affected_source_id uuid;
DECLARE affected_revision integer;
DECLARE affected_source_kind text;
DECLARE source record;
BEGIN
  IF TG_TABLE_NAME='staff_responsibility_types' THEN
    affected_school_id:=CASE WHEN TG_OP='DELETE' THEN OLD.school_id ELSE NEW.school_id END;
    PERFORM reconcile_campus_responsibility_role(
      affected_school_id,
      CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END,
      CASE WHEN TG_OP='DELETE' THEN OLD.revision ELSE NEW.revision END
    );
    RETURN NULL;
  ELSIF TG_TABLE_NAME='staff_responsibility_assignments' THEN
    affected_school_id:=CASE WHEN TG_OP='DELETE' THEN OLD.school_id ELSE NEW.school_id END;
    affected_source_kind:='assignment';
    affected_source_id:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
    affected_revision:=CASE WHEN TG_OP='DELETE' THEN OLD.revision ELSE NEW.revision END;
  ELSIF TG_TABLE_NAME='class_section_staff_assignments' THEN
    affected_school_id:=CASE WHEN TG_OP='DELETE' THEN OLD.school_id ELSE NEW.school_id END;
    affected_source_kind:='class_assignment';
    affected_source_id:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
    affected_revision:=CASE WHEN TG_OP='DELETE' THEN OLD.access_revision ELSE NEW.access_revision END;
  ELSIF TG_TABLE_NAME='campus_event_staff' THEN
    IF TG_OP='UPDATE' AND (OLD.school_id,OLD.event_id) IS DISTINCT FROM (NEW.school_id,NEW.event_id) THEN
      PERFORM reconcile_campus_responsibility_binding_source(
        OLD.school_id,'event_assignment',OLD.event_id,OLD.access_revision
      );
    END IF;
    affected_school_id:=CASE WHEN TG_OP='DELETE' THEN OLD.school_id ELSE NEW.school_id END;
    affected_source_kind:='event_assignment';
    affected_source_id:=CASE WHEN TG_OP='DELETE' THEN OLD.event_id ELSE NEW.event_id END;
    affected_revision:=CASE WHEN TG_OP='DELETE' THEN OLD.access_revision ELSE NEW.access_revision END;
  ELSIF TG_TABLE_NAME='assessment_staff_assignments' THEN
    IF TG_OP='UPDATE' AND (OLD.school_id,OLD.assessment_id) IS DISTINCT FROM (NEW.school_id,NEW.assessment_id) THEN
      PERFORM reconcile_campus_responsibility_binding_source(
        OLD.school_id,'assessment_assignment',OLD.assessment_id,OLD.access_revision
      );
    END IF;
    affected_school_id:=CASE WHEN TG_OP='DELETE' THEN OLD.school_id ELSE NEW.school_id END;
    affected_source_kind:='assessment_assignment';
    affected_source_id:=CASE WHEN TG_OP='DELETE' THEN OLD.assessment_id ELSE NEW.assessment_id END;
    affected_revision:=CASE WHEN TG_OP='DELETE' THEN OLD.access_revision ELSE NEW.access_revision END;
  ELSIF TG_TABLE_NAME='transport_trips' THEN
    affected_school_id:=CASE WHEN TG_OP='DELETE' THEN OLD.school_id ELSE NEW.school_id END;
    affected_source_kind:='transport_trip';
    affected_source_id:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
    affected_revision:=CASE WHEN TG_OP='DELETE' THEN OLD.revision ELSE NEW.revision END;
  ELSIF TG_TABLE_NAME='staff_timetable_substitutions' THEN
    PERFORM reconcile_campus_responsibility_substitution(NEW.school_id,NEW.id);
    RETURN NULL;
  ELSIF TG_TABLE_NAME='transport_routes' THEN
    FOR source IN
      SELECT trip.school_id,trip.id,trip.revision
      FROM transport_trips trip
      WHERE trip.school_id=NEW.school_id AND trip.route_id=NEW.id
      ORDER BY trip.id
    LOOP
      PERFORM ensure_live_responsibility_scope(source.school_id,'trip',source.id);
      PERFORM reconcile_campus_responsibility_binding_source(
        source.school_id,'transport_trip',source.id,source.revision
      );
    END LOOP;
    RETURN NULL;
  ELSIF TG_TABLE_NAME='campus_events' THEN
    affected_school_id:=NEW.school_id;
    PERFORM ensure_live_responsibility_scope(affected_school_id,'event',NEW.id);
    PERFORM reconcile_campus_responsibility_binding_source(
      affected_school_id,'event_assignment',NEW.id,NEW.revision
    );
    RETURN NULL;
  ELSIF TG_TABLE_NAME='assessments' THEN
    affected_school_id:=NEW.school_id;
    PERFORM ensure_live_responsibility_scope(affected_school_id,'assessment',NEW.id);
    PERFORM reconcile_campus_responsibility_binding_source(
      affected_school_id,'assessment_assignment',NEW.id,NEW.revision
    );
    RETURN NULL;
  ELSIF TG_TABLE_NAME='class_sections' THEN
    affected_school_id:=NEW.school_id;
    PERFORM ensure_live_responsibility_scope(affected_school_id,'class',NEW.id);
    RETURN NULL;
  ELSIF TG_TABLE_NAME='schools' THEN
    PERFORM ensure_live_responsibility_scope(NEW.id,'institution',NEW.id);
    RETURN NULL;
  ELSIF TG_TABLE_NAME='staff_profiles' THEN
    FOR source IN
      WITH profile_accounts AS (
        SELECT OLD.school_id AS school_id,OLD.user_id AS user_id
        WHERE OLD.user_id IS NOT NULL
        UNION
        SELECT NEW.school_id,NEW.user_id WHERE NEW.user_id IS NOT NULL
      ), affected AS (
        SELECT assignment.school_id,'assignment'::text AS source_kind,
          assignment.id AS source_id,assignment.revision
        FROM staff_responsibility_assignments assignment
        WHERE assignment.staff_profile_id=NEW.id
        UNION ALL
        SELECT assignment.school_id,'class_assignment',assignment.id,assignment.access_revision
        FROM class_section_staff_assignments assignment
        JOIN profile_accounts account ON account.school_id=assignment.school_id
          AND account.user_id=assignment.user_id
        UNION ALL
        SELECT assignment.school_id,'event_assignment',assignment.event_id,assignment.access_revision
        FROM campus_event_staff assignment
        JOIN profile_accounts account ON account.school_id=assignment.school_id
          AND account.user_id=assignment.user_id
        UNION ALL
        SELECT assignment.school_id,'assessment_assignment',assignment.assessment_id,
          assignment.access_revision
        FROM assessment_staff_assignments assignment
        JOIN profile_accounts account ON account.school_id=assignment.school_id
          AND account.user_id=assignment.user_id
        UNION ALL
        SELECT trip.school_id,'transport_trip',trip.id,trip.revision
        FROM transport_trips trip
        JOIN profile_accounts account ON account.school_id=trip.school_id
          AND account.user_id IN (trip.assigned_collector_user_id,trip.backup_collector_user_id)
      )
      SELECT affected.school_id,affected.source_kind,affected.source_id,max(affected.revision) AS revision
      FROM affected
      GROUP BY affected.school_id,affected.source_kind,affected.source_id
      ORDER BY affected.school_id,affected.source_kind,affected.source_id
    LOOP
      PERFORM reconcile_campus_responsibility_binding_source(
        source.school_id,source.source_kind,source.source_id,source.revision
      );
    END LOOP;
    FOR source IN
      SELECT substitution.school_id,substitution.id
      FROM staff_timetable_substitutions substitution
      WHERE substitution.replacement_staff_profile_id=NEW.id
      ORDER BY substitution.id
    LOOP
      PERFORM reconcile_campus_responsibility_substitution(
        source.school_id,source.id
      );
    END LOOP;
    RETURN NULL;
  ELSIF TG_TABLE_NAME='campus_model_agents' THEN
    IF NEW.agent_kind<>'human' OR NEW.person_id IS NULL THEN RETURN NULL; END IF;
    FOR source IN
      SELECT DISTINCT binding.school_id,binding.source_kind,binding.source_id
      FROM staff_profiles profile
      JOIN staff_role_bindings binding ON binding.school_id=profile.school_id
        AND binding.user_id=profile.user_id
      WHERE profile.school_id=NEW.school_id AND profile.person_id=NEW.person_id
      ORDER BY binding.school_id,binding.source_kind,binding.source_id
    LOOP
      PERFORM reconcile_campus_responsibility_binding_source(
        source.school_id,source.source_kind,source.source_id,NULL
      );
    END LOOP;
    FOR source IN
      SELECT substitution.school_id,substitution.id
      FROM staff_profiles profile
      JOIN staff_timetable_substitutions substitution
        ON substitution.school_id=profile.school_id
        AND substitution.replacement_staff_profile_id=profile.id
      WHERE profile.school_id=NEW.school_id AND profile.person_id=NEW.person_id
      ORDER BY substitution.id
    LOOP
      PERFORM reconcile_campus_responsibility_substitution(
        source.school_id,source.id
      );
    END LOOP;
    RETURN NULL;
  ELSE
    RAISE EXCEPTION 'Unsupported responsibility projection trigger table: %',TG_TABLE_NAME
      USING ERRCODE='23514';
  END IF;
  PERFORM reconcile_campus_responsibility_binding_source(
    affected_school_id,affected_source_kind,affected_source_id,affected_revision
  );
  RETURN NULL;
END $$;

-- Seed the canonical projection once, then keep it current at every supported
-- authoritative writer.  The triggers execute inside the writer's transaction:
-- a failed projection rolls the domain mutation back instead of leaving a stale
-- or partially visible workspace.
DO $$ DECLARE source record;
BEGIN
  FOR source IN
    SELECT DISTINCT binding.school_id,binding.source_kind,binding.source_id
    FROM staff_role_bindings binding
    ORDER BY binding.school_id,binding.source_kind,binding.source_id
  LOOP
    PERFORM reconcile_campus_responsibility_binding_source(
      source.school_id,source.source_kind,source.source_id,NULL
    );
  END LOOP;
  FOR source IN
    SELECT substitution.school_id,substitution.id
    FROM staff_timetable_substitutions substitution
    ORDER BY substitution.school_id,substitution.id
  LOOP
    PERFORM reconcile_campus_responsibility_substitution(
      source.school_id,source.id
    );
  END LOOP;
END $$;

CREATE TRIGGER responsibility_projection_staff_assignment
  AFTER INSERT OR UPDATE OR DELETE ON staff_responsibility_assignments
  FOR EACH ROW EXECUTE FUNCTION reconcile_campus_responsibility_write();
CREATE TRIGGER responsibility_projection_class_assignment
  AFTER INSERT OR UPDATE OR DELETE ON class_section_staff_assignments
  FOR EACH ROW EXECUTE FUNCTION reconcile_campus_responsibility_write();
CREATE TRIGGER responsibility_projection_event_assignment
  AFTER INSERT OR UPDATE OR DELETE ON campus_event_staff
  FOR EACH ROW EXECUTE FUNCTION reconcile_campus_responsibility_write();
CREATE TRIGGER responsibility_projection_assessment_assignment
  AFTER INSERT OR UPDATE OR DELETE ON assessment_staff_assignments
  FOR EACH ROW EXECUTE FUNCTION reconcile_campus_responsibility_write();
CREATE TRIGGER responsibility_projection_transport_assignment
  AFTER INSERT OR UPDATE OR DELETE ON transport_trips
  FOR EACH ROW EXECUTE FUNCTION reconcile_campus_responsibility_write();
CREATE TRIGGER responsibility_projection_timetable_substitution
  AFTER INSERT OR UPDATE OF state,coverage_task_revision ON staff_timetable_substitutions
  FOR EACH ROW EXECUTE FUNCTION reconcile_campus_responsibility_write();
CREATE TRIGGER responsibility_projection_transport_route_scope
  AFTER UPDATE OF name ON transport_routes
  FOR EACH ROW EXECUTE FUNCTION reconcile_campus_responsibility_write();
CREATE TRIGGER responsibility_projection_role_template
  AFTER UPDATE OF capability_permissions,is_active,name,description
  ON staff_responsibility_types
  FOR EACH ROW EXECUTE FUNCTION reconcile_campus_responsibility_write();
CREATE TRIGGER responsibility_projection_event_scope
  AFTER INSERT OR UPDATE OF title,status,revision ON campus_events
  FOR EACH ROW EXECUTE FUNCTION reconcile_campus_responsibility_write();
CREATE TRIGGER responsibility_projection_assessment_scope
  AFTER INSERT OR UPDATE OF title,status,revision ON assessments
  FOR EACH ROW EXECUTE FUNCTION reconcile_campus_responsibility_write();
CREATE TRIGGER responsibility_projection_class_scope
  AFTER INSERT OR UPDATE OF grade,section,revision ON class_sections
  FOR EACH ROW EXECUTE FUNCTION reconcile_campus_responsibility_write();
CREATE TRIGGER responsibility_projection_institution_scope
  AFTER UPDATE OF name ON schools
  FOR EACH ROW EXECUTE FUNCTION reconcile_campus_responsibility_write();
CREATE TRIGGER responsibility_projection_staff_profile
  AFTER UPDATE OF user_id,person_id,status ON staff_profiles
  FOR EACH ROW EXECUTE FUNCTION reconcile_campus_responsibility_write();
CREATE TRIGGER responsibility_projection_human_agent
  AFTER INSERT OR UPDATE OF status ON campus_model_agents
  FOR EACH ROW EXECUTE FUNCTION reconcile_campus_responsibility_write();

ALTER TABLE campus_responsibility_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_responsibility_team_memberships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON campus_responsibility_assignments,campus_responsibility_team_memberships FROM PUBLIC;
REVOKE ALL ON FUNCTION guard_campus_responsibility_assignment() FROM PUBLIC;
REVOKE ALL ON FUNCTION guard_campus_responsibility_team_membership() FROM PUBLIC;
REVOKE ALL ON FUNCTION ensure_live_responsibility_scope(uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION reconcile_campus_responsibility_binding_source(uuid,text,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION reconcile_campus_responsibility_role(uuid,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION reconcile_campus_responsibility_substitution(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION reconcile_campus_responsibility_write() FROM PUBLIC;

DO $$
DECLARE application_owner text := current_user;
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='omnischool_app_owner') THEN
    application_owner := 'omnischool_app_owner';
  END IF;
  EXECUTE format('ALTER TABLE public.campus_responsibility_assignments OWNER TO %I',application_owner);
  EXECUTE format('ALTER TABLE public.campus_responsibility_team_memberships OWNER TO %I',application_owner);
  EXECUTE format('ALTER FUNCTION public.guard_campus_responsibility_assignment() OWNER TO %I',application_owner);
  EXECUTE format('ALTER FUNCTION public.guard_campus_responsibility_team_membership() OWNER TO %I',application_owner);
  EXECUTE format('ALTER FUNCTION public.ensure_live_responsibility_scope(uuid,text,uuid) OWNER TO %I',application_owner);
  EXECUTE format('ALTER FUNCTION public.reconcile_campus_responsibility_binding_source(uuid,text,uuid,integer) OWNER TO %I',application_owner);
  EXECUTE format('ALTER FUNCTION public.reconcile_campus_responsibility_role(uuid,uuid,integer) OWNER TO %I',application_owner);
  EXECUTE format('ALTER FUNCTION public.reconcile_campus_responsibility_substitution(uuid,uuid) OWNER TO %I',application_owner);
  EXECUTE format('ALTER FUNCTION public.reconcile_campus_responsibility_write() OWNER TO %I',application_owner);
END $$;
