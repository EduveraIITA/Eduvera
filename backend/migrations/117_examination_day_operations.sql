-- Physical examination-day operations. Result outcomes remain owned by the
-- assessment/result workflow and are deliberately separate from attendance.

CREATE TABLE assessment_operation_policies (
  school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  readiness_minutes_before integer NOT NULL DEFAULT 60 CHECK(readiness_minutes_before BETWEEN 0 AND 10080),
  attendance_close_after_minutes integer NOT NULL DEFAULT 60 CHECK(attendance_close_after_minutes BETWEEN 0 AND 10080),
  minimum_invigilators integer NOT NULL DEFAULT 1 CHECK(minimum_invigilators BETWEEN 1 AND 20),
  require_all_candidate_attendance boolean NOT NULL DEFAULT true,
  post_completion_marking_mode varchar(16) NOT NULL DEFAULT 'manual'
    CHECK(post_completion_marking_mode IN ('manual','automatic')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO assessment_operation_policies(school_id,updated_by)
SELECT id,created_by_user_id FROM schools ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION seed_assessment_operation_policy()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO assessment_operation_policies(school_id,updated_by)
  VALUES(NEW.id,NEW.created_by_user_id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER schools_seed_assessment_operation_policy
AFTER INSERT ON schools FOR EACH ROW EXECUTE FUNCTION seed_assessment_operation_policy();

CREATE TABLE assessment_sittings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  campus_id uuid NOT NULL,
  space_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  state varchar(20) NOT NULL DEFAULT 'planning'
    CHECK(state IN ('planning','ready','in_progress','completed','cancelled')),
  policy_revision integer NOT NULL CHECK(policy_revision > 0),
  policy_snapshot jsonb NOT NULL,
  roster_frozen_at timestamptz,
  started_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  started_at timestamptz,
  completed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  completed_at timestamptz,
  cancelled_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  cancelled_at timestamptz,
  cancellation_reason varchar(500) NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  UNIQUE(school_id,id,assessment_id),
  UNIQUE(assessment_id),
  FOREIGN KEY(school_id,assessment_id) REFERENCES assessments(school_id,id) ON DELETE CASCADE,
  FOREIGN KEY(space_id,school_id,campus_id) REFERENCES campus_spaces(id,school_id,campus_id) ON DELETE RESTRICT,
  CHECK(ends_at > starts_at),
  CHECK((started_at IS NULL)=(started_by IS NULL)),
  CHECK((completed_at IS NULL)=(completed_by IS NULL)),
  CHECK((cancelled_at IS NULL)=(cancelled_by IS NULL)),
  CHECK(state <> 'ready' OR roster_frozen_at IS NOT NULL),
  CHECK(state <> 'in_progress' OR (roster_frozen_at IS NOT NULL AND started_at IS NOT NULL)),
  CHECK(state <> 'completed' OR (roster_frozen_at IS NOT NULL AND started_at IS NOT NULL AND completed_at IS NOT NULL)),
  CHECK(state <> 'cancelled' OR length(trim(cancellation_reason)) >= 3)
);
CREATE INDEX assessment_sittings_window_idx ON assessment_sittings(school_id,space_id,starts_at,ends_at,state);

CREATE TABLE assessment_sitting_invigilators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  sitting_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status varchar(16) NOT NULL DEFAULT 'offered'
    CHECK(status IN ('offered','accepted','declined','revoked')),
  response_note varchar(500) NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  assigned_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  UNIQUE(sitting_id,user_id),
  FOREIGN KEY(school_id,sitting_id) REFERENCES assessment_sittings(school_id,id) ON DELETE CASCADE,
  FOREIGN KEY(school_id,assessment_id) REFERENCES assessments(school_id,id) ON DELETE CASCADE,
  CONSTRAINT assessment_sitting_invigilators_sitting_assessment_fk
    FOREIGN KEY(school_id,sitting_id,assessment_id)
    REFERENCES assessment_sittings(school_id,id,assessment_id) ON DELETE CASCADE,
  CHECK(status='offered' OR responded_at IS NOT NULL)
);
CREATE INDEX assessment_sitting_invigilators_user_idx
  ON assessment_sitting_invigilators(school_id,user_id,status,sitting_id);

CREATE TABLE assessment_sitting_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  sitting_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  student_id uuid NOT NULL,
  enrollment_id uuid NOT NULL REFERENCES enrollments(id) ON DELETE RESTRICT,
  roll_number_snapshot integer,
  frozen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  UNIQUE(school_id,id,sitting_id,student_id),
  UNIQUE(sitting_id,student_id),
  FOREIGN KEY(school_id,sitting_id) REFERENCES assessment_sittings(school_id,id) ON DELETE CASCADE,
  FOREIGN KEY(school_id,assessment_id) REFERENCES assessments(school_id,id) ON DELETE CASCADE,
  CONSTRAINT assessment_sitting_candidates_sitting_assessment_fk
    FOREIGN KEY(school_id,sitting_id,assessment_id)
    REFERENCES assessment_sittings(school_id,id,assessment_id) ON DELETE CASCADE,
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT
);
CREATE INDEX assessment_sitting_candidates_roster_idx ON assessment_sitting_candidates(sitting_id,roll_number_snapshot,student_id);

