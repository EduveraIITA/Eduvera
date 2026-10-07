ALTER TABLE day_plan_versions ADD COLUMN baseline_hash text;
CREATE UNIQUE INDEX day_plan_one_draft_idx ON day_plan_versions(plan_id) WHERE state='draft';
CREATE UNIQUE INDEX day_plan_one_published_idx ON day_plan_versions(plan_id) WHERE state='published';
