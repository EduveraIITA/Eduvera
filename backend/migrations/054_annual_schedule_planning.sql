-- Versioned repeating schedules. Browser access remains behind the application API.
CREATE TABLE schedule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  term_id uuid NOT NULL REFERENCES academic_terms(id),
  class_section_id uuid NOT NULL REFERENCES class_sections(id),
  state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','discarded')),
  starts_on date NOT NULL,
  ends_on date NOT NULL CHECK(ends_on>=starts_on),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  baseline boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE(id,school_id)
);
CREATE UNIQUE INDEX schedule_one_draft ON schedule_versions(class_section_id,term_id) WHERE state='draft' AND NOT baseline;
CREATE UNIQUE INDEX schedule_distinct_start ON schedule_versions(class_section_id,term_id,starts_on) WHERE state='published' AND NOT baseline;
CREATE UNIQUE INDEX schedule_one_baseline ON schedule_versions(class_section_id,term_id) WHERE baseline;
CREATE INDEX schedule_effective ON schedule_versions(school_id,class_section_id,starts_on DESC) WHERE state='published';
CREATE TABLE schedule_periods (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES schedule_versions(id),
  weekday smallint NOT NULL CHECK(weekday BETWEEN 1 AND 7),
  period_number smallint NOT NULL CHECK(period_number BETWEEN 1 AND 24),
  starts_at time NOT NULL,
  ends_at time NOT NULL CHECK(ends_at>starts_at),
  subject_id uuid REFERENCES subjects(id),
  teacher_user_id uuid REFERENCES users(id),
  title varchar(120) NOT NULL,
  slot_type varchar(16) NOT NULL CHECK(slot_type IN ('class','break','activity')),
  room varchar(80) NOT NULL DEFAULT '',
  PRIMARY KEY(version_id,id),
  UNIQUE(version_id,weekday,period_number)
);
CREATE FUNCTION validate_schedule_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retain schedule history; discard drafts instead'; END IF;
  IF NOT EXISTS(SELECT 1 FROM academic_terms t JOIN class_sections c ON c.school_id=t.school_id AND c.academic_year=t.academic_year WHERE t.id=NEW.term_id AND c.id=NEW.class_section_id AND t.school_id=NEW.school_id AND NEW.starts_on>=t.starts_on AND NEW.ends_on<=t.ends_on)
  THEN RAISE EXCEPTION 'Schedule must belong to this class, institution and term date range'; END IF;
  IF TG_OP='UPDATE' AND OLD.state<>'draft' THEN RAISE EXCEPTION 'Published schedules are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER schedule_scope BEFORE INSERT OR UPDATE OR DELETE ON schedule_versions FOR EACH ROW EXECUTE FUNCTION validate_schedule_scope();
CREATE FUNCTION validate_schedule_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE institution uuid; current_state text; historical boolean;
BEGIN
  IF TG_OP='UPDATE' AND NEW.version_id<>OLD.version_id THEN RAISE EXCEPTION 'Periods cannot move between versions'; END IF;
  SELECT school_id,state,baseline INTO institution,current_state,historical FROM schedule_versions WHERE id=COALESCE(NEW.version_id,OLD.version_id);
  IF current_state<>'draft' THEN RAISE EXCEPTION 'Only draft periods can change'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.subject_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM subjects WHERE id=NEW.subject_id AND school_id=institution) THEN RAISE EXCEPTION 'Subject outside institution'; END IF;
  IF NEW.teacher_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM school_memberships WHERE user_id=NEW.teacher_user_id AND school_id=institution AND role='staff' AND (historical OR is_active)) THEN RAISE EXCEPTION 'Teacher outside institution'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER schedule_period_scope BEFORE INSERT OR UPDATE OR DELETE ON schedule_periods FOR EACH ROW EXECUTE FUNCTION validate_schedule_period();

-- Keep the established daily-plan and closure projection, replacing only its
-- recurring rows once a class has an applicable published version.
ALTER FUNCTION effective_school_schedule(uuid,date) RENAME TO legacy_effective_school_schedule;
CREATE FUNCTION effective_school_schedule(p_school uuid,p_date date)
RETURNS TABLE(id uuid,class_section_id uuid,term_id uuid,weekday smallint,period_number smallint,
  starts_at time,ends_at time,title text,slot_type varchar,room varchar,teacher_user_id uuid,
  teacher_designation text,subject_id uuid,materials text[],cancelled boolean,
  day_plan_id uuid,plan_version integer,notice text,coverage_status text)
