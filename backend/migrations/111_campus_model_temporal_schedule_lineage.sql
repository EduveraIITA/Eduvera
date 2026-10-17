-- Append-only, bitemporal lineage for projected schedule occurrences.
-- Domain timetable/day-plan/calendar records remain authoritative. The Model Core
-- keeps rebuildable revisions so a recorded-as-of query never reads today's
-- mutable projection state as though it were historical truth.

ALTER TABLE campus_model_events
  ADD COLUMN journal_sequence bigint GENERATED ALWAYS AS IDENTITY;

-- now() is the transaction start. Schedule publication can append a frozen
-- baseline and its dated replacement in one transaction, so recording time
-- must be sampled per event rather than shared by the whole transaction.
ALTER TABLE campus_model_events
  ALTER COLUMN recorded_at SET DEFAULT clock_timestamp();

CREATE UNIQUE INDEX campus_model_events_journal_sequence_key
  ON campus_model_events(journal_sequence);
CREATE INDEX campus_model_events_school_journal_idx
  ON campus_model_events(school_id,journal_sequence);

-- Older calendar rows predate the temporal journal. Retain one explicit closure
-- event per current non-instructional day so future schedule projections can
-- reference the condition that cancelled them instead of attributing that fact
-- to the timetable publication itself.
INSERT INTO campus_model_events(
  school_id,event_kind,event_type,subject_entity_id,actor_agent_id,source_domain,
  source_record_id,source_revision,event_at,effective_from,effective_until,
  correlation_id,provenance,payload,schema_version,idempotency_key,request_hash
)
SELECT calendar.school_id,'plan','calendar.closure_created',institution.id,actor.id,
  'calendar',calendar.id::text,calendar.revision,
  COALESCE(calendar.updated_at,calendar.created_at),
  calendar.date::timestamp AT TIME ZONE school.timezone,
  (calendar.date+1)::timestamp AT TIME ZONE school.timezone,
  gen_random_uuid(),
  jsonb_build_object('source','school_calendar_days','captured_by','migration-111'),
  jsonb_build_object(
    'action','created','dates',jsonb_build_array(calendar.date::text),
    'label',calendar.label,'closure_kind',calendar.kind
  ),
  1,'migration-111:calendar.closure-created:'||calendar.id::text||':'||calendar.revision::text,
  encode(digest(concat_ws(':',calendar.school_id::text,calendar.id::text,
    calendar.revision::text,'closure-created'),'sha256'),'hex')
FROM school_calendar_days calendar
JOIN schools school ON school.id=calendar.school_id
JOIN campus_model_entities institution
  ON institution.school_id=calendar.school_id
  AND institution.domain='institutions'
  AND institution.domain_id=calendar.school_id::text
LEFT JOIN campus_model_agents actor
  ON actor.school_id=calendar.school_id AND actor.agent_kind='human'
  AND actor.user_id=COALESCE(calendar.updated_by,calendar.created_by)
WHERE NOT calendar.is_instructional
  AND NOT EXISTS (
    SELECT 1 FROM campus_model_events existing
    WHERE existing.school_id=calendar.school_id
      AND existing.event_type='calendar.closure_created'
      AND existing.payload->'dates' ? calendar.date::text
  )
ON CONFLICT(school_id,idempotency_key) DO NOTHING;

ALTER TABLE campus_model_schedule_occurrences
  ADD COLUMN logical_occurrence_key char(64),
  ADD COLUMN period_number smallint,
  ADD COLUMN basis_event_id uuid,
  ADD COLUMN change_event_id uuid,
  ADD COLUMN condition_event_id uuid,
  ADD COLUMN recorded_from timestamptz,
  ADD COLUMN recorded_until timestamptz,
  ADD COLUMN supersedes_occurrence_id uuid,
  ADD COLUMN change_kind varchar(32);

