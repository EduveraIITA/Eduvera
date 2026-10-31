-- Domain-native location context and immutable dated replacement lineage.
ALTER TABLE schedule_versions
  ADD COLUMN location_kind varchar(16) NOT NULL DEFAULT 'unspecified'
    CHECK(location_kind IN ('on_campus','online','off_site','unspecified')),
  ADD COLUMN location_label varchar(200) NOT NULL DEFAULT '',
  ADD COLUMN location_url varchar(1000) NOT NULL DEFAULT '',
  ADD COLUMN replaces_version_id uuid,
  ADD COLUMN replaces_source_revision integer,
  ADD COLUMN revision_reason varchar(500),
  ADD CONSTRAINT schedule_replacement_scope FOREIGN KEY(replaces_version_id,school_id)
    REFERENCES schedule_versions(id,school_id),
  ADD CONSTRAINT schedule_replacement_source_required
    CHECK((replaces_version_id IS NULL)=(replaces_source_revision IS NULL));
CREATE UNIQUE INDEX schedule_one_activity_revision_draft ON schedule_versions(replaces_version_id)
  WHERE state='draft' AND replaces_version_id IS NOT NULL;
ALTER TABLE schedule_activity_occurrences
  ADD COLUMN location_kind varchar(16) NOT NULL DEFAULT 'unspecified'
    CHECK(location_kind IN ('on_campus','online','off_site','unspecified')),
  ADD COLUMN location_label varchar(200) NOT NULL DEFAULT '',
  ADD COLUMN location_url varchar(1000) NOT NULL DEFAULT '';
CREATE TABLE schedule_plan_supersessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  previous_version_id uuid NOT NULL UNIQUE,
  replacement_version_id uuid NOT NULL UNIQUE,
  previous_source_revision integer NOT NULL CHECK(previous_source_revision>0),
  replacement_source_revision integer NOT NULL CHECK(replacement_source_revision>0),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  reason varchar(500) NOT NULL CHECK(length(btrim(reason))>=3),
  actor_id uuid NOT NULL REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK(previous_version_id<>replacement_version_id),
  CHECK(effective_until IS NULL OR effective_until>effective_from),
  FOREIGN KEY(previous_version_id,school_id) REFERENCES schedule_versions(id,school_id),
  FOREIGN KEY(replacement_version_id,school_id) REFERENCES schedule_versions(id,school_id)
);
CREATE FUNCTION protect_schedule_plan_supersession() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Published replacement evidence is immutable; prepare another dated plan';
END $$;
CREATE TRIGGER schedule_plan_supersession_immutable BEFORE UPDATE OR DELETE ON schedule_plan_supersessions
  FOR EACH ROW EXECUTE FUNCTION protect_schedule_plan_supersession();
ALTER TABLE schedule_plan_supersessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON schedule_plan_supersessions FROM PUBLIC;
REVOKE ALL ON FUNCTION protect_schedule_plan_supersession() FROM PUBLIC;
DO $$ DECLARE application_owner text; database_role text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner FROM pg_class WHERE oid='schedule_versions'::regclass;
  EXECUTE format('ALTER TABLE schedule_plan_supersessions OWNER TO %I',application_owner);
  FOREACH database_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=database_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE schedule_plan_supersessions FROM %I',database_role);
    END IF;
  END LOOP;
END $$;
