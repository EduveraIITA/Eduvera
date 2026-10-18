-- Descriptive reporting structure. These records grant no access or office authority.
CREATE UNIQUE INDEX organization_staff_school_idx ON staff_profiles(school_id,id);
CREATE TABLE organization_structures (
  school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE organization_nodes (
  school_id uuid NOT NULL REFERENCES organization_structures(school_id) ON DELETE CASCADE,
  id uuid NOT NULL,
  parent_id uuid,
  kind text NOT NULL CHECK (kind IN ('leadership','department','team','position')),
  name varchar(120) NOT NULL CHECK (length(trim(name)) > 0),
  description varchar(1000) NOT NULL DEFAULT '',
  tone text NOT NULL CHECK (tone IN ('violet','blue','teal','rose','slate')),
  head_staff_id uuid,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  PRIMARY KEY(school_id,id),
  CHECK(parent_id IS DISTINCT FROM id),
  FOREIGN KEY(school_id,parent_id) REFERENCES organization_nodes(school_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(school_id,head_staff_id) REFERENCES staff_profiles(school_id,id)
);
CREATE TABLE organization_node_members (
  school_id uuid NOT NULL,
  node_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  PRIMARY KEY(school_id,node_id,staff_id),
  FOREIGN KEY(school_id,node_id) REFERENCES organization_nodes(school_id,id) ON DELETE CASCADE,
  FOREIGN KEY(school_id,staff_id) REFERENCES staff_profiles(school_id,id)
);
CREATE TABLE organization_structure_revisions (
  school_id uuid NOT NULL REFERENCES organization_structures(school_id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  nodes jsonb NOT NULL CHECK(jsonb_typeof(nodes)='array'),
  command_id uuid NOT NULL REFERENCES campus_model_commands(id),
  -- The outbox is pruned after delivery; retain its ID without preventing cleanup.
  event_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(school_id,revision),
  UNIQUE(school_id,actor_user_id,request_id)
);

ALTER TABLE organization_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_node_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_structure_revisions ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE table_name text; owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='staff_profiles'::regclass;
  FOREACH table_name IN ARRAY ARRAY['organization_structures','organization_nodes','organization_node_members','organization_structure_revisions'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM anon',table_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated',table_name);
    END IF;
    EXECUTE format('ALTER TABLE %I OWNER TO %I',table_name,owner_name);
  END LOOP;
END $$;

-- Outbox audiences are routing hints; delivery must recheck current access.
ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid)
  RENAME TO event_user_is_authorized_before_organization;
CREATE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE WHEN event_name='organization.structure.updated' THEN EXISTS (
    SELECT 1 FROM school_memberships membership JOIN users account ON account.id=membership.user_id
    WHERE membership.school_id=event_school_id AND membership.user_id=candidate_user_id
      AND membership.role='admin' AND membership.is_active AND account.is_active
  ) ELSE event_user_is_authorized_before_organization(event_school_id,event_name,event_payload,candidate_user_id) END
$$;
REVOKE ALL ON FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) FROM PUBLIC;
DO $$ DECLARE owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='event_outbox'::regclass;
  EXECUTE format('ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO %I',owner_name);
END $$;
