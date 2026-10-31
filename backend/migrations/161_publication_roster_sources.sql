-- Capture approved participation sources once, independently of the bounded
-- occurrence horizon. Infinite recurrence never reads later group membership.
CREATE TABLE schedule_plan_publication_evidence (
  version_id uuid PRIMARY KEY,
  school_id uuid NOT NULL,
  source_revision integer NOT NULL CHECK(source_revision>0),
  basis_event_id uuid,
  snapshot_hash char(64) NOT NULL,
  published_at timestamptz NOT NULL,
  published_by uuid NOT NULL REFERENCES users(id),
  resource_snapshots jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(resource_snapshots)='array'),
  backfilled boolean NOT NULL DEFAULT false,
  FOREIGN KEY(version_id,school_id) REFERENCES schedule_versions(id,school_id)
);
CREATE TABLE schedule_plan_roster_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL,
  school_id uuid NOT NULL,
  person_id uuid NOT NULL,
  label varchar(310) NOT NULL,
  participation_role varchar(24) NOT NULL CHECK(participation_role IN ('participant','lead')),
  source_kind varchar(24) NOT NULL CHECK(source_kind IN ('person','class','group','team','teaching')),
  source_ref varchar(240) NOT NULL,
  source_revision integer NOT NULL CHECK(source_revision>0),
  person_revision integer NOT NULL DEFAULT 1 CHECK(person_revision>0),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  CHECK(effective_until IS NULL OR effective_until>effective_from),
  FOREIGN KEY(version_id,school_id) REFERENCES schedule_versions(id,school_id),
  FOREIGN KEY(school_id,person_id) REFERENCES school_people(school_id,id)
);
CREATE INDEX schedule_plan_roster_source_interval ON schedule_plan_roster_sources(version_id,effective_from,effective_until,person_id);
ALTER TABLE schedule_activity_occurrence_people ADD COLUMN person_revision integer NOT NULL DEFAULT 1 CHECK(person_revision>0);

-- Earlier local-preview versions already captured occurrence rosters. Preserve
-- that existing evidence instead of reading today's People as historical truth.
INSERT INTO schedule_plan_publication_evidence(version_id,school_id,source_revision,basis_event_id,snapshot_hash,published_at,published_by,backfilled)
SELECT version.id,version.school_id,version.revision,event.id,
  encode(digest(version.id::text||':retained-occurrence-roster','sha256'),'hex'),version.published_at,version.created_by,true
FROM schedule_versions version
JOIN LATERAL(SELECT id FROM campus_model_events WHERE school_id=version.school_id
  AND source_domain='timetable' AND source_record_id=version.id::text
  AND event_type='timetable.activity_published' ORDER BY recorded_at LIMIT 1) event ON true
WHERE version.planning_origin='activity' AND version.state IN ('published','cancelled');
INSERT INTO schedule_plan_roster_sources(version_id,school_id,person_id,label,participation_role,source_kind,source_ref,source_revision,effective_from,effective_until)
SELECT DISTINCT ON(occurrence.plan_version_id,participant.person_id,participant.source_kind,participant.source_ref)
  occurrence.plan_version_id,occurrence.school_id,participant.person_id,participant.label,participant.participation_role,
  participant.source_kind,participant.source_ref,participant.source_revision,
  version.starts_on::timestamp AT TIME ZONE version.activity_timezone,
  CASE WHEN version.ends_on IS NULL THEN NULL ELSE (version.ends_on+1)::timestamp AT TIME ZONE version.activity_timezone END
FROM schedule_activity_occurrences occurrence JOIN schedule_activity_occurrence_people participant ON participant.occurrence_id=occurrence.id
JOIN schedule_versions version ON version.id=occurrence.plan_version_id
JOIN schedule_plan_publication_evidence evidence ON evidence.version_id=version.id
ORDER BY occurrence.plan_version_id,participant.person_id,participant.source_kind,participant.source_ref,occurrence.starts_at;

CREATE FUNCTION protect_schedule_roster_sources() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Published participation sources are immutable; prepare a dated revision';
END $$;
CREATE TRIGGER schedule_roster_source_immutable BEFORE UPDATE OR DELETE ON schedule_plan_roster_sources
  FOR EACH ROW EXECUTE FUNCTION protect_schedule_roster_sources();
CREATE FUNCTION protect_schedule_publication_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.basis_event_id IS NULL AND NEW.basis_event_id IS NOT NULL
    AND (to_jsonb(NEW)-'basis_event_id') IS NOT DISTINCT FROM (to_jsonb(OLD)-'basis_event_id') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Published plan evidence is immutable';
END $$;
CREATE TRIGGER schedule_publication_evidence_immutable BEFORE UPDATE OR DELETE ON schedule_plan_publication_evidence
  FOR EACH ROW EXECUTE FUNCTION protect_schedule_publication_evidence();
DO $$ DECLARE table_name text; application_owner text; database_role text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner FROM pg_class WHERE oid='schedule_versions'::regclass;
  FOREACH table_name IN ARRAY ARRAY['schedule_plan_publication_evidence','schedule_plan_roster_sources'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',table_name);
    EXECUTE format('ALTER TABLE %I OWNER TO %I',table_name,application_owner);
    FOREACH database_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=database_role) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',table_name,database_role); END IF;
    END LOOP;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION protect_schedule_roster_sources(),protect_schedule_publication_evidence() FROM PUBLIC;
