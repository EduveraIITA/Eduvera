-- One planning foundation: existing academic versions are a specialization, not
-- a second timetable. Published source records and attendance history are retained.
ALTER TABLE schedule_versions
  ALTER COLUMN term_id DROP NOT NULL,
  ALTER COLUMN class_section_id DROP NOT NULL,
  ALTER COLUMN ends_on DROP NOT NULL,
  ADD COLUMN planning_origin text NOT NULL DEFAULT 'academic'
    CHECK(planning_origin IN ('academic','activity')),
  ADD COLUMN activity_title varchar(160) NOT NULL DEFAULT 'Timetable',
  ADD COLUMN activity_purpose varchar(24) NOT NULL DEFAULT 'teaching'
    CHECK(activity_purpose IN ('teaching','duty','training','meeting','other')),
  ADD COLUMN activity_description varchar(1000) NOT NULL DEFAULT '',
  ADD COLUMN activity_timezone varchar(80),
  ADD COLUMN recurrence_kind varchar(16) NOT NULL DEFAULT 'weekly'
    CHECK(recurrence_kind IN ('once','weekly')),
  ADD COLUMN attendance_mode varchar(16) NOT NULL DEFAULT 'none'
    CHECK(attendance_mode IN ('none','roll_call')),
  ADD COLUMN lead_person_id uuid,
  ADD COLUMN recorder_person_id uuid,
  ADD COLUMN reviewer_person_id uuid,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by uuid REFERENCES users(id),
  ADD COLUMN cancellation_reason varchar(500),
  ADD CONSTRAINT schedule_lead_person_scope FOREIGN KEY(school_id,lead_person_id)
    REFERENCES school_people(school_id,id),
  ADD CONSTRAINT schedule_recorder_person_scope FOREIGN KEY(school_id,recorder_person_id)
    REFERENCES school_people(school_id,id),
  ADD CONSTRAINT schedule_reviewer_person_scope FOREIGN KEY(school_id,reviewer_person_id)
    REFERENCES school_people(school_id,id),
  ADD CONSTRAINT schedule_academic_context_pair
    CHECK((class_section_id IS NULL)=(term_id IS NULL)),
  ADD CONSTRAINT schedule_academic_context_required
    CHECK(planning_origin<>'academic' OR (class_section_id IS NOT NULL AND term_id IS NOT NULL AND ends_on IS NOT NULL));
ALTER TABLE schedule_versions DROP CONSTRAINT schedule_versions_state_check;
ALTER TABLE schedule_versions ADD CONSTRAINT schedule_versions_state_check
  CHECK(state IN ('draft','published','discarded','cancelled'));
ALTER TABLE schedule_versions DISABLE TRIGGER schedule_scope;
UPDATE schedule_versions version SET activity_timezone=school.timezone,
  activity_title=concat('Class ',section.grade,section.section,' timetable')
FROM schools school,class_sections section
WHERE school.id=version.school_id AND section.id=version.class_section_id;
ALTER TABLE schedule_versions ENABLE TRIGGER schedule_scope;
ALTER TABLE schedule_versions ALTER COLUMN activity_timezone SET NOT NULL;

ALTER TABLE schedule_periods ADD COLUMN end_day_offset smallint NOT NULL DEFAULT 0
  CHECK(end_day_offset IN (0,1));
DO $$ DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN SELECT conname FROM pg_constraint
    WHERE conrelid='schedule_periods'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%ends_at > starts_at%'
  LOOP EXECUTE format('ALTER TABLE schedule_periods DROP CONSTRAINT %I',constraint_name); END LOOP;
END $$;
ALTER TABLE schedule_periods ADD CONSTRAINT schedule_period_interval
  CHECK((end_day_offset=0 AND ends_at>starts_at)
     OR (end_day_offset=1 AND ends_at<=starts_at));

