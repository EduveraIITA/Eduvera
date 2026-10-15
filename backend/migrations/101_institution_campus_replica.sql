-- Digital campus replica: institution -> campuses -> hierarchical spaces,
-- effective-dated people/class placements and bounded resource holdings.
-- This is not a facilities-maintenance or financial asset-accounting model.

CREATE TABLE institution_campuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  parent_campus_id uuid,
  name varchar(160) NOT NULL,
  code varchar(32) NOT NULL,
  campus_type varchar(24) NOT NULL DEFAULT 'main' CHECK (campus_type IN ('main','branch','learning_centre','virtual')),
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  is_primary boolean NOT NULL DEFAULT false,
  address_line varchar(240) NOT NULL DEFAULT '',
  city varchar(100) NOT NULL DEFAULT '',
  state varchar(100) NOT NULL DEFAULT '',
  postal_code varchar(16) NOT NULL DEFAULT '',
  timezone varchar(80) NOT NULL DEFAULT 'Asia/Kolkata',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, code), UNIQUE (id, school_id),
  FOREIGN KEY (parent_campus_id,school_id) REFERENCES institution_campuses(id,school_id) ON DELETE RESTRICT,
  CHECK (parent_campus_id IS NULL OR parent_campus_id<>id)
);
CREATE UNIQUE INDEX institution_campuses_one_primary_idx ON institution_campuses(school_id) WHERE is_primary;
CREATE INDEX institution_campuses_school_parent_idx ON institution_campuses(school_id,parent_campus_id,status,name);

INSERT INTO institution_campuses(school_id,name,code,campus_type,is_primary,timezone,created_by,updated_by)
SELECT school.id,school.name||' campus','MAIN','main',true,school.timezone,school.created_by_user_id,school.created_by_user_id FROM schools school;

CREATE TABLE campus_spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  campus_id uuid NOT NULL, parent_space_id uuid, name varchar(160) NOT NULL, code varchar(40) NOT NULL,
  kind varchar(24) NOT NULL CHECK (kind IN ('building','wing','floor','classroom','laboratory','library','office','auditorium','sports_area','workshop','staff_room','gate','outdoor_area','virtual','other')),
  capacity integer CHECK (capacity IS NULL OR (capacity > 0 AND capacity <= 100000)),
  is_accessible boolean NOT NULL DEFAULT false, is_bookable boolean NOT NULL DEFAULT true,
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb, revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL, updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campus_id, code), UNIQUE (id, school_id, campus_id),
  FOREIGN KEY (campus_id,school_id) REFERENCES institution_campuses(id,school_id) ON DELETE CASCADE,
  FOREIGN KEY (parent_space_id,school_id,campus_id) REFERENCES campus_spaces(id,school_id,campus_id) ON DELETE RESTRICT,
  CHECK (parent_space_id IS NULL OR parent_space_id<>id)
);
CREATE INDEX campus_spaces_campus_parent_idx ON campus_spaces(campus_id,parent_space_id,kind,name);

INSERT INTO campus_spaces(school_id,campus_id,name,code,kind,created_by,updated_by)
SELECT DISTINCT section.school_id,campus.id,'Classroom '||trim(section.room_number),
  'ROOM-'||upper(left(md5(section.school_id::text||':'||trim(section.room_number)),8)),'classroom',section.updated_by,section.updated_by
FROM class_sections section JOIN institution_campuses campus ON campus.school_id=section.school_id AND campus.is_primary
WHERE trim(section.room_number)<>'';

CREATE TABLE campus_resource_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  code varchar(40) NOT NULL, name varchar(120) NOT NULL,
  category varchar(24) NOT NULL CHECK (category IN ('computer','display','tablet','lab_equipment','furniture','vehicle','network','safety','other')),
  tracking_mode varchar(16) NOT NULL DEFAULT 'pooled' CHECK (tracking_mode IN ('pooled','individual')),
  unit_label varchar(32) NOT NULL DEFAULT 'items', is_active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0), created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id,code), UNIQUE (id,school_id)
);