LANGUAGE sql STABLE AS $$
  WITH chosen AS (
    SELECT DISTINCT ON(v.class_section_id,v.term_id) v.* FROM schedule_versions v
    WHERE v.school_id=p_school AND v.state='published' AND p_date BETWEEN v.starts_on AND v.ends_on
    ORDER BY v.class_section_id,v.term_id,v.baseline ASC,v.starts_on DESC
  )
  SELECT s.* FROM legacy_effective_school_schedule(p_school,p_date) s
    WHERE s.day_plan_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM chosen v WHERE v.class_section_id=s.class_section_id AND v.term_id=s.term_id)
  UNION ALL
  SELECT p.id,v.class_section_id,v.term_id,p.weekday,p.period_number,p.starts_at,p.ends_at,
    p.title::text,p.slot_type,p.room,p.teacher_user_id,'Teacher'::text,p.subject_id,'{}'::text[],false,NULL::uuid,NULL::integer,''::text,
    CASE WHEN p.teacher_user_id IS NULL AND p.slot_type='class' THEN 'unassigned' ELSE 'not_required' END
  FROM chosen v JOIN schedule_periods p ON p.version_id=v.id
  WHERE p.weekday=extract(isodow FROM p_date)
    AND NOT EXISTS(SELECT 1 FROM day_plans d WHERE d.class_section_id=v.class_section_id AND d.date=p_date AND d.published_version IS NOT NULL)
    AND NOT EXISTS(SELECT 1 FROM school_calendar_days c WHERE c.school_id=p_school AND c.date=p_date AND NOT c.is_instructional)
$$;
REVOKE ALL ON schedule_versions,schedule_periods FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_schedule_scope(),validate_schedule_period(),legacy_effective_school_schedule(uuid,date),effective_school_schedule(uuid,date) FROM PUBLIC;
ALTER TABLE schedule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_periods ENABLE ROW LEVEL SECURITY;
-- Dated teaching access follows the currently effective repeating pattern, not
-- the stale legacy slots. Explicit/revoked role bindings retain precedence.
CREATE FUNCTION schedule_teacher_assigned(tenant uuid,actor uuid,resource uuid,at_date date)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  WITH chosen AS (
    SELECT v.id FROM schedule_versions v WHERE v.school_id=tenant AND v.class_section_id=resource
      AND v.state='published' AND at_date BETWEEN v.starts_on AND v.ends_on
    ORDER BY v.baseline ASC,v.starts_on DESC LIMIT 1
  )
  SELECT EXISTS(SELECT 1 FROM chosen v JOIN schedule_periods p ON p.version_id=v.id WHERE p.teacher_user_id=actor)
    OR (NOT EXISTS(SELECT 1 FROM chosen) AND EXISTS(SELECT 1 FROM timetable_slots p
      JOIN class_sections c ON c.id=p.class_section_id AND c.school_id=tenant
      JOIN academic_terms t ON t.id=p.term_id WHERE p.class_section_id=resource AND p.teacher_user_id=actor AND at_date BETWEEN t.starts_on AND t.ends_on))
$$;
CREATE OR REPLACE FUNCTION staff_has_class_permission(tenant uuid,actor uuid,action text,resource uuid,at_date date DEFAULT current_date)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT staff_has_resource_permission(tenant,actor,action,'class',resource,at_date)
    OR staff_has_resource_permission(tenant,actor,action,'institution',tenant,at_date)
    OR (action=ANY(ARRAY['attendance.view','attendance.record','photo.use','timetable.view','followups.manage','messages.view','messages.send','groups.create'])
      AND NOT EXISTS(SELECT 1 FROM staff_role_bindings b WHERE b.school_id=tenant AND b.user_id=actor AND b.context_kind='class' AND b.scope_id=resource)
      AND EXISTS(SELECT 1 FROM school_memberships m JOIN users u ON u.id=m.user_id WHERE m.school_id=tenant AND m.user_id=actor AND m.role='staff' AND m.is_active AND u.is_active)
      AND schedule_teacher_assigned(tenant,actor,resource,at_date))
$$;
REVOKE ALL ON FUNCTION schedule_teacher_assigned(uuid,uuid,uuid,date) FROM PUBLIC;
DO $$ DECLARE owner_name text; role_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='students'::regclass;
  EXECUTE format('ALTER TABLE schedule_versions OWNER TO %I',owner_name);
  EXECUTE format('ALTER TABLE schedule_periods OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION validate_schedule_scope() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION validate_schedule_period() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION effective_school_schedule(uuid,date) OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION schedule_teacher_assigned(uuid,uuid,uuid,date) OWNER TO %I',owner_name);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON schedule_versions,schedule_periods FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON FUNCTION validate_schedule_scope(),validate_schedule_period(),legacy_effective_school_schedule(uuid,date),effective_school_schedule(uuid,date) FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON FUNCTION schedule_teacher_assigned(uuid,uuid,uuid,date) FROM %I',role_name);
    END IF;
  END LOOP;
END $$;
