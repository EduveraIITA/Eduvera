-- Work profiles describe eligibility. Active, scoped responsibilities activate
-- the internal capabilities required to perform the work. Raw role permissions
-- are migrated to dated exceptions and are no longer authoritative.

ALTER TABLE staff_responsibility_types
  RENAME COLUMN recommended_permissions TO capability_permissions;

-- The catalogue is executable policy, not an administrator-editable grant list.
-- Re-state the built-in mappings explicitly so upgraded and newly provisioned
-- institutions calculate the same access outcomes.
UPDATE staff_responsibility_types
SET capability_permissions = CASE code
  WHEN 'class_teacher' THEN ARRAY['attendance.view','attendance.record','photo.use','timetable.view','followups.manage','messages.view','messages.send','reports.comment']
  WHEN 'subject_teacher' THEN ARRAY['attendance.view','attendance.record','photo.use','timetable.view','assessments.view','assessments.mark']
  WHEN 'student_mentor' THEN ARRAY['followups.manage','messages.view','messages.send']
  WHEN 'section_coordinator' THEN ARRAY['attendance.view','timetable.view','followups.manage']
  WHEN 'event_coordinator' THEN ARRAY['events.view','events.manage']
  WHEN 'event_judge' THEN ARRAY['events.view']
  WHEN 'event_escort' THEN ARRAY['events.view','events.attendance']
  WHEN 'event_attendance' THEN ARRAY['events.view','events.attendance']
  WHEN 'exam_in_charge' THEN ARRAY['assessments.view','assessments.moderate']
  WHEN 'invigilator' THEN ARRAY['assessments.view']
  WHEN 'internal_examiner' THEN ARRAY['assessments.view','assessments.mark']
  WHEN 'school_duty' THEN ARRAY['dayplans.respond','timetable.view']
  WHEN 'transport_attendant' THEN ARRAY['departure.collect']
  WHEN 'safety_officer' THEN ARRAY['safeguarding.review']
  ELSE capability_permissions
END;

ALTER TABLE school_custom_roles
  ADD COLUMN template_key varchar(48),
  ADD COLUMN system_managed boolean NOT NULL DEFAULT false;

ALTER TABLE school_custom_role_assignments
  ADD COLUMN is_primary boolean NOT NULL DEFAULT false,
  ADD COLUMN valid_from date NOT NULL DEFAULT current_date,
  ADD COLUMN valid_until date,
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD CONSTRAINT school_work_profile_assignment_dates CHECK (valid_until IS NULL OR valid_until >= valid_from);

UPDATE school_custom_role_assignments SET is_primary=true;
ALTER TABLE school_custom_role_assignments DROP CONSTRAINT school_custom_role_assignments_pkey;
ALTER TABLE school_custom_role_assignments
  ADD PRIMARY KEY (school_id,user_id,role_id);
CREATE UNIQUE INDEX school_work_profile_one_primary
  ON school_custom_role_assignments(school_id,user_id)
  WHERE is_primary;
CREATE INDEX school_work_profile_active_member
  ON school_custom_role_assignments(school_id,user_id,valid_from,valid_until);

CREATE TABLE school_access_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission varchar(80) NOT NULL CHECK (permission = ANY(ARRAY[
    'members.invite','sis.manage','fees.manage','attendance.view','attendance.record','photo.use',
    'timetable.view','dayplans.respond','followups.manage','messages.view','messages.send','groups.create',
    'safeguarding.review','events.view','events.manage','events.attendance','assessments.view',
    'assessments.mark','assessments.moderate','reports.comment','departure.manage','departure.collect','ai.use'
  ]::text[])),
  reason varchar(500) NOT NULL CHECK (length(trim(reason)) >= 8),
  source_kind varchar(24) NOT NULL CHECK (source_kind IN ('manual','migration_profile','migration_individual')),
  scope_kind varchar(24) NOT NULL DEFAULT 'institution' CHECK (scope_kind IN ('institution','assigned_resources')),
  valid_from date NOT NULL,
  valid_until date NOT NULL,
  review_due_on date NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  created_by uuid REFERENCES users(id),
  revoked_by uuid REFERENCES users(id),
  revoked_at timestamptz,
  revocation_reason varchar(500) NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until >= valid_from),
  CHECK (review_due_on BETWEEN valid_from AND valid_until),
  CHECK (source_kind <> 'manual' OR created_by IS NOT NULL),
  CHECK ((status='revoked') = (revoked_at IS NOT NULL))
);
CREATE INDEX school_access_exception_effective
  ON school_access_exceptions(school_id,user_id,permission,valid_from,valid_until)
  WHERE status='active';