INSERT INTO campus_resource_types(school_id,code,name,category,tracking_mode,unit_label,created_by,updated_by)
SELECT school.id,seed.code,seed.name,seed.category,seed.tracking_mode,seed.unit_label,school.created_by_user_id,school.created_by_user_id
FROM schools school CROSS JOIN (VALUES
  ('COMPUTER','Computers','computer','pooled','computers'),('PROJECTOR','Projector','display','individual','projector'),
  ('TABLET','Tablets','tablet','pooled','tablets'),('LAB-EQUIPMENT','Laboratory equipment','lab_equipment','pooled','items')
) AS seed(code,name,category,tracking_mode,unit_label);

CREATE TABLE campus_resource_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  campus_id uuid NOT NULL, space_id uuid, resource_type_id uuid NOT NULL, name varchar(160) NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0 AND quantity <= 1000000), asset_tag varchar(80),
  state varchar(20) NOT NULL DEFAULT 'available' CHECK (state IN ('available','unavailable','retired')),
  notes varchar(500) NOT NULL DEFAULT '', revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL, updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (campus_id,school_id) REFERENCES institution_campuses(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY (space_id,school_id,campus_id) REFERENCES campus_spaces(id,school_id,campus_id) ON DELETE RESTRICT,
  FOREIGN KEY (resource_type_id,school_id) REFERENCES campus_resource_types(id,school_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX campus_resource_holdings_asset_tag_idx ON campus_resource_holdings(school_id,asset_tag) WHERE asset_tag IS NOT NULL;
CREATE INDEX campus_resource_holdings_location_idx ON campus_resource_holdings(campus_id,space_id,resource_type_id,state);

ALTER TABLE class_sections ADD CONSTRAINT class_sections_id_school_unique UNIQUE (id,school_id);
CREATE TABLE class_campus_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_section_id uuid NOT NULL, campus_id uuid NOT NULL, home_space_id uuid, is_primary boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL, effective_until date, revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until>=effective_from),
  FOREIGN KEY (class_section_id,school_id) REFERENCES class_sections(id,school_id) ON DELETE CASCADE,
  FOREIGN KEY (campus_id,school_id) REFERENCES institution_campuses(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY (home_space_id,school_id,campus_id) REFERENCES campus_spaces(id,school_id,campus_id) ON DELETE RESTRICT
);
CREATE INDEX class_campus_placements_current_idx ON class_campus_placements(school_id,campus_id,class_section_id,effective_from,effective_until);

INSERT INTO class_campus_placements(school_id,class_section_id,campus_id,home_space_id,is_primary,effective_from,effective_until,assigned_by)
SELECT section.school_id,section.id,campus.id,space.id,true,
  COALESCE((SELECT min(term.starts_on) FROM academic_terms term WHERE term.school_id=section.school_id AND term.academic_year=section.academic_year),current_date),
  (SELECT max(term.ends_on) FROM academic_terms term WHERE term.school_id=section.school_id AND term.academic_year=section.academic_year),section.updated_by
FROM class_sections section JOIN institution_campuses campus ON campus.school_id=section.school_id AND campus.is_primary
LEFT JOIN campus_spaces space ON space.school_id=section.school_id AND space.campus_id=campus.id
  AND space.name='Classroom '||trim(section.room_number) AND trim(section.room_number)<>'';

ALTER TABLE staff_profiles ADD CONSTRAINT staff_profiles_id_school_unique UNIQUE (id,school_id);
CREATE TABLE staff_campus_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  staff_profile_id uuid NOT NULL, campus_id uuid NOT NULL, is_primary boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL DEFAULT current_date, effective_until date, revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until>=effective_from),
  FOREIGN KEY (campus_id,school_id) REFERENCES institution_campuses(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY (staff_profile_id,school_id) REFERENCES staff_profiles(id,school_id) ON DELETE CASCADE
);
CREATE INDEX staff_campus_assignments_current_idx ON staff_campus_assignments(school_id,campus_id,staff_profile_id,effective_from,effective_until);
INSERT INTO staff_campus_assignments(school_id,staff_profile_id,campus_id,is_primary,effective_from,effective_until,assigned_by)
SELECT profile.school_id,profile.id,campus.id,true,profile.joined_on,CASE WHEN profile.status='inactive' THEN current_date ELSE NULL END,profile.updated_by
FROM staff_profiles profile JOIN institution_campuses campus ON campus.school_id=profile.school_id AND campus.is_primary;

