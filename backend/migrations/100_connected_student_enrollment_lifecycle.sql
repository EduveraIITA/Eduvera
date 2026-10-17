-- Connected student lifecycle: preserve every enrollment while keeping exactly one
-- current placement per student and term. Changes use short-lived review records so
-- operators see downstream impact before committing a consequential decision.

ALTER TABLE enrollments
  ADD COLUMN inactive_from date,
  ADD COLUMN exit_kind text,
  ADD COLUMN exit_reason text,
  ADD COLUMN ended_by uuid REFERENCES users(id),
  ADD COLUMN ended_at timestamptz,
  ADD COLUMN revision integer NOT NULL DEFAULT 1;

UPDATE enrollments enrollment SET
  inactive_from=term.ends_on + 1,
  exit_kind='term_completed',
  exit_reason='Historical inactive enrollment migrated to the connected student record.',
  ended_at=now()
FROM academic_terms term WHERE term.id=enrollment.term_id AND NOT enrollment.is_active;

ALTER TABLE enrollments
  ADD CONSTRAINT enrollment_exit_kind_check CHECK (
    exit_kind IS NULL OR exit_kind IN ('class_move','withdrawn','transferred_out','term_completed')
  ),
  ADD CONSTRAINT enrollment_lifecycle_state_check CHECK (
    (is_active AND inactive_from IS NULL AND exit_kind IS NULL AND exit_reason IS NULL AND ended_by IS NULL AND ended_at IS NULL)
    OR
    (NOT is_active AND inactive_from IS NOT NULL AND exit_kind IS NOT NULL AND length(trim(exit_reason)) >= 3 AND ended_at IS NOT NULL)
  );

ALTER TABLE enrollments DROP CONSTRAINT enrollments_student_id_term_id_key;
ALTER TABLE enrollments DROP CONSTRAINT enrollments_class_section_id_term_id_roll_number_key;

CREATE UNIQUE INDEX enrollments_one_active_term_idx
  ON enrollments(student_id,term_id) WHERE is_active;
CREATE UNIQUE INDEX enrollments_active_roll_idx
  ON enrollments(class_section_id,term_id,roll_number) WHERE is_active;
CREATE INDEX enrollments_student_history_idx
  ON enrollments(student_id,enrolled_on DESC,id DESC);

CREATE TABLE student_enrollment_change_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  student_id uuid NOT NULL REFERENCES students(id),
  created_by uuid NOT NULL REFERENCES users(id),
  expected_enrollment_id uuid NOT NULL REFERENCES enrollments(id),
  expected_revision integer NOT NULL CHECK(expected_revision > 0),
  action text NOT NULL CHECK(action IN ('move_class','withdraw','transfer_out')),
  input jsonb NOT NULL,
  impact jsonb NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
  committed_at timestamptz,
  result_enrollment_id uuid REFERENCES enrollments(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    committed_at IS NULL
    OR (action='move_class' AND result_enrollment_id IS NOT NULL)
    OR (action IN ('withdraw','transfer_out') AND result_enrollment_id IS NULL)
  )
);
CREATE INDEX student_enrollment_change_reviews_actor_idx
  ON student_enrollment_change_reviews(created_by,created_at DESC);
CREATE INDEX student_enrollment_change_reviews_student_idx
  ON student_enrollment_change_reviews(school_id,student_id,created_at DESC);
CREATE INDEX student_enrollment_change_reviews_expiry_idx
  ON student_enrollment_change_reviews(expires_at) WHERE committed_at IS NULL;

ALTER TABLE student_enrollment_change_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON student_enrollment_change_reviews FROM PUBLIC;

DO $$
DECLARE application_owner name;
BEGIN
  SELECT tableowner INTO application_owner FROM pg_tables
    WHERE schemaname='public' AND tablename='students';
  IF application_owner IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.student_enrollment_change_reviews OWNER TO %I', application_owner);
  END IF;
END $$;
