CREATE TABLE school_custom_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  name varchar(80) NOT NULL CHECK (length(trim(name)) >= 2),
  description varchar(500) NOT NULL DEFAULT '',
  permissions text[] NOT NULL DEFAULT '{}',
  revision integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  CHECK (permissions <@ ARRAY['sis.manage','fees.manage','attendance.view','attendance.record','photo.use','timetable.view','dayplans.respond','followups.manage','messages.view','messages.send','groups.create','safeguarding.review','events.view','events.manage','events.attendance','ai.use']::text[])
);
CREATE UNIQUE INDEX school_custom_role_name ON school_custom_roles(school_id,lower(trim(name)));
CREATE TABLE school_custom_role_assignments (
  school_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  role_id uuid NOT NULL,
  assigned_by uuid NOT NULL REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(school_id,user_id),
  FOREIGN KEY(school_id,role_id) REFERENCES school_custom_roles(school_id,id)
);
-- Follow existing runtime ownership; no PUBLIC privileges.
DO $$ DECLARE runtime_owner text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO runtime_owner FROM pg_class WHERE oid='school_memberships'::regclass;
  EXECUTE format('ALTER TABLE school_custom_roles OWNER TO %I',runtime_owner);
  EXECUTE format('ALTER TABLE school_custom_role_assignments OWNER TO %I',runtime_owner);
END $$;