CREATE OR REPLACE FUNCTION validate_school_access_exception()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM school_memberships membership
    WHERE membership.school_id=NEW.school_id AND membership.user_id=NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Access exception subject must belong to the institution' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER school_access_exception_scope_guard
  AFTER INSERT OR UPDATE ON school_access_exceptions
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
  EXECUTE FUNCTION validate_school_access_exception();
REVOKE ALL ON FUNCTION validate_school_access_exception() FROM PUBLIC;

-- Preserve already-delegated access for a bounded review period. The records are
-- visibly labelled migration exceptions instead of silently becoming profile authority.
INSERT INTO school_access_exceptions(
  school_id,user_id,permission,reason,source_kind,scope_kind,
  valid_from,valid_until,review_due_on
)
SELECT assignment.school_id,assignment.user_id,permission,
  'Migrated from the previous work-role access selection; administrator review required.',
  'migration_profile','institution',current_date,current_date+90,current_date+60
FROM school_custom_role_assignments assignment
JOIN school_custom_roles role ON role.school_id=assignment.school_id AND role.id=assignment.role_id
CROSS JOIN LATERAL unnest(role.permissions) AS permission
ON CONFLICT DO NOTHING;

INSERT INTO school_access_exceptions(
  school_id,user_id,permission,reason,source_kind,scope_kind,
  valid_from,valid_until,review_due_on
)
SELECT grant_row.school_id,grant_row.user_id,grant_row.permission,
  'Migrated from an individual delegated permission; administrator review required.',
  'migration_individual','institution',current_date,current_date+90,current_date+60
FROM school_permission_grants grant_row
ON CONFLICT DO NOTHING;

INSERT INTO school_access_exceptions(
  school_id,user_id,permission,reason,source_kind,scope_kind,
  valid_from,valid_until,review_due_on
)
SELECT membership.school_id,membership.user_id,permission,
  'Temporary continuity for a legacy staff account without a reviewed work profile.',
  'migration_individual','assigned_resources',current_date,current_date+90,current_date+60
FROM school_memberships membership
CROSS JOIN LATERAL unnest(ARRAY[
  'attendance.view','attendance.record','photo.use','timetable.view','dayplans.respond',
  'followups.manage','messages.view','messages.send','groups.create','safeguarding.review',
  'events.view','events.manage','events.attendance','assessments.view','assessments.mark',
  'assessments.moderate','reports.comment','departure.manage','departure.collect','ai.use'
]::text[]) AS permission
WHERE membership.role='staff' AND membership.is_active
  AND NOT EXISTS (
    SELECT 1 FROM school_custom_role_assignments profile
    WHERE profile.school_id=membership.school_id AND profile.user_id=membership.user_id
  );

UPDATE school_custom_roles SET permissions='{}'::text[] WHERE cardinality(permissions)>0;
DELETE FROM school_permission_grants;

-- Institution-wide operational appointments complete the controlled catalogue.
INSERT INTO staff_responsibility_types(
  school_id,code,name,category,scope_kind,description,access_summary,
  capability_permissions,requires_acceptance,restricted
)
SELECT school.id,template.code,template.name,template.category,template.scope_kind,
  template.description,template.access_summary,template.capability_permissions,
  template.requires_acceptance,template.restricted
FROM schools school CROSS JOIN (VALUES
  ('student_records_officer','Student records officer','operations','school','Maintain learner, guardian, class and enrolment records.','Institution student and academic records.',ARRAY['sis.manage']::text[],true,true),
  ('membership_coordinator','Membership coordinator','operations','school','Invite and revoke ordinary institution members.','Institution invitations and ordinary member onboarding.',ARRAY['members.invite']::text[],true,true),
  ('finance_officer','Finance officer','operations','school','Maintain fee obligations, receipts and reconciliation records.','Institution finance records and receipts.',ARRAY['fees.manage']::text[],true,true),
  ('transport_coordinator','Transport coordinator','operations','school','Plan routes, rosters, staffing and transport exceptions.','Institution transport planning and operations.',ARRAY['departure.manage']::text[],true,true),
  ('assessment_coordinator','Assessment coordinator','examination','school','Coordinate assessment schedules, moderation and release readiness.','Institution assessment operations and assigned moderation.',ARRAY['assessments.view','assessments.moderate']::text[],true,true),
  ('communications_coordinator','Communications coordinator','operations','school','Coordinate institution messages and supported groups.','Institution communication tools within recipient policy.',ARRAY['messages.view','messages.send','groups.create']::text[],true,true)
) AS template(code,name,category,scope_kind,description,access_summary,capability_permissions,requires_acceptance,restricted)
ON CONFLICT (school_id,code) DO UPDATE SET
  description=EXCLUDED.description,
  access_summary=EXCLUDED.access_summary,
  capability_permissions=EXCLUDED.capability_permissions,
  requires_acceptance=EXCLUDED.requires_acceptance,
  restricted=EXCLUDED.restricted;