WITH numbered AS (
  SELECT occurrence.id,
    COALESCE(
      NULLIF(period.metadata->>'period_number','')::smallint,
      row_number() OVER (
        PARTITION BY occurrence.school_id,occurrence.class_entity_id,occurrence.occurrence_date
        ORDER BY occurrence.starts_at,occurrence.ends_at,occurrence.id
      )::smallint
    ) AS period_number,
    class_entity.domain_id AS class_section_id,
    event.recorded_at,
    event.event_type,
    closure_event.id AS closure_event_id
  FROM campus_model_schedule_occurrences occurrence
  JOIN campus_model_entities period ON period.id=occurrence.period_entity_id
  JOIN campus_model_entities class_entity ON class_entity.id=occurrence.class_entity_id
  JOIN campus_model_events event ON event.id=occurrence.source_event_id
  LEFT JOIN LATERAL (
    SELECT closure.id
    FROM campus_model_events closure
    WHERE closure.school_id=occurrence.school_id
      AND closure.event_type='calendar.closure_created'
      AND closure.payload->'dates' ? occurrence.occurrence_date::text
    ORDER BY closure.recorded_at DESC,closure.journal_sequence DESC
    LIMIT 1
  ) closure_event ON occurrence.state='cancelled'
)
UPDATE campus_model_schedule_occurrences occurrence SET
  period_number=numbered.period_number,
  logical_occurrence_key=encode(digest(concat_ws(':',
    occurrence.school_id::text,numbered.class_section_id,
    occurrence.occurrence_date::text,numbered.period_number::text
  ),'sha256'),'hex'),
  basis_event_id=occurrence.source_event_id,
  change_event_id=occurrence.source_event_id,
  condition_event_id=numbered.closure_event_id,
  recorded_from=numbered.recorded_at,
  change_kind=CASE
    WHEN occurrence.state='cancelled' AND numbered.closure_event_id IS NOT NULL THEN 'closure_cancelled'
    WHEN occurrence.state<>'expected' THEN 'projection_backfill'
    WHEN numbered.event_type='timetable.day_plan_published' THEN 'overridden'
    ELSE 'published'
  END
FROM numbered WHERE numbered.id=occurrence.id;

-- Rows already marked superseded before this migration are history, not a
-- second current answer. Retain them with an honest import-time close.
UPDATE campus_model_schedule_occurrences
SET recorded_until=GREATEST(projected_at,recorded_from+interval '1 microsecond')
WHERE state='superseded';

-- Migration 104 could retain both a baseline and a later winning schedule as
-- current. Close lower-precedence duplicates at the lineage migration boundary.
WITH ranked AS (
  SELECT occurrence.id,
    row_number() OVER (
      PARTITION BY occurrence.school_id,occurrence.logical_occurrence_key
      ORDER BY
        CASE event.source_domain WHEN 'day_plan' THEN 0 ELSE 1 END,
        CASE WHEN COALESCE(version.baseline,false) THEN 1 ELSE 0 END,
        COALESCE(version.starts_on,occurrence.occurrence_date) DESC,
        event.recorded_at DESC,occurrence.projected_at DESC,occurrence.id DESC
    ) AS rank
  FROM campus_model_schedule_occurrences occurrence
  JOIN campus_model_events event ON event.id=occurrence.basis_event_id
  LEFT JOIN schedule_versions version
    ON event.source_domain='timetable'
    AND version.id::text=event.source_record_id
  WHERE occurrence.recorded_until IS NULL
)
UPDATE campus_model_schedule_occurrences occurrence SET
  recorded_until=GREATEST(statement_timestamp(),occurrence.recorded_from+interval '1 microsecond'),
  change_kind='projection_backfill',
  projected_at=GREATEST(statement_timestamp(),occurrence.recorded_from+interval '1 microsecond')
FROM ranked WHERE ranked.id=occurrence.id AND ranked.rank>1;