CREATE TABLE schedule_plan_people (
  version_id uuid NOT NULL REFERENCES schedule_versions(id),
  school_id uuid NOT NULL,
  person_id uuid NOT NULL,
  PRIMARY KEY(version_id,person_id),
  FOREIGN KEY(version_id,school_id) REFERENCES schedule_versions(id,school_id),
  FOREIGN KEY(school_id,person_id) REFERENCES school_people(school_id,id)
);
CREATE TABLE schedule_plan_groups (
  version_id uuid NOT NULL REFERENCES schedule_versions(id),
  school_id uuid NOT NULL,
  group_kind text NOT NULL CHECK(group_kind IN ('class','team','group')),
  group_id uuid NOT NULL,
  PRIMARY KEY(version_id,group_kind,group_id),
  FOREIGN KEY(version_id,school_id) REFERENCES schedule_versions(id,school_id)
);

-- Domain-owned occurrence/roster source. Model Core registers these through its
-- neutral projection port; it does not own recurrence or attendance decisions.
CREATE TABLE schedule_activity_occurrences (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id),
  activity_id uuid NOT NULL,
  plan_version_id uuid,
  period_id uuid NOT NULL,
  source text NOT NULL CHECK(source IN ('activity','academic')),
  source_ref text NOT NULL,
  source_revision integer NOT NULL CHECK(source_revision>0),
  title varchar(160) NOT NULL,
  purpose varchar(24) NOT NULL,
  local_date date NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),
  timezone varchar(80) NOT NULL,
  space_id uuid REFERENCES campus_spaces(id),
  attendance_mode varchar(16) NOT NULL CHECK(attendance_mode IN ('none','roll_call')),
  context_kind varchar(24) NOT NULL CHECK(context_kind IN ('activity','academic_class')),
  context_ref uuid,
  term_id uuid,
  subject_id uuid,
  scheduled_teacher_id uuid,
  period_number smallint,
  state varchar(16) NOT NULL DEFAULT 'expected' CHECK(state IN ('expected','cancelled')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,school_id),
  UNIQUE(school_id,source,source_ref,local_date),
  FOREIGN KEY(plan_version_id,school_id) REFERENCES schedule_versions(id,school_id)
);
CREATE INDEX schedule_activity_occurrence_interval ON schedule_activity_occurrences(school_id,starts_at,ends_at);
CREATE TABLE schedule_activity_occurrence_people (
  occurrence_id uuid NOT NULL,
  school_id uuid NOT NULL,
  person_id uuid NOT NULL,
  label varchar(310) NOT NULL,
  participation_role varchar(24) NOT NULL CHECK(participation_role IN ('participant','lead')),
  source_kind varchar(24) NOT NULL CHECK(source_kind IN ('person','class','team','group','teaching')),
  source_ref text NOT NULL,
  source_revision integer NOT NULL CHECK(source_revision>0),
  requirement varchar(16) NOT NULL DEFAULT 'required' CHECK(requirement IN ('required','optional')),
  PRIMARY KEY(occurrence_id,person_id),
  FOREIGN KEY(occurrence_id,school_id) REFERENCES schedule_activity_occurrences(id,school_id),
  FOREIGN KEY(school_id,person_id) REFERENCES school_people(school_id,id)
);
CREATE INDEX schedule_activity_person_occurrence ON schedule_activity_occurrence_people(school_id,person_id,occurrence_id);
CREATE TABLE schedule_activity_occurrence_recorders (
  occurrence_id uuid NOT NULL,
  school_id uuid NOT NULL,
  person_id uuid NOT NULL,
  action varchar(16) NOT NULL CHECK(action IN ('record','review')),
  source_ref text NOT NULL,
  source_revision integer NOT NULL CHECK(source_revision>0),
  appointed_by uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY(occurrence_id,person_id,action),
  FOREIGN KEY(occurrence_id,school_id) REFERENCES schedule_activity_occurrences(id,school_id),
  FOREIGN KEY(school_id,person_id) REFERENCES school_people(school_id,id)
);

