-- Preserve the historical threshold invariant while accepting pass decisions
-- derived from an immutable configured grade band, including nonmonotonic bands.
ALTER TABLE grading_report_subjects ADD COLUMN policy_graded boolean NOT NULL DEFAULT false;
ALTER TABLE grading_report_subjects DROP CONSTRAINT grading_report_subjects_check1;
ALTER TABLE grading_report_subjects ADD CONSTRAINT grading_report_subjects_pass_basis CHECK (
  (NOT policy_graded AND ((pass_percentage IS NULL AND passed IS NULL) OR
    (pass_percentage IS NOT NULL AND (outcome<>'complete' OR passed IS NOT NULL)))) OR
  (policy_graded AND pass_percentage IS NULL AND
    ((outcome='complete' AND passed IS NOT NULL) OR (outcome<>'complete' AND passed IS NULL)))
);

CREATE FUNCTION validate_report_subject_policy_basis() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE frozen_policy jsonb; matched_band jsonb;
BEGIN
  SELECT batch.result_policy INTO frozen_policy FROM grading_report_batches batch
    WHERE batch.school_id=NEW.school_id AND batch.id=NEW.batch_id;
  IF NEW.policy_graded IS DISTINCT FROM (jsonb_typeof(frozen_policy)='object' AND frozen_policy IS NOT NULL) THEN
    RAISE EXCEPTION 'A report subject must retain its frozen policy pass basis';
  END IF;
  IF NEW.policy_graded AND NEW.outcome='complete' THEN
    SELECT band INTO matched_band FROM jsonb_array_elements(frozen_policy->'configuration'->'bands') band
      WHERE NEW.percentage >= (band->>'minimum_percentage')::numeric AND NEW.percentage <= (band->>'maximum_percentage')::numeric;
    IF matched_band IS NULL OR NEW.grade IS DISTINCT FROM matched_band->>'code'
      OR NEW.passed IS DISTINCT FROM (matched_band->>'passed')::boolean
      OR NEW.grade_points IS DISTINCT FROM (matched_band->>'grade_points')::numeric THEN
      RAISE EXCEPTION 'A configured report result must match its frozen policy band';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER grading_report_subject_policy_basis BEFORE INSERT OR UPDATE ON grading_report_subjects
  FOR EACH ROW EXECUTE FUNCTION validate_report_subject_policy_basis();