ALTER TABLE campus_model_schedule_occurrences
  ALTER COLUMN logical_occurrence_key SET NOT NULL,
  ALTER COLUMN period_number SET NOT NULL,
  ALTER COLUMN basis_event_id SET NOT NULL,
  ALTER COLUMN change_event_id SET NOT NULL,
  ALTER COLUMN recorded_from SET NOT NULL,
  ALTER COLUMN change_kind SET NOT NULL,
  ADD CONSTRAINT campus_model_occurrence_period_number_check
    CHECK(period_number BETWEEN 1 AND 24),
  ADD CONSTRAINT campus_model_occurrence_recording_interval_check
    CHECK(recorded_until IS NULL OR recorded_until>recorded_from),
  ADD CONSTRAINT campus_model_occurrence_change_kind_check
    CHECK(change_kind IN (
      'published','overridden','closure_cancelled','closure_restored',
      'day_plan_cancelled','substituted','projection_backfill'
    )),
  ADD CONSTRAINT campus_model_occurrence_basis_event_school_fk
    FOREIGN KEY(basis_event_id,school_id)
    REFERENCES campus_model_events(id,school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_occurrence_change_event_school_fk
    FOREIGN KEY(change_event_id,school_id)
    REFERENCES campus_model_events(id,school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_occurrence_condition_event_school_fk
    FOREIGN KEY(condition_event_id,school_id)
    REFERENCES campus_model_events(id,school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT campus_model_occurrence_supersedes_school_fk
    FOREIGN KEY(supersedes_occurrence_id,school_id)
    REFERENCES campus_model_schedule_occurrences(id,school_id) ON DELETE RESTRICT;

-- The migration-104 uniqueness rule made each source revision unique but also
-- prevented an immutable state revision for the same logical occurrence.
DO $$
DECLARE old_constraint text;
BEGIN
  SELECT constraint_row.conname INTO old_constraint
  FROM (
    SELECT constraint_definition.conname,
      array_agg(attribute.attname::text ORDER BY key_column.ordinality) AS columns
    FROM pg_constraint constraint_definition
    JOIN unnest(constraint_definition.conkey) WITH ORDINALITY
      AS key_column(attnum,ordinality) ON true
    JOIN pg_attribute attribute
      ON attribute.attrelid=constraint_definition.conrelid
      AND attribute.attnum=key_column.attnum
    WHERE constraint_definition.conrelid='public.campus_model_schedule_occurrences'::regclass
      AND constraint_definition.contype='u'
    GROUP BY constraint_definition.conname
  ) constraint_row
  WHERE constraint_row.columns=ARRAY[
    'school_id','period_entity_id','occurrence_date','source_revision'
  ]::text[];
  IF old_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.campus_model_schedule_occurrences DROP CONSTRAINT %I',
      old_constraint
    );
  END IF;
END $$;

CREATE UNIQUE INDEX campus_model_occurrence_current_key
  ON campus_model_schedule_occurrences(school_id,logical_occurrence_key)
  WHERE recorded_until IS NULL;
CREATE UNIQUE INDEX campus_model_occurrence_change_key
  ON campus_model_schedule_occurrences(school_id,change_event_id,logical_occurrence_key);
CREATE UNIQUE INDEX campus_model_occurrence_single_successor
  ON campus_model_schedule_occurrences(school_id,supersedes_occurrence_id)
  WHERE supersedes_occurrence_id IS NOT NULL;
CREATE INDEX campus_model_occurrence_recorded_window_idx
  ON campus_model_schedule_occurrences(
    school_id,logical_occurrence_key,recorded_from,recorded_until
  );

DROP INDEX IF EXISTS campus_model_occurrences_class_time_idx;
DROP INDEX IF EXISTS campus_model_occurrences_agent_time_idx;
DROP INDEX IF EXISTS campus_model_occurrences_space_time_idx;
CREATE INDEX campus_model_occurrences_class_time_idx
  ON campus_model_schedule_occurrences(school_id,class_entity_id,starts_at,ends_at)
  WHERE state='expected' AND recorded_until IS NULL;
CREATE INDEX campus_model_occurrences_agent_time_idx
  ON campus_model_schedule_occurrences(school_id,responsible_agent_id,starts_at,ends_at)
  WHERE state='expected' AND recorded_until IS NULL;
CREATE INDEX campus_model_occurrences_space_time_idx
  ON campus_model_schedule_occurrences(school_id,space_entity_id,starts_at,ends_at)
  WHERE state='expected' AND recorded_until IS NULL;

CREATE FUNCTION protect_campus_model_occurrence_lineage()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Recorded schedule occurrence history is append-only' USING ERRCODE='23514';
  END IF;
  IF OLD.recorded_until IS NOT NULL THEN
    RAISE EXCEPTION 'Recorded schedule occurrence history is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.recorded_until IS NULL OR NEW.recorded_until<=OLD.recorded_from THEN
    RAISE EXCEPTION 'A current occurrence can only be closed with a later recording time' USING ERRCODE='23514';
  END IF;
  IF (to_jsonb(NEW)-ARRAY['recorded_until','projected_at']::text[])
      IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['recorded_until','projected_at']::text[]) THEN
    RAISE EXCEPTION 'Close a schedule occurrence revision; append its replacement separately' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER campus_model_occurrence_lineage_guard
  BEFORE UPDATE OR DELETE ON campus_model_schedule_occurrences
  FOR EACH ROW EXECUTE FUNCTION protect_campus_model_occurrence_lineage();

REVOKE ALL ON FUNCTION protect_campus_model_occurrence_lineage() FROM PUBLIC;

DO $$
DECLARE application_owner text; role_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner
  FROM pg_class WHERE oid='public.campus_model_schedule_occurrences'::regclass;
  EXECUTE format(
    'ALTER FUNCTION public.protect_campus_model_occurrence_lineage() OWNER TO %I',
    application_owner
  );
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.protect_campus_model_occurrence_lineage() FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END $$;
