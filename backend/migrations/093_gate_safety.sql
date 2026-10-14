CREATE OR REPLACE FUNCTION staff_role_allowed_permissions(context text) RETURNS text[]
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE context
    WHEN 'institution' THEN ARRAY['gate.manage','members.invite','sis.manage','fees.manage','departure.manage','messages.view','messages.send','groups.create','ai.use']
    WHEN 'class' THEN ARRAY['attendance.view','attendance.record','photo.use','timetable.view','followups.manage','messages.view','messages.send','groups.create','reports.comment','events.view','events.manage','ai.use']
    WHEN 'event' THEN ARRAY['events.view','events.manage','events.attendance']
    WHEN 'assessment' THEN ARRAY['assessments.view','assessments.mark','assessments.moderate']
    WHEN 'trip' THEN ARRAY['departure.collect']
    ELSE ARRAY[]::text[] END
$$;

ALTER TABLE school_custom_roles DROP CONSTRAINT IF EXISTS school_custom_roles_permissions_check;
ALTER TABLE school_custom_roles ADD CONSTRAINT school_custom_roles_permissions_check CHECK (
 permissions <@ ARRAY['gate.manage','members.invite','sis.manage','fees.manage','attendance.view','attendance.record','photo.use','timetable.view','dayplans.respond','followups.manage','messages.view','messages.send','groups.create','safeguarding.review','events.view','events.manage','events.attendance','assessments.view','assessments.mark','assessments.moderate','reports.comment','departure.manage','departure.collect','ai.use']::text[]);
CREATE TABLE gate_qr_passes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id),
 student_id uuid NOT NULL REFERENCES students(id), plan_id uuid REFERENCES departure_plans(id),
 token_hash text NOT NULL UNIQUE, kind text NOT NULL CHECK(kind IN ('student','pickup')),
 expires_at timestamptz NOT NULL, used_at timestamptz, revoked_at timestamptz,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id),
 FOREIGN KEY(school_id,plan_id) REFERENCES departure_plans(school_id,id),
 CHECK((kind='pickup')=(plan_id IS NOT NULL))
);
ALTER TABLE gate_events ADD COLUMN recorded_by uuid REFERENCES users(id);
ALTER TABLE gate_events ADD COLUMN command_id uuid UNIQUE;
CREATE TABLE gate_visitors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),school_id uuid NOT NULL REFERENCES schools(id),
 name varchar(150) NOT NULL, phone varchar(32) NOT NULL,purpose varchar(300) NOT NULL,
 host_user_id uuid NOT NULL REFERENCES users(id), state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','denied','inside','out')),
 checked_in_at timestamptz, checked_out_at timestamptz, recorded_by uuid NOT NULL REFERENCES users(id),
 decided_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gate_visitors_school_state ON gate_visitors(school_id,state,created_at DESC);
CREATE INDEX gate_qr_school_student ON gate_qr_passes(school_id,student_id);
DO $$ DECLARE owner_name text; t text; BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='school_memberships'::regclass;
 FOREACH t IN ARRAY ARRAY['gate_qr_passes','gate_visitors'] LOOP
 EXECUTE format('ALTER TABLE %I OWNER TO %I',t,owner_name);
 EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',t);
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 END LOOP;
END $$;
ALTER TABLE gate_visitors ADD COLUMN token_hash text UNIQUE;
ALTER TABLE gate_visitors ADD COLUMN pass_expires_at timestamptz;
