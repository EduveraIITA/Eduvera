CREATE UNIQUE INDEX IF NOT EXISTS day_plan_class_identity_idx ON class_sections(school_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS day_plan_member_identity_idx ON school_memberships(school_id,id);

CREATE TABLE day_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_section_id uuid NOT NULL,
  term_id uuid NOT NULL,
  date date NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  draft_version integer,
  published_version integer,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id), UNIQUE(class_section_id,date),
  FOREIGN KEY(school_id,class_section_id) REFERENCES class_sections(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,term_id) REFERENCES academic_terms(school_id,id) ON DELETE RESTRICT
);
CREATE INDEX day_plans_school_date_idx ON day_plans(school_id,date,class_section_id);
CREATE INDEX day_plans_term_idx ON day_plans(term_id);
CREATE INDEX day_plans_owner_idx ON day_plans(owner_id);

CREATE TABLE day_plan_versions (
  school_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  version integer NOT NULL CHECK(version>0),
  state text NOT NULL CHECK(state IN ('draft','published','superseded','discarded')),
  notice varchar(1200) NOT NULL DEFAULT '',
  reason varchar(500) NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  PRIMARY KEY(plan_id,version), UNIQUE(school_id,plan_id,version),
  FOREIGN KEY(school_id,plan_id) REFERENCES day_plans(school_id,id) ON DELETE CASCADE
);
CREATE INDEX day_plan_versions_creator_idx ON day_plan_versions(created_by);
ALTER TABLE day_plans ADD CONSTRAINT day_plan_draft_fk FOREIGN KEY(id,draft_version)
  REFERENCES day_plan_versions(plan_id,version) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE day_plans ADD CONSTRAINT day_plan_published_fk FOREIGN KEY(id,published_version)
  REFERENCES day_plan_versions(plan_id,version) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE day_plan_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  version integer NOT NULL,
  period_number smallint NOT NULL CHECK(period_number BETWEEN 1 AND 24),
  starts_at time NOT NULL, ends_at time NOT NULL CHECK(ends_at>starts_at),
  title varchar(120) NOT NULL CHECK(length(trim(title))>0),
  slot_type varchar(16) NOT NULL CHECK(slot_type IN ('class','break','activity')),
  room varchar(80) NOT NULL DEFAULT '',
  teacher_membership_id uuid,
  cancelled boolean NOT NULL DEFAULT false,
  materials text[] NOT NULL DEFAULT '{}',
  coverage_status text NOT NULL DEFAULT 'not_required' CHECK(coverage_status IN ('not_required','unassigned','pending','accepted','declined')),
  response_note varchar(500) NOT NULL DEFAULT '',
  response_source text CHECK(response_source IN ('app','phone','paper','in_person')),
  responded_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  responded_at timestamptz,
  received_at timestamptz,
  response_revision integer NOT NULL DEFAULT 0,
  UNIQUE(plan_id,version,period_number),
  FOREIGN KEY(school_id,plan_id,version) REFERENCES day_plan_versions(school_id,plan_id,version) ON DELETE CASCADE,
  FOREIGN KEY(school_id,teacher_membership_id) REFERENCES school_memberships(school_id,id) ON DELETE RESTRICT,
  CHECK(cardinality(materials)<=12),
  CHECK(coverage_status NOT IN ('pending','accepted','declined') OR teacher_membership_id IS NOT NULL)
);
CREATE INDEX day_plan_periods_member_idx ON day_plan_periods(school_id,teacher_membership_id);
CREATE INDEX day_plan_periods_responder_idx ON day_plan_periods(responded_by);

CREATE TABLE day_plan_commands (
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  command_key uuid NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(school_id,actor_id,command_key)
);
CREATE INDEX day_plan_commands_actor_idx ON day_plan_commands(actor_id);

-- A single read model is shared by Home, Timetable and day-plan conflict checks.
-- Published date-specific versions take precedence over the weekly baseline.
CREATE FUNCTION effective_school_schedule(p_school uuid,p_date date)
RETURNS TABLE(id uuid,class_section_id uuid,term_id uuid,weekday smallint,period_number smallint,
  starts_at time,ends_at time,title text,slot_type varchar,room varchar,teacher_user_id uuid,
  teacher_designation text,subject_id uuid,materials text[],cancelled boolean,
  day_plan_id uuid,plan_version integer,notice text,coverage_status text)
LANGUAGE sql STABLE AS $$
  SELECT p.id,d.class_section_id,d.term_id,extract(isodow FROM p_date)::smallint,p.period_number,
    p.starts_at,p.ends_at,p.title::text,p.slot_type,p.room,m.user_id,'Teacher'::text,NULL::uuid,
    p.materials,p.cancelled,d.id,d.published_version,v.notice::text,p.coverage_status
  FROM day_plans d JOIN day_plan_versions v ON v.plan_id=d.id AND v.version=d.published_version
  JOIN day_plan_periods p ON p.plan_id=v.plan_id AND p.version=v.version
  LEFT JOIN school_memberships m ON m.id=p.teacher_membership_id
  WHERE d.school_id=p_school AND d.date=p_date
  UNION ALL
  SELECT s.id,s.class_section_id,s.term_id,s.weekday,s.period_number,s.starts_at,s.ends_at,
    COALESCE(subject.name,s.title)::text,s.slot_type,s.room,s.teacher_user_id,s.teacher_designation::text,
    s.subject_id,'{}'::text[],false,NULL::uuid,NULL::integer,''::text,
    CASE WHEN s.teacher_user_id IS NULL AND s.slot_type='class' THEN 'unassigned' ELSE 'not_required' END
  FROM timetable_slots s JOIN class_sections c ON c.id=s.class_section_id
  JOIN academic_terms t ON t.id=s.term_id AND t.school_id=c.school_id
  LEFT JOIN subjects subject ON subject.id=s.subject_id
  WHERE c.school_id=p_school AND s.weekday=extract(isodow FROM p_date)
    AND p_date BETWEEN t.starts_on AND t.ends_on
    AND NOT EXISTS(SELECT 1 FROM day_plans d WHERE d.class_section_id=c.id AND d.date=p_date AND d.published_version IS NOT NULL)
    AND NOT EXISTS(SELECT 1 FROM school_calendar_days cal WHERE cal.school_id=p_school AND cal.date=p_date AND NOT cal.is_instructional)
$$;
REVOKE ALL ON FUNCTION effective_school_schedule(uuid,date) FROM PUBLIC;

DO $$ DECLARE table_name text; owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='students'::regclass;
  FOREACH table_name IN ARRAY ARRAY['day_plans','day_plan_versions','day_plan_periods','day_plan_commands'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',table_name);
    EXECUTE format('ALTER TABLE %I OWNER TO %I',table_name,owner_name);
  END LOOP;
  EXECUTE format('ALTER FUNCTION effective_school_schedule(uuid,date) OWNER TO %I',owner_name);
END $$;