ALTER TABLE timetable_slots ADD COLUMN space_id uuid REFERENCES campus_spaces(id) ON DELETE RESTRICT;
ALTER TABLE schedule_periods ADD COLUMN space_id uuid REFERENCES campus_spaces(id) ON DELETE RESTRICT;
ALTER TABLE day_plan_periods ADD COLUMN space_id uuid REFERENCES campus_spaces(id) ON DELETE RESTRICT;

UPDATE timetable_slots slot SET space_id=space.id FROM class_sections section
JOIN class_campus_placements placement ON placement.class_section_id=section.id AND placement.is_primary
JOIN campus_spaces space ON space.campus_id=placement.campus_id
WHERE section.id=slot.class_section_id AND trim(slot.room)<>''
  AND (space.code=upper(trim(slot.room)) OR space.name='Classroom '||trim(slot.room));
UPDATE schedule_periods period SET space_id=space.id FROM schedule_versions version
JOIN class_campus_placements placement ON placement.class_section_id=version.class_section_id AND placement.is_primary
JOIN campus_spaces space ON space.campus_id=placement.campus_id
WHERE version.id=period.version_id AND trim(period.room)<>''
  AND (space.code=upper(trim(period.room)) OR space.name='Classroom '||trim(period.room));
UPDATE day_plan_periods period SET space_id=space.id FROM day_plans plan
JOIN class_campus_placements placement ON placement.class_section_id=plan.class_section_id AND placement.is_primary
JOIN campus_spaces space ON space.campus_id=placement.campus_id
WHERE plan.id=period.plan_id AND trim(period.room)<>''
  AND (space.code=upper(trim(period.room)) OR space.name='Classroom '||trim(period.room));

CREATE TABLE institution_setup_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id), action varchar(80) NOT NULL, target_type varchar(40) NOT NULL,
  target_id uuid, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX institution_setup_audits_school_created_idx ON institution_setup_audits(school_id,created_at DESC);

CREATE OR REPLACE FUNCTION bump_campus_replica_revision() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN NEW.revision:=OLD.revision+1; NEW.updated_at:=now(); RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION guard_campus_parent_cycle() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN IF NEW.parent_campus_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS(WITH RECURSIVE d AS (SELECT id FROM institution_campuses WHERE parent_campus_id=NEW.id UNION ALL SELECT c.id FROM institution_campuses c JOIN d ON c.parent_campus_id=d.id) SELECT 1 FROM d WHERE id=NEW.parent_campus_id)
  THEN RAISE EXCEPTION 'Campus hierarchy cannot contain a cycle' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION guard_space_parent_cycle() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN IF NEW.parent_space_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS(WITH RECURSIVE d AS (SELECT id FROM campus_spaces WHERE parent_space_id=NEW.id UNION ALL SELECT c.id FROM campus_spaces c JOIN d ON c.parent_space_id=d.id) SELECT 1 FROM d WHERE id=NEW.parent_space_id)
  THEN RAISE EXCEPTION 'Space hierarchy cannot contain a cycle' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION guard_resource_holding_tracking() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE mode varchar; BEGIN SELECT tracking_mode INTO mode FROM campus_resource_types WHERE id=NEW.resource_type_id AND school_id=NEW.school_id;
  IF mode IS NULL THEN RAISE EXCEPTION 'Resource type does not belong to this institution' USING ERRCODE='23514'; END IF;
  IF mode='individual' AND (NEW.quantity<>1 OR NEW.asset_tag IS NULL OR trim(NEW.asset_tag)='') THEN RAISE EXCEPTION 'Individually tracked resources require quantity one and an asset tag' USING ERRCODE='23514'; END IF;
  IF mode='pooled' AND NEW.asset_tag IS NOT NULL THEN RAISE EXCEPTION 'Pooled resource holdings cannot use an individual asset tag' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION guard_class_placement_overlap() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN IF NEW.is_primary AND EXISTS(SELECT 1 FROM class_campus_placements p WHERE p.class_section_id=NEW.class_section_id AND p.is_primary AND p.id<>NEW.id AND daterange(p.effective_from,COALESCE(p.effective_until,'infinity'::date),'[]')&&daterange(NEW.effective_from,COALESCE(NEW.effective_until,'infinity'::date),'[]'))
  THEN RAISE EXCEPTION 'Primary class campus placements cannot overlap' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION guard_staff_placement_overlap() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN IF NEW.is_primary AND EXISTS(SELECT 1 FROM staff_campus_assignments p WHERE p.staff_profile_id=NEW.staff_profile_id AND p.is_primary AND p.id<>NEW.id AND daterange(p.effective_from,COALESCE(p.effective_until,'infinity'::date),'[]')&&daterange(NEW.effective_from,COALESCE(NEW.effective_until,'infinity'::date),'[]'))
  THEN RAISE EXCEPTION 'Primary staff campus assignments cannot overlap' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;

