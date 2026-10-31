-- A recurring base may resume after a temporary change and later receive a
-- different, disjoint change. Keep immutable evidence and one child per change,
-- but do not mistake the first finite window for replacement of the whole base.
ALTER TABLE schedule_plan_supersessions DROP CONSTRAINT schedule_plan_supersessions_previous_version_id_key;
CREATE INDEX schedule_plan_supersessions_source_window
  ON schedule_plan_supersessions(school_id,previous_version_id,effective_from);

CREATE FUNCTION validate_schedule_plan_supersession_window() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE previous_plan schedule_versions%ROWTYPE; replacement_plan schedule_versions%ROWTYPE;
BEGIN
  -- Serialize even non-API insertion against the owning immutable source. A
  -- second transaction must see the first committed window before it can add
  -- one, rather than both passing a snapshot-only overlap check.
  SELECT * INTO previous_plan FROM schedule_versions
    WHERE school_id=NEW.school_id AND id=NEW.previous_version_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The previous plan is outside this institution' USING ERRCODE='23503'; END IF;
  SELECT * INTO replacement_plan FROM schedule_versions
    WHERE school_id=NEW.school_id AND id=NEW.replacement_version_id;
  IF NOT FOUND OR previous_plan.state<>'published' OR replacement_plan.state<>'published'
    OR previous_plan.planning_origin<>'activity' OR replacement_plan.planning_origin<>'activity'
    OR previous_plan.revision<>NEW.previous_source_revision OR replacement_plan.revision<>NEW.replacement_source_revision
    OR replacement_plan.replaces_version_id IS DISTINCT FROM previous_plan.id
    OR replacement_plan.replaces_source_revision IS DISTINCT FROM previous_plan.revision THEN
    RAISE EXCEPTION 'Published replacement evidence must match its exact owning plan versions' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM schedule_plan_supersessions existing
    WHERE existing.school_id=NEW.school_id AND existing.previous_version_id=NEW.previous_version_id
      AND tstzrange(existing.effective_from,existing.effective_until,'[)') && tstzrange(NEW.effective_from,NEW.effective_until,'[)')) THEN
    RAISE EXCEPTION 'Published replacement windows cannot overlap; change the active replacement instead' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER schedule_plan_supersession_window_guard BEFORE INSERT ON schedule_plan_supersessions
  FOR EACH ROW EXECUTE FUNCTION validate_schedule_plan_supersession_window();
REVOKE ALL ON FUNCTION validate_schedule_plan_supersession_window() FROM PUBLIC;
DO $$ DECLARE owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='schedule_versions'::regclass;
  EXECUTE format('ALTER FUNCTION validate_schedule_plan_supersession_window() OWNER TO %I',owner_name);
END $$;