CREATE OR REPLACE FUNCTION seed_staff_responsibility_catalog()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  INSERT INTO staff_responsibility_types(
    school_id,code,name,category,scope_kind,description,access_summary,
    capability_permissions,requires_acceptance,restricted
  )
  SELECT NEW.id,template.code,template.name,template.category,template.scope_kind,
    template.description,template.access_summary,template.capability_permissions,
    template.requires_acceptance,template.restricted
  FROM (VALUES
    ('class_teacher','Class teacher','academic','class_section','Pastoral and daily coordination for one class section.','Class roster, attendance follow-up and family coordination for the assigned section.',ARRAY['attendance.view','attendance.record','photo.use','timetable.view','followups.manage','messages.view','messages.send','reports.comment']::text[],false,false),
    ('subject_teacher','Subject teacher','academic','class_section','Instruction responsibility for a subject and class section.','Assigned class timetable, attendance and learning records.',ARRAY['attendance.view','attendance.record','photo.use','timetable.view','assessments.view','assessments.mark']::text[],false,false),
    ('student_mentor','Student mentor','student_support','class_section','Time-bounded mentoring responsibility.','Only the assigned cohort and documented mentoring actions.',ARRAY['followups.manage','messages.view','messages.send']::text[],true,true),
    ('section_coordinator','Section coordinator','academic','class_section','Coordinate teaching and exceptions for a section.','Section timetable health and approved class-level actions.',ARRAY['attendance.view','timetable.view','followups.manage']::text[],true,false),
    ('event_coordinator','Event coordinator','event','event','Own event readiness and operational decisions.','Assigned event plan, checklist, roster readiness and staff duties.',ARRAY['events.view','events.manage']::text[],true,false),
    ('event_judge','Event judge','event','event','Judge a school competition or showcase.','Only the assigned event, participants and published rubric.',ARRAY['events.view']::text[],true,true),
    ('event_escort','Event escort','event','event','Supervise students during an event or excursion.','Assigned event roster, emergency contacts and check-in actions.',ARRAY['events.view','events.attendance']::text[],true,true),
    ('event_attendance','Event attendance lead','event','event','Record attendance for an event session.','Assigned event roster and attendance sessions.',ARRAY['events.view','events.attendance']::text[],true,false),
    ('exam_in_charge','Exam in-charge','examination','scheduled_duty','Coordinate a dated examination duty.','Only the named examination window and operational checklist.',ARRAY['assessments.view','assessments.moderate']::text[],true,true),
    ('invigilator','Invigilator','examination','scheduled_duty','Supervise a scheduled examination room.','Only the assigned date, time, room and candidate list.',ARRAY['assessments.view']::text[],true,true),
    ('internal_examiner','Internal examiner','examination','scheduled_duty','Evaluate a scheduled internal assessment.','Only the assigned assessment and approved evaluation workflow.',ARRAY['assessments.view','assessments.mark']::text[],true,true),
    ('school_duty','School duty','operations','scheduled_duty','Time-bounded operational duty such as arrival, dispersal or assembly.','Only the assigned time window, location and duty checklist.',ARRAY['dayplans.respond','timetable.view']::text[],true,false),
    ('transport_attendant','Transport attendant','operations','scheduled_duty','Operate an assigned route, rider roster and journey handovers.','Only assigned journeys, riders, handovers and journey location sharing.',ARRAY['departure.collect']::text[],true,true),
    ('student_records_officer','Student records officer','operations','school','Maintain learner, guardian, class and enrolment records.','Institution student and academic records.',ARRAY['sis.manage']::text[],true,true),
    ('membership_coordinator','Membership coordinator','operations','school','Invite and revoke ordinary institution members.','Institution invitations and ordinary member onboarding.',ARRAY['members.invite']::text[],true,true),
    ('finance_officer','Finance officer','operations','school','Maintain fee obligations, receipts and reconciliation records.','Institution finance records and receipts.',ARRAY['fees.manage']::text[],true,true),
    ('transport_coordinator','Transport coordinator','operations','school','Plan routes, rosters, staffing and transport exceptions.','Institution transport planning and operations.',ARRAY['departure.manage']::text[],true,true),
    ('assessment_coordinator','Assessment coordinator','examination','school','Coordinate assessment schedules, moderation and release readiness.','Institution assessment operations and assigned moderation.',ARRAY['assessments.view','assessments.moderate']::text[],true,true),
    ('communications_coordinator','Communications coordinator','operations','school','Coordinate institution messages and supported groups.','Institution communication tools within recipient policy.',ARRAY['messages.view','messages.send','groups.create']::text[],true,true),
    ('safety_officer','Safety officer','governance','school','School-wide statutory or safety coordination appointment.','Safety procedures, incident readiness and assigned compliance records.',ARRAY['safeguarding.review']::text[],true,true),
    ('committee_member','Committee member','governance','school','Time-bounded committee appointment.','Only the named committee workspace and approved records.','{}'::text[],true,true)
  ) AS template(code,name,category,scope_kind,description,access_summary,capability_permissions,requires_acceptance,restricted)
  ON CONFLICT (school_id,code) DO UPDATE SET
    description=EXCLUDED.description,
    access_summary=EXCLUDED.access_summary,
    capability_permissions=EXCLUDED.capability_permissions,
    requires_acceptance=EXCLUDED.requires_acceptance,
    restricted=EXCLUDED.restricted;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION seed_staff_responsibility_catalog() FROM PUBLIC;

