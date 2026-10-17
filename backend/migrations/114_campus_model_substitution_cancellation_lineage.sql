-- A revoked staff-cover decision is a new temporal revision. It must not
-- rewrite either the accepted substitution or the schedule source that later
-- replaced it. The explicit change kind keeps that transition distinguishable
-- from publication, calendar, daily-plan and acceptance decisions.

ALTER TABLE public.campus_model_schedule_occurrences
  DROP CONSTRAINT campus_model_occurrence_change_kind_check,
  ADD CONSTRAINT campus_model_occurrence_change_kind_check
    CHECK(change_kind IN (
      'published','overridden','closure_cancelled','closure_restored',
      'day_plan_cancelled','substituted','substitution_cancelled',
      'projection_backfill'
    ));