CREATE TABLE assessment_candidate_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  sitting_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  student_id uuid NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'unrecorded'
    CHECK(status IN ('unrecorded','present','late','absent','left_early')),
  observed_at timestamptz,
  note varchar(500) NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  recorded_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  UNIQUE(candidate_id),
  FOREIGN KEY(school_id,sitting_id) REFERENCES assessment_sittings(school_id,id) ON DELETE CASCADE,
  FOREIGN KEY(school_id,candidate_id) REFERENCES assessment_sitting_candidates(school_id,id) ON DELETE CASCADE,
  CONSTRAINT assessment_candidate_attendance_candidate_chain_fk
    FOREIGN KEY(school_id,candidate_id,sitting_id,student_id)
    REFERENCES assessment_sitting_candidates(school_id,id,sitting_id,student_id) ON DELETE CASCADE,
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT,
  CHECK((status='unrecorded')=(observed_at IS NULL)),
  CHECK((status='unrecorded')=(recorded_by IS NULL))
);
CREATE INDEX assessment_candidate_attendance_sitting_idx ON assessment_candidate_attendance(sitting_id,status,student_id);

CREATE TABLE assessment_sitting_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  sitting_id uuid NOT NULL,
  candidate_id uuid,
  student_id uuid,
  category varchar(20) NOT NULL CHECK(category IN ('conduct','health','materials','timing','other')),
  severity varchar(12) NOT NULL CHECK(severity IN ('info','minor','major')),
  summary varchar(1000) NOT NULL CHECK(length(trim(summary)) >= 3),
  observed_at timestamptz NOT NULL,
  state varchar(12) NOT NULL DEFAULT 'open' CHECK(state IN ('open','resolved')),
  resolution varchar(1000) NOT NULL DEFAULT '',
  recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  resolved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  FOREIGN KEY(school_id,sitting_id) REFERENCES assessment_sittings(school_id,id) ON DELETE CASCADE,
  FOREIGN KEY(school_id,candidate_id) REFERENCES assessment_sitting_candidates(school_id,id) ON DELETE RESTRICT,
  CONSTRAINT assessment_sitting_incidents_candidate_chain_fk
    FOREIGN KEY(school_id,candidate_id,sitting_id,student_id)
    REFERENCES assessment_sitting_candidates(school_id,id,sitting_id,student_id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT,
  CHECK((candidate_id IS NULL)=(student_id IS NULL)),
  CHECK((resolved_at IS NULL)=(resolved_by IS NULL)),
  CHECK(state <> 'resolved' OR length(trim(resolution)) >= 3)
);
CREATE INDEX assessment_sitting_incidents_open_idx ON assessment_sitting_incidents(sitting_id,state,observed_at,id);

CREATE TABLE assessment_operation_audits (
  id bigserial PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  assessment_id uuid,
  sitting_id uuid,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action varchar(80) NOT NULL,
  from_state varchar(40),
  to_state varchar(40),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(school_id,assessment_id) REFERENCES assessments(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,sitting_id) REFERENCES assessment_sittings(school_id,id) ON DELETE RESTRICT,
  CONSTRAINT assessment_operation_audits_sitting_assessment_fk
    FOREIGN KEY(school_id,sitting_id,assessment_id)
    REFERENCES assessment_sittings(school_id,id,assessment_id) ON DELETE RESTRICT
);
CREATE INDEX assessment_operation_audits_trace_idx ON assessment_operation_audits(school_id,assessment_id,sitting_id,created_at,id);

ALTER TABLE assessment_operation_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_sittings ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_sitting_invigilators ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_sitting_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_candidate_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_sitting_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_operation_audits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON assessment_operation_policies,assessment_sittings,
  assessment_sitting_invigilators,assessment_sitting_candidates,
  assessment_candidate_attendance,assessment_sitting_incidents,
  assessment_operation_audits FROM PUBLIC;

