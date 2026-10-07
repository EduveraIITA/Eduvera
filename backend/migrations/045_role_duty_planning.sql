-- Role duties describe what a custom role is intended to perform.
-- They do not grant access. Recommended permissions help administrators configure
-- the role without turning a recommendation into an authorization side effect.

ALTER TABLE staff_responsibility_types
  ADD COLUMN recommended_permissions text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE staff_responsibility_types
  ADD CONSTRAINT staff_responsibility_types_school_id_id_key UNIQUE (school_id,id);

UPDATE staff_responsibility_types
SET recommended_permissions = CASE code
  WHEN 'class_teacher' THEN ARRAY['attendance.view','attendance.record','timetable.view','followups.manage','messages.view','messages.send','reports.comment']
  WHEN 'subject_teacher' THEN ARRAY['attendance.view','attendance.record','timetable.view','assessments.view','assessments.mark']
  WHEN 'student_mentor' THEN ARRAY['followups.manage','messages.view','messages.send']
  WHEN 'section_coordinator' THEN ARRAY['attendance.view','timetable.view','followups.manage']
  WHEN 'event_coordinator' THEN ARRAY['events.view','events.manage']
  WHEN 'event_judge' THEN ARRAY['events.view']
  WHEN 'event_escort' THEN ARRAY['events.view','events.attendance']
  WHEN 'event_attendance' THEN ARRAY['events.view','events.attendance']
  WHEN 'exam_in_charge' THEN ARRAY['assessments.view','assessments.moderate']
  WHEN 'invigilator' THEN ARRAY['assessments.view']
  WHEN 'internal_examiner' THEN ARRAY['assessments.view','assessments.mark']
  WHEN 'safety_officer' THEN ARRAY['safeguarding.review']
  ELSE '{}'::text[]
END;

INSERT INTO staff_responsibility_types(
  school_id,code,name,category,scope_kind,description,access_summary,
  recommended_permissions,requires_acceptance,restricted
)
SELECT school.id,'transport_attendant','Transport attendant','operations','scheduled_duty',
  'Operate an assigned route, rider roster and journey handovers.',
  'Only assigned journeys, riders, handovers and journey location sharing.',
  ARRAY['departure.collect']::text[],true,true
FROM schools school
ON CONFLICT (school_id,code) DO UPDATE SET
  recommended_permissions=EXCLUDED.recommended_permissions,
  access_summary=EXCLUDED.access_summary;

CREATE TABLE school_custom_role_duties (
  school_id uuid NOT NULL,
  role_id uuid NOT NULL,
  responsibility_type_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id,responsibility_type_id),
  FOREIGN KEY (school_id,role_id) REFERENCES school_custom_roles(school_id,id) ON DELETE CASCADE,
  FOREIGN KEY (school_id,responsibility_type_id) REFERENCES staff_responsibility_types(school_id,id) ON DELETE CASCADE
);
CREATE INDEX school_custom_role_duties_school_idx ON school_custom_role_duties(school_id,role_id);