CREATE TRIGGER institution_campuses_revision_guard BEFORE UPDATE ON institution_campuses FOR EACH ROW EXECUTE FUNCTION bump_campus_replica_revision();
CREATE TRIGGER campus_spaces_revision_guard BEFORE UPDATE ON campus_spaces FOR EACH ROW EXECUTE FUNCTION bump_campus_replica_revision();
CREATE TRIGGER campus_resource_types_revision_guard BEFORE UPDATE ON campus_resource_types FOR EACH ROW EXECUTE FUNCTION bump_campus_replica_revision();
CREATE TRIGGER campus_resource_holdings_revision_guard BEFORE UPDATE ON campus_resource_holdings FOR EACH ROW EXECUTE FUNCTION bump_campus_replica_revision();
CREATE TRIGGER class_campus_placements_revision_guard BEFORE UPDATE ON class_campus_placements FOR EACH ROW EXECUTE FUNCTION bump_campus_replica_revision();
CREATE TRIGGER staff_campus_assignments_revision_guard BEFORE UPDATE ON staff_campus_assignments FOR EACH ROW EXECUTE FUNCTION bump_campus_replica_revision();
CREATE TRIGGER institution_campuses_parent_guard BEFORE INSERT OR UPDATE OF parent_campus_id ON institution_campuses FOR EACH ROW EXECUTE FUNCTION guard_campus_parent_cycle();
CREATE TRIGGER campus_spaces_parent_guard BEFORE INSERT OR UPDATE OF parent_space_id ON campus_spaces FOR EACH ROW EXECUTE FUNCTION guard_space_parent_cycle();
CREATE TRIGGER campus_resource_holdings_tracking_guard BEFORE INSERT OR UPDATE ON campus_resource_holdings FOR EACH ROW EXECUTE FUNCTION guard_resource_holding_tracking();
CREATE TRIGGER class_campus_placements_overlap_guard BEFORE INSERT OR UPDATE ON class_campus_placements FOR EACH ROW EXECUTE FUNCTION guard_class_placement_overlap();
CREATE TRIGGER staff_campus_assignments_overlap_guard BEFORE INSERT OR UPDATE ON staff_campus_assignments FOR EACH ROW EXECUTE FUNCTION guard_staff_placement_overlap();

ALTER TABLE institution_campuses ENABLE ROW LEVEL SECURITY; ALTER TABLE campus_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_resource_types ENABLE ROW LEVEL SECURITY; ALTER TABLE campus_resource_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_campus_placements ENABLE ROW LEVEL SECURITY; ALTER TABLE staff_campus_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_setup_audits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON institution_campuses,campus_spaces,campus_resource_types,campus_resource_holdings,class_campus_placements,staff_campus_assignments,institution_setup_audits FROM PUBLIC;

DO $$ DECLARE application_owner name; BEGIN SELECT tableowner INTO application_owner FROM pg_tables WHERE schemaname='public' AND tablename='schools';
  IF application_owner IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.institution_campuses OWNER TO %I',application_owner); EXECUTE format('ALTER TABLE public.campus_spaces OWNER TO %I',application_owner);
    EXECUTE format('ALTER TABLE public.campus_resource_types OWNER TO %I',application_owner); EXECUTE format('ALTER TABLE public.campus_resource_holdings OWNER TO %I',application_owner);
    EXECUTE format('ALTER TABLE public.class_campus_placements OWNER TO %I',application_owner); EXECUTE format('ALTER TABLE public.staff_campus_assignments OWNER TO %I',application_owner);
    EXECUTE format('ALTER TABLE public.institution_setup_audits OWNER TO %I',application_owner);
  END IF; END $$;