-- Extend (rather than replace) the accumulated realtime authorization chain.
-- Frozen outbox audiences are routing hints; current membership, assignment and
-- enrollment are checked again when an event is delivered.
ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid)
  RENAME TO event_user_is_authorized_before_exam_operations;

CREATE FUNCTION event_user_is_authorized(
  event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE WHEN event_name='assessment.updated' THEN
    event_user_is_authorized_before_exam_operations(event_school_id,event_name,event_payload,candidate_user_id)
    OR EXISTS (
      SELECT 1 FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id AND account.is_active
      JOIN assessments assessment ON assessment.school_id=membership.school_id
        AND assessment.id::text=event_payload->>'assessment_id'
      WHERE membership.school_id=event_school_id AND membership.user_id=candidate_user_id AND membership.is_active
        AND (
          (membership.role IN ('staff','admin') AND EXISTS (
            SELECT 1 FROM assessment_sittings sitting
            JOIN assessment_sitting_invigilators invigilator ON invigilator.sitting_id=sitting.id
            WHERE sitting.assessment_id=assessment.id AND invigilator.user_id=membership.user_id
              AND invigilator.status IN ('offered','accepted')
          ))
          OR (event_payload->>'action' IN ('schedule','cancel') AND membership.role='student' AND EXISTS (
            SELECT 1 FROM assessment_cycles cycle JOIN enrollments enrollment
              ON enrollment.term_id=cycle.term_id AND enrollment.class_section_id=assessment.class_section_id
            JOIN students student ON student.id=enrollment.student_id
            JOIN schools school ON school.id=assessment.school_id
            WHERE cycle.id=assessment.cycle_id AND student.user_id=membership.user_id
              AND enrollment.is_active
              AND enrollment.enrolled_on<=COALESCE((assessment.scheduled_at AT TIME ZONE school.timezone)::date,current_date)
              AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>COALESCE((assessment.scheduled_at AT TIME ZONE school.timezone)::date,current_date))
          ))
          OR (event_payload->>'action' IN ('schedule','cancel') AND membership.role='guardian' AND EXISTS (
            SELECT 1 FROM assessment_cycles cycle JOIN enrollments enrollment
              ON enrollment.term_id=cycle.term_id AND enrollment.class_section_id=assessment.class_section_id
            JOIN guardian_relationships relationship ON relationship.school_id=assessment.school_id AND relationship.student_id=enrollment.student_id
            JOIN parents parent ON parent.id=relationship.guardian_id
            JOIN schools school ON school.id=assessment.school_id
            WHERE cycle.id=assessment.cycle_id AND parent.user_id=membership.user_id
              AND enrollment.is_active
              AND enrollment.enrolled_on<=COALESCE((assessment.scheduled_at AT TIME ZONE school.timezone)::date,current_date)
              AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>COALESCE((assessment.scheduled_at AT TIME ZONE school.timezone)::date,current_date))
          ))
        )
    )
  ELSE event_user_is_authorized_before_exam_operations(event_school_id,event_name,event_payload,candidate_user_id) END
$$;
REVOKE ALL ON FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) FROM PUBLIC;

DO $$ DECLARE runtime_owner text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO runtime_owner FROM pg_class WHERE oid='event_outbox'::regclass;
  EXECUTE format('ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO %I',runtime_owner);
END $$;

DO $$ DECLARE application_owner name; BEGIN
  SELECT tableowner INTO application_owner FROM pg_tables WHERE schemaname='public' AND tablename='schools';
  IF application_owner IS NOT NULL THEN
    EXECUTE format('ALTER TABLE assessment_operation_policies OWNER TO %I',application_owner);
    EXECUTE format('ALTER TABLE assessment_sittings OWNER TO %I',application_owner);
    EXECUTE format('ALTER TABLE assessment_sitting_invigilators OWNER TO %I',application_owner);
    EXECUTE format('ALTER TABLE assessment_sitting_candidates OWNER TO %I',application_owner);
    EXECUTE format('ALTER TABLE assessment_candidate_attendance OWNER TO %I',application_owner);
    EXECUTE format('ALTER TABLE assessment_sitting_incidents OWNER TO %I',application_owner);
    EXECUTE format('ALTER TABLE assessment_operation_audits OWNER TO %I',application_owner);
  END IF;
END $$;