-- Give existing roles a conservative starting duty set inferred from their current
-- access. Administrators can then review the role explicitly in the UI.
INSERT INTO school_custom_role_duties(school_id,role_id,responsibility_type_id)
SELECT role.school_id,role.id,type.id
FROM school_custom_roles role
JOIN staff_responsibility_types type ON type.school_id=role.school_id
WHERE (type.code='transport_attendant' AND 'departure.collect'=ANY(role.permissions))
   OR (type.code='class_teacher' AND 'reports.comment'=ANY(role.permissions))
   OR (type.code='subject_teacher' AND 'assessments.mark'=ANY(role.permissions))
   OR (type.code='section_coordinator' AND 'followups.manage'=ANY(role.permissions))
   OR (type.code='event_coordinator' AND 'events.manage'=ANY(role.permissions))
   OR (type.code='event_attendance' AND 'events.attendance'=ANY(role.permissions))
   OR (type.code='exam_in_charge' AND 'assessments.moderate'=ANY(role.permissions))
   OR (type.code='safety_officer' AND 'safeguarding.review'=ANY(role.permissions))
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION seed_staff_responsibility_catalog()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  INSERT INTO staff_responsibility_types(
    school_id,code,name,category,scope_kind,description,access_summary,
    recommended_permissions,requires_acceptance,restricted
  )
  SELECT NEW.id,template.code,template.name,template.category,template.scope_kind,
    template.description,template.access_summary,template.recommended_permissions,
    template.requires_acceptance,template.restricted
  FROM (VALUES
    ('class_teacher','Class teacher','academic','class_section','Pastoral and daily coordination for one class section.','Class roster, attendance follow-up and family coordination for the assigned section.',ARRAY['attendance.view','attendance.record','timetable.view','followups.manage','messages.view','messages.send','reports.comment']::text[],false,false),
    ('subject_teacher','Subject teacher','academic','class_section','Instruction responsibility for a subject and class section.','Assigned class timetable, attendance and learning records.',ARRAY['attendance.view','attendance.record','timetable.view','assessments.view','assessments.mark']::text[],false,false),
    ('student_mentor','Student mentor','student_support','class_section','Time-bounded mentoring responsibility.','Only the assigned cohort and documented mentoring actions.',ARRAY['followups.manage','messages.view','messages.send']::text[],true,true),
    ('section_coordinator','Section coordinator','academic','class_section','Coordinate teaching and exceptions for a section.','Section timetable health and approved class-level actions.',ARRAY['attendance.view','timetable.view','followups.manage']::text[],true,false),
    ('event_coordinator','Event coordinator','event','event','Own event readiness and operational decisions.','Assigned event plan, checklist, roster readiness and staff duties.',ARRAY['events.view','events.manage']::text[],true,false),
    ('event_judge','Event judge','event','event','Judge a school competition or showcase.','Only the assigned event, participants and published rubric.',ARRAY['events.view']::text[],true,true),
    ('event_escort','Event escort','event','event','Supervise students during an event or excursion.','Assigned event roster, emergency contacts and check-in actions.',ARRAY['events.view','events.attendance']::text[],true,true),
    ('event_attendance','Event attendance lead','event','event','Record attendance for an event session.','Assigned event roster and attendance sessions.',ARRAY['events.view','events.attendance']::text[],true,false),
    ('exam_in_charge','Exam in-charge','examination','scheduled_duty','Coordinate a dated examination duty.','Only the named examination window and operational checklist.',ARRAY['assessments.view','assessments.moderate']::text[],true,true),
    ('invigilator','Invigilator','examination','scheduled_duty','Supervise a scheduled examination room.','Only the assigned date, time, room and candidate list.',ARRAY['assessments.view']::text[],true,true),
    ('internal_examiner','Internal examiner','examination','scheduled_duty','Evaluate a scheduled internal assessment.','Only the assigned assessment and approved evaluation workflow.',ARRAY['assessments.view','assessments.mark']::text[],true,true),
    ('school_duty','School duty','operations','scheduled_duty','Time-bounded operational duty such as arrival, dispersal or assembly.','Only the assigned time window, location and duty checklist.','{}'::text[],true,false),
    ('transport_attendant','Transport attendant','operations','scheduled_duty','Operate an assigned route, rider roster and journey handovers.','Only assigned journeys, riders, handovers and journey location sharing.',ARRAY['departure.collect']::text[],true,true),
    ('safety_officer','Safety officer','governance','school','School-wide statutory or safety coordination appointment.','Safety procedures, incident readiness and assigned compliance records.',ARRAY['safeguarding.review']::text[],true,true),
    ('committee_member','Committee member','governance','school','Time-bounded committee appointment.','Only the named committee workspace and approved records.','{}'::text[],true,true)
  ) AS template(code,name,category,scope_kind,description,access_summary,recommended_permissions,requires_acceptance,restricted)
  ON CONFLICT (school_id,code) DO UPDATE SET
    recommended_permissions=EXCLUDED.recommended_permissions,
    access_summary=EXCLUDED.access_summary;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION seed_staff_responsibility_catalog() FROM PUBLIC;

ALTER TABLE school_custom_role_duties ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE school_custom_role_duties FROM PUBLIC;
DO $$
DECLARE runtime_owner text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE school_custom_role_duties FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE school_custom_role_duties FROM authenticated;
  END IF;
  SELECT pg_get_userbyid(relowner) INTO runtime_owner FROM pg_class WHERE oid='school_custom_roles'::regclass;
  EXECUTE format('ALTER TABLE school_custom_role_duties OWNER TO %I',runtime_owner);
END $$;