CREATE OR REPLACE FUNCTION validate_schedule_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retain schedule history; discard drafts instead'; END IF;
  IF NEW.activity_timezone IS NULL THEN
    SELECT timezone INTO NEW.activity_timezone FROM schools WHERE id=NEW.school_id;
  END IF;
  IF TG_OP='UPDATE' AND OLD.state<>'draft' THEN
    IF OLD.state='published' AND NEW.state='cancelled'
      AND NEW.revision=OLD.revision+1 AND NEW.cancelled_at IS NOT NULL
      AND NEW.cancelled_by IS NOT NULL AND length(btrim(NEW.cancellation_reason))>=3
      AND (to_jsonb(NEW)-ARRAY['state','revision','cancelled_at','cancelled_by','cancellation_reason'])
        IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','cancelled_at','cancelled_by','cancellation_reason'])
    THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Published schedules are immutable; retain source and record a cancellation';
  END IF;
  IF NEW.class_section_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM academic_terms t JOIN class_sections c
      ON c.school_id=t.school_id AND c.academic_year=t.academic_year
    WHERE t.id=NEW.term_id AND c.id=NEW.class_section_id AND t.school_id=NEW.school_id
      AND NEW.starts_on>=t.starts_on AND NEW.ends_on IS NOT NULL AND NEW.ends_on<=t.ends_on)
  THEN RAISE EXCEPTION 'Schedule must belong to this class, institution and term date range'; END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION guard_schedule_plan_expectation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version schedule_versions; scope_id uuid;
BEGIN
  SELECT * INTO version FROM schedule_versions WHERE id=COALESCE(NEW.version_id,OLD.version_id) FOR SHARE;
  IF version.state<>'draft' THEN RAISE EXCEPTION 'Published participation expectations are immutable'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.school_id<>version.school_id THEN RAISE EXCEPTION 'Plan expectation outside institution'; END IF;
  IF TG_TABLE_NAME='schedule_plan_groups' THEN
    IF NEW.group_kind='class' THEN
      SELECT school_id INTO scope_id FROM class_sections WHERE id=NEW.group_id;
    ELSIF NEW.group_kind='team' THEN
      SELECT school_id INTO scope_id FROM campus_model_agents WHERE id=NEW.group_id AND agent_kind='team' AND status='active';
    ELSE
      SELECT school_id INTO scope_id FROM participation_groups WHERE id=NEW.group_id AND is_active;
    END IF;
    IF scope_id IS DISTINCT FROM NEW.school_id THEN RAISE EXCEPTION 'Group outside institution or inactive'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER schedule_plan_people_guard BEFORE INSERT OR UPDATE OR DELETE ON schedule_plan_people
  FOR EACH ROW EXECUTE FUNCTION guard_schedule_plan_expectation();
CREATE TRIGGER schedule_plan_group_guard BEFORE INSERT OR UPDATE OR DELETE ON schedule_plan_groups
  FOR EACH ROW EXECUTE FUNCTION guard_schedule_plan_expectation();

DO $$ DECLARE table_name text; application_owner text; database_role text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner FROM pg_class WHERE oid='schedule_versions'::regclass;
  FOREACH table_name IN ARRAY ARRAY['schedule_plan_people','schedule_plan_groups','schedule_activity_occurrences','schedule_activity_occurrence_people','schedule_activity_occurrence_recorders'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',table_name);
    EXECUTE format('ALTER TABLE %I OWNER TO %I',table_name,application_owner);
    FOREACH database_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=database_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',table_name,database_role);
      END IF;
    END LOOP;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION guard_schedule_plan_expectation() FROM PUBLIC;

-- Compatibility readers remain academic specializations. Neutral activity
-- versions must never become a fabricated null-class answer in old readers.
CREATE OR REPLACE FUNCTION effective_school_schedule(p_school uuid,p_date date)
RETURNS TABLE(id uuid,class_section_id uuid,term_id uuid,weekday smallint,period_number smallint,
  starts_at time,ends_at time,title text,slot_type varchar,room varchar,teacher_user_id uuid,
  teacher_designation text,subject_id uuid,materials text[],cancelled boolean,
  day_plan_id uuid,plan_version integer,notice text,coverage_status text)
LANGUAGE sql STABLE AS $$
  WITH chosen AS (
    SELECT DISTINCT ON(v.class_section_id,v.term_id) v.* FROM schedule_versions v
    WHERE v.school_id=p_school AND v.state='published' AND v.class_section_id IS NOT NULL
      AND p_date>=v.starts_on AND (v.ends_on IS NULL OR p_date<=v.ends_on)
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