ALTER TABLE school_access_exceptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE school_access_exceptions FROM PUBLIC;

-- Realtime replay must use the same calculated finance authority as request
-- guards. The previous wrappers intentionally remain as the fallback for
-- guardians, learners, administrators and event-assigned staff.
ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid)
  RENAME TO event_user_is_authorized_before_work_profiles;
CREATE FUNCTION event_user_is_authorized(
  event_school_id uuid,
  event_name text,
  event_payload jsonb,
  candidate_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public
AS $$
  SELECT CASE WHEN (
    event_name='fees.updated'
    OR (
      event_name='campus_event.updated'
      AND event_payload->>'change_kind' IN ('participant_withdrawn','refund_recorded')
      AND EXISTS (
        SELECT 1 FROM campus_events event
        WHERE event.school_id=event_school_id AND event.id::text=event_payload->>'event_id'
      )
    )
  ) AND EXISTS (
    SELECT 1
    FROM school_memberships membership
    JOIN users account ON account.id=membership.user_id AND account.is_active
    WHERE membership.school_id=event_school_id
      AND membership.user_id=candidate_user_id
      AND membership.role='staff' AND membership.is_active
      AND (
        EXISTS (
          SELECT 1 FROM school_access_exceptions exception
          WHERE exception.school_id=membership.school_id
            AND exception.user_id=membership.user_id
            AND exception.permission='fees.manage' AND exception.status='active'
            AND current_date BETWEEN exception.valid_from AND exception.valid_until
        )
        OR EXISTS (
          SELECT 1
          FROM staff_responsibility_assignments assignment
          JOIN staff_profiles staff_profile ON staff_profile.id=assignment.staff_profile_id
            AND staff_profile.user_id=membership.user_id
          JOIN staff_responsibility_types responsibility_type
            ON responsibility_type.school_id=assignment.school_id
            AND responsibility_type.id=assignment.responsibility_type_id
          JOIN school_custom_role_assignments profile_assignment
            ON profile_assignment.school_id=assignment.school_id
            AND profile_assignment.user_id=membership.user_id
            AND profile_assignment.valid_from<=current_date
            AND (profile_assignment.valid_until IS NULL OR profile_assignment.valid_until>=current_date)
          JOIN school_custom_role_duties eligible_duty
            ON eligible_duty.school_id=profile_assignment.school_id
            AND eligible_duty.role_id=profile_assignment.role_id
            AND eligible_duty.responsibility_type_id=responsibility_type.id
          WHERE assignment.school_id=membership.school_id
            AND assignment.status='active'
            AND assignment.starts_on<=current_date
            AND (assignment.ends_on IS NULL OR assignment.ends_on>=current_date)
            AND 'fees.manage'=ANY(responsibility_type.capability_permissions)
        )
      )
  ) THEN true ELSE event_user_is_authorized_before_work_profiles(
    event_school_id,event_name,event_payload,candidate_user_id
  ) END
$$;
REVOKE ALL ON FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) FROM PUBLIC;

DO $$
DECLARE runtime_owner text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE school_access_exceptions FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE school_access_exceptions FROM authenticated;
  END IF;
  SELECT pg_get_userbyid(relowner) INTO runtime_owner FROM pg_class WHERE oid='school_custom_roles'::regclass;
  EXECUTE format('ALTER TABLE school_access_exceptions OWNER TO %I',runtime_owner);
  EXECUTE format('ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO %I',runtime_owner);
END $$;
