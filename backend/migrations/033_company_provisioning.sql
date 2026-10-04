ALTER TABLE schools ADD COLUMN institution_kind text NOT NULL DEFAULT 'school' CHECK (institution_kind IN ('school','college'));
CREATE TABLE company_operators (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  is_active boolean NOT NULL DEFAULT true,
  granted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE company_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id),
  school_id uuid REFERENCES schools(id),
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE school_invitations
  ADD COLUMN source text NOT NULL DEFAULT 'school' CHECK (source IN ('school','company')),
  ADD COLUMN student_id uuid REFERENCES students(id),
  ADD COLUMN guardian_id uuid REFERENCES parents(id),
  ADD COLUMN custom_role_id uuid,
  ADD CONSTRAINT invitation_role_scope FOREIGN KEY (school_id,custom_role_id) REFERENCES school_custom_roles(school_id,id) ON DELETE SET NULL (custom_role_id),
  ADD CHECK (source != 'company' OR role='admin'),
  ADD CHECK (student_id IS NULL OR role='student'),
  ADD CHECK (guardian_id IS NULL OR role='guardian'),
  ADD CHECK (custom_role_id IS NULL OR role='staff');
ALTER TABLE school_custom_roles DROP CONSTRAINT school_custom_roles_permissions_check;
ALTER TABLE school_custom_roles ADD CONSTRAINT school_custom_roles_permissions_check CHECK (
  permissions <@ ARRAY['sis.manage','fees.manage','members.invite','attendance.view','attendance.record','photo.use','timetable.view','dayplans.respond','followups.manage','messages.view','messages.send','groups.create','safeguarding.review','events.view','events.manage','events.attendance','ai.use']::text[]
);
DO $$ DECLARE runtime_owner text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO runtime_owner FROM pg_class WHERE oid='school_memberships'::regclass;
  EXECUTE format('ALTER TABLE company_operators OWNER TO %I',runtime_owner);
  EXECUTE format('ALTER TABLE company_audit OWNER TO %I',runtime_owner);
END $$;
