-- Purpose-scoped staff responsibilities and leave coverage.
-- Login roles remain coarse; these records describe why a staff member may act,
-- within which school resource and for which dates.

CREATE TABLE staff_responsibility_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  code varchar(48) NOT NULL,
  name varchar(100) NOT NULL,
  category varchar(24) NOT NULL CHECK (category IN ('academic','student_support','event','examination','operations','governance')),
  scope_kind varchar(24) NOT NULL CHECK (scope_kind IN ('school','class_section','event','scheduled_duty')),
  description varchar(500) NOT NULL DEFAULT '',
  access_summary varchar(300) NOT NULL DEFAULT '',
  requires_acceptance boolean NOT NULL DEFAULT true,
  restricted boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);

CREATE TABLE staff_responsibility_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  responsibility_type_id uuid NOT NULL REFERENCES staff_responsibility_types(id),
  staff_profile_id uuid NOT NULL REFERENCES staff_profiles(id),
  class_section_id uuid REFERENCES class_sections(id),
  subject_id uuid REFERENCES subjects(id),
  event_id uuid REFERENCES campus_events(id),
  scope_label varchar(180) NOT NULL DEFAULT '',
  location varchar(120) NOT NULL DEFAULT '',
  starts_on date NOT NULL,
  ends_on date,
  starts_at time,
  ends_at time,
  status varchar(20) NOT NULL CHECK (status IN ('offered','active','declined','completed','revoked')),
  notes varchar(1000) NOT NULL DEFAULT '',
  assigned_by uuid NOT NULL REFERENCES users(id),
  responded_at timestamptz,
  response_note varchar(500) NOT NULL DEFAULT '',
  revoked_by uuid REFERENCES users(id),
  revoked_at timestamptz,
  revocation_reason varchar(500) NOT NULL DEFAULT '',
  backup_staff_profile_id uuid REFERENCES staff_profiles(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CHECK ((starts_at IS NULL AND ends_at IS NULL) OR (starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at)),
  CHECK (staff_profile_id IS DISTINCT FROM backup_staff_profile_id)
);
CREATE INDEX staff_responsibilities_school_status_idx ON staff_responsibility_assignments(school_id,status,starts_on);
CREATE INDEX staff_responsibilities_profile_idx ON staff_responsibility_assignments(staff_profile_id,status,starts_on);
CREATE INDEX staff_responsibilities_event_idx ON staff_responsibility_assignments(event_id) WHERE event_id IS NOT NULL;

CREATE TABLE staff_responsibility_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES staff_responsibility_assignments(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  action varchar(24) NOT NULL CHECK (action IN ('offered','activated','accepted','declined','completed','revoked')),
  from_status varchar(20),
  to_status varchar(20) NOT NULL,
  note varchar(500) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_responsibility_audits_assignment_idx ON staff_responsibility_audits(assignment_id,created_at);

CREATE TABLE staff_coverage_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  leave_request_id uuid NOT NULL REFERENCES staff_leave_requests(id) ON DELETE CASCADE,
  absent_staff_profile_id uuid NOT NULL REFERENCES staff_profiles(id),
  replacement_staff_profile_id uuid REFERENCES staff_profiles(id),
  responsibility_assignment_id uuid REFERENCES staff_responsibility_assignments(id) ON DELETE SET NULL,
  source_schedule_id uuid,
  class_section_id uuid REFERENCES class_sections(id),
  subject_id uuid REFERENCES subjects(id),
  duty_date date NOT NULL,
  period_number smallint,
  starts_at time,
  ends_at time,
  title varchar(180) NOT NULL,
  location varchar(120) NOT NULL DEFAULT '',
  status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','offered','accepted','declined','completed','cancelled')),
  handover_note varchar(1000) NOT NULL DEFAULT '',
  assigned_by uuid REFERENCES users(id),
  offered_at timestamptz,
  responded_at timestamptz,
  response_note varchar(500) NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (absent_staff_profile_id IS DISTINCT FROM replacement_staff_profile_id),
  CHECK ((starts_at IS NULL AND ends_at IS NULL) OR (starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at))
);
CREATE UNIQUE INDEX staff_coverage_schedule_key ON staff_coverage_tasks(leave_request_id,duty_date,source_schedule_id) WHERE source_schedule_id IS NOT NULL;
CREATE UNIQUE INDEX staff_coverage_responsibility_key ON staff_coverage_tasks(leave_request_id,duty_date,responsibility_assignment_id) WHERE responsibility_assignment_id IS NOT NULL;
CREATE INDEX staff_coverage_school_status_idx ON staff_coverage_tasks(school_id,status,duty_date);
CREATE INDEX staff_coverage_replacement_idx ON staff_coverage_tasks(replacement_staff_profile_id,status,duty_date);

CREATE TABLE staff_coverage_task_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES staff_coverage_tasks(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  action varchar(24) NOT NULL CHECK (action IN ('created','offered','accepted','declined','reassigned','completed','cancelled')),
  from_status varchar(20),
  to_status varchar(20) NOT NULL,
  note varchar(500) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_coverage_audits_task_idx ON staff_coverage_task_audits(task_id,created_at);

CREATE OR REPLACE FUNCTION bump_staff_assignment_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER staff_responsibility_revision_guard BEFORE UPDATE ON staff_responsibility_assignments
  FOR EACH ROW EXECUTE FUNCTION bump_staff_assignment_revision();
CREATE TRIGGER staff_coverage_revision_guard BEFORE UPDATE ON staff_coverage_tasks
  FOR EACH ROW EXECUTE FUNCTION bump_staff_assignment_revision();
REVOKE ALL ON FUNCTION bump_staff_assignment_revision() FROM PUBLIC;

CREATE OR REPLACE FUNCTION validate_staff_assignment_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE type_school uuid; type_scope varchar; profile_school uuid; class_school uuid; subject_school uuid; event_school uuid; backup_school uuid;
BEGIN
  SELECT school_id,scope_kind INTO type_school,type_scope FROM staff_responsibility_types WHERE id=NEW.responsibility_type_id;
  SELECT school_id INTO profile_school FROM staff_profiles WHERE id=NEW.staff_profile_id;
  IF NEW.class_section_id IS NOT NULL THEN SELECT school_id INTO class_school FROM class_sections WHERE id=NEW.class_section_id; END IF;
  IF NEW.subject_id IS NOT NULL THEN SELECT school_id INTO subject_school FROM subjects WHERE id=NEW.subject_id; END IF;
  IF NEW.event_id IS NOT NULL THEN SELECT school_id INTO event_school FROM campus_events WHERE id=NEW.event_id; END IF;
  IF NEW.backup_staff_profile_id IS NOT NULL THEN SELECT school_id INTO backup_school FROM staff_profiles WHERE id=NEW.backup_staff_profile_id; END IF;
  IF NEW.school_id IS DISTINCT FROM type_school OR NEW.school_id IS DISTINCT FROM profile_school
    OR (class_school IS NOT NULL AND NEW.school_id IS DISTINCT FROM class_school)
    OR (subject_school IS NOT NULL AND NEW.school_id IS DISTINCT FROM subject_school)
    OR (event_school IS NOT NULL AND NEW.school_id IS DISTINCT FROM event_school)
    OR (backup_school IS NOT NULL AND NEW.school_id IS DISTINCT FROM backup_school) THEN
    RAISE EXCEPTION 'Responsibility references must belong to one school' USING ERRCODE='23514';
  END IF;
  IF (type_scope='class_section' AND (NEW.class_section_id IS NULL OR NEW.event_id IS NOT NULL))
    OR (type_scope='event' AND (NEW.event_id IS NULL OR NEW.class_section_id IS NOT NULL OR NEW.subject_id IS NOT NULL))
    OR (type_scope IN ('school','scheduled_duty') AND (NEW.class_section_id IS NOT NULL OR NEW.event_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'Responsibility scope does not match its type' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER staff_assignment_scope_guard AFTER INSERT OR UPDATE ON staff_responsibility_assignments
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION validate_staff_assignment_scope();
REVOKE ALL ON FUNCTION validate_staff_assignment_scope() FROM PUBLIC;

INSERT INTO staff_responsibility_types(school_id,code,name,category,scope_kind,description,access_summary,requires_acceptance,restricted)
SELECT school.id,template.code,template.name,template.category,template.scope_kind,template.description,template.access_summary,template.requires_acceptance,template.restricted
FROM schools school CROSS JOIN (VALUES
  ('class_teacher','Class teacher','academic','class_section','Pastoral and daily coordination for one class section.','Class roster, attendance follow-up and family coordination for the assigned section.',false,false),
  ('subject_teacher','Subject teacher','academic','class_section','Instruction responsibility for a subject and class section.','Assigned class timetable, attendance and learning records.',false,false),
  ('student_mentor','Student mentor','student_support','class_section','Time-bounded mentoring responsibility.','Only the assigned cohort and documented mentoring actions.',true,true),
  ('section_coordinator','Section coordinator','academic','class_section','Coordinate teaching and exceptions for a section.','Section timetable health and approved class-level actions.',true,false),
  ('event_coordinator','Event coordinator','event','event','Own event readiness and operational decisions.','Assigned event plan, checklist, roster readiness and staff duties.',true,false),
  ('event_judge','Event judge','event','event','Judge a school competition or showcase.','Only the assigned event, participants and published rubric.',true,true),
  ('event_escort','Event escort','event','event','Supervise students during an event or excursion.','Assigned event roster, emergency contacts and check-in actions.',true,true),
  ('event_attendance','Event attendance lead','event','event','Record attendance for an event session.','Assigned event roster and attendance sessions.',true,false),
  ('exam_in_charge','Exam in-charge','examination','scheduled_duty','Coordinate a dated examination duty.','Only the named examination window and operational checklist.',true,true),
  ('invigilator','Invigilator','examination','scheduled_duty','Supervise a scheduled examination room.','Only the assigned date, time, room and candidate list.',true,true),
  ('internal_examiner','Internal examiner','examination','scheduled_duty','Evaluate a scheduled internal assessment.','Only the assigned assessment and approved evaluation workflow.',true,true),
  ('school_duty','School duty','operations','scheduled_duty','Time-bounded operational duty such as arrival, dispersal or assembly.','Only the assigned time window, location and duty checklist.',true,false),
  ('safety_officer','Safety officer','governance','school','School-wide statutory or safety coordination appointment.','Safety procedures, incident readiness and assigned compliance records.',true,true),
  ('committee_member','Committee member','governance','school','Time-bounded committee appointment.','Only the named committee workspace and approved records.',true,true)
) AS template(code,name,category,scope_kind,description,access_summary,requires_acceptance,restricted)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION seed_staff_responsibility_catalog()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  INSERT INTO staff_responsibility_types(school_id,code,name,category,scope_kind,description,access_summary,requires_acceptance,restricted)
  SELECT NEW.id,template.code,template.name,template.category,template.scope_kind,template.description,template.access_summary,template.requires_acceptance,template.restricted
  FROM (VALUES
    ('class_teacher','Class teacher','academic','class_section','Pastoral and daily coordination for one class section.','Class roster, attendance follow-up and family coordination for the assigned section.',false,false),
    ('subject_teacher','Subject teacher','academic','class_section','Instruction responsibility for a subject and class section.','Assigned class timetable, attendance and learning records.',false,false),
    ('student_mentor','Student mentor','student_support','class_section','Time-bounded mentoring responsibility.','Only the assigned cohort and documented mentoring actions.',true,true),
    ('section_coordinator','Section coordinator','academic','class_section','Coordinate teaching and exceptions for a section.','Section timetable health and approved class-level actions.',true,false),
    ('event_coordinator','Event coordinator','event','event','Own event readiness and operational decisions.','Assigned event plan, checklist, roster readiness and staff duties.',true,false),
    ('event_judge','Event judge','event','event','Judge a school competition or showcase.','Only the assigned event, participants and published rubric.',true,true),
    ('event_escort','Event escort','event','event','Supervise students during an event or excursion.','Assigned event roster, emergency contacts and check-in actions.',true,true),
    ('event_attendance','Event attendance lead','event','event','Record attendance for an event session.','Assigned event roster and attendance sessions.',true,false),
    ('exam_in_charge','Exam in-charge','examination','scheduled_duty','Coordinate a dated examination duty.','Only the named examination window and operational checklist.',true,true),
    ('invigilator','Invigilator','examination','scheduled_duty','Supervise a scheduled examination room.','Only the assigned date, time, room and candidate list.',true,true),
    ('internal_examiner','Internal examiner','examination','scheduled_duty','Evaluate a scheduled internal assessment.','Only the assigned assessment and approved evaluation workflow.',true,true),
    ('school_duty','School duty','operations','scheduled_duty','Time-bounded operational duty such as arrival, dispersal or assembly.','Only the assigned time window, location and duty checklist.',true,false),
    ('safety_officer','Safety officer','governance','school','School-wide statutory or safety coordination appointment.','Safety procedures, incident readiness and assigned compliance records.',true,true),
    ('committee_member','Committee member','governance','school','Time-bounded committee appointment.','Only the named committee workspace and approved records.',true,true)
  ) AS template(code,name,category,scope_kind,description,access_summary,requires_acceptance,restricted)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER schools_staff_responsibility_catalog AFTER INSERT ON schools
  FOR EACH ROW EXECUTE FUNCTION seed_staff_responsibility_catalog();
REVOKE ALL ON FUNCTION seed_staff_responsibility_catalog() FROM PUBLIC;

-- Preserve existing academic and event ownership as active appointments.
INSERT INTO staff_responsibility_assignments(school_id,responsibility_type_id,staff_profile_id,class_section_id,subject_id,starts_on,ends_on,status,assigned_by,scope_label)
SELECT legacy.school_id,type.id,profile.id,legacy.class_section_id,legacy.subject_id,legacy.valid_from,legacy.valid_until,'active',legacy.assigned_by,
  'Class ' || section.grade || section.section || CASE WHEN subject.name IS NULL THEN '' ELSE ' · ' || subject.name END
FROM class_section_staff_assignments legacy
JOIN staff_profiles profile ON profile.school_id=legacy.school_id AND profile.user_id=legacy.user_id
JOIN staff_responsibility_types type ON type.school_id=legacy.school_id AND type.code=legacy.role
JOIN class_sections section ON section.id=legacy.class_section_id
LEFT JOIN subjects subject ON subject.id=legacy.subject_id
WHERE NOT EXISTS (
  SELECT 1 FROM staff_responsibility_assignments current
  WHERE current.school_id=legacy.school_id AND current.responsibility_type_id=type.id AND current.staff_profile_id=profile.id
    AND current.class_section_id=legacy.class_section_id AND current.subject_id IS NOT DISTINCT FROM legacy.subject_id
    AND current.starts_on=legacy.valid_from
);

INSERT INTO staff_responsibility_assignments(school_id,responsibility_type_id,staff_profile_id,event_id,scope_label,starts_on,ends_on,status,assigned_by)
SELECT legacy.school_id,type.id,profile.id,event.id,event.title,event.starts_at::date,event.ends_at::date,'active',event.created_by
FROM campus_event_staff legacy
JOIN campus_events event ON event.id=legacy.event_id
JOIN staff_profiles profile ON profile.school_id=legacy.school_id AND profile.user_id=legacy.user_id
JOIN staff_responsibility_types type ON type.school_id=legacy.school_id AND type.code=CASE legacy.role WHEN 'organizer' THEN 'event_coordinator' WHEN 'attendance_taker' THEN 'event_attendance' ELSE 'event_escort' END
WHERE NOT EXISTS (
  SELECT 1 FROM staff_responsibility_assignments current
  WHERE current.school_id=legacy.school_id AND current.responsibility_type_id=type.id AND current.staff_profile_id=profile.id AND current.event_id=legacy.event_id
);

ALTER TABLE staff_responsibility_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_responsibility_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_responsibility_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_coverage_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_coverage_task_audits ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE staff_responsibility_types,staff_responsibility_assignments,staff_responsibility_audits,staff_coverage_tasks,staff_coverage_task_audits FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE staff_responsibility_types,staff_responsibility_assignments,staff_responsibility_audits,staff_coverage_tasks,staff_coverage_task_audits FROM authenticated;
  END IF;
END $$;

DO $$ DECLARE table_name text; owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='students'::regclass;
  FOREACH table_name IN ARRAY ARRAY[
    'staff_responsibility_types','staff_responsibility_assignments','staff_responsibility_audits',
    'staff_coverage_tasks','staff_coverage_task_audits'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',table_name);
    EXECUTE format('ALTER TABLE %I OWNER TO %I',table_name,owner_name);
  END LOOP;
  EXECUTE format('ALTER FUNCTION bump_staff_assignment_revision() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION validate_staff_assignment_scope() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION seed_staff_responsibility_catalog() OWNER TO %I',owner_name);
END $$;
