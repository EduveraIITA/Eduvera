-- Event-derived temporal runtime for the private Campus Model Core.
-- Domain records remain authoritative; these tables retain normalized plan evidence
-- and a rebuildable occurrence projection.

CREATE TABLE campus_model_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  event_kind text NOT NULL CHECK(event_kind IN ('plan','observation','decision','command_outcome')),
  event_type varchar(120) NOT NULL,
  subject_entity_id uuid NOT NULL,
  context_entity_id uuid,
  actor_agent_id uuid,
  source_domain varchar(64) NOT NULL,
  source_record_id varchar(160) NOT NULL,
  source_revision integer NOT NULL CHECK(source_revision>0),
  event_at timestamptz NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid NOT NULL,
  causation_event_id uuid,
  supersedes_event_id uuid,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version>0),
  idempotency_key varchar(240) NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE(id,school_id),
  UNIQUE(school_id,idempotency_key),
  CHECK(effective_until IS NULL OR effective_until>effective_from),
  FOREIGN KEY(subject_entity_id,school_id) REFERENCES campus_model_entities(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(context_entity_id,school_id) REFERENCES campus_model_entities(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(actor_agent_id,school_id) REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(causation_event_id,school_id) REFERENCES campus_model_events(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(supersedes_event_id,school_id) REFERENCES campus_model_events(id,school_id) ON DELETE RESTRICT
);
CREATE INDEX campus_model_events_subject_time_idx
  ON campus_model_events(school_id,subject_entity_id,effective_from DESC,recorded_at DESC);
CREATE INDEX campus_model_events_source_idx
  ON campus_model_events(school_id,source_domain,source_record_id,source_revision);

CREATE TABLE campus_model_schedule_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  source_event_id uuid NOT NULL,
  schedule_entity_id uuid NOT NULL,
  period_entity_id uuid NOT NULL,
  class_entity_id uuid NOT NULL,
  subject_entity_id uuid,
  responsible_agent_id uuid,
  space_entity_id uuid,
  occurrence_date date NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  title varchar(120) NOT NULL,
  slot_type varchar(16) NOT NULL CHECK(slot_type IN ('class','break','activity')),
  room_snapshot varchar(80) NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'expected' CHECK(state IN ('expected','cancelled','superseded')),
  source_revision integer NOT NULL CHECK(source_revision>0),
  projected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,school_id),
  UNIQUE(school_id,period_entity_id,occurrence_date,source_revision),
  CHECK(ends_at>starts_at),
  CHECK((starts_at AT TIME ZONE 'UTC')::date BETWEEN occurrence_date-1 AND occurrence_date+1),
  FOREIGN KEY(source_event_id,school_id) REFERENCES campus_model_events(id,school_id) ON DELETE CASCADE,
  FOREIGN KEY(schedule_entity_id,school_id) REFERENCES campus_model_entities(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(period_entity_id,school_id) REFERENCES campus_model_entities(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(class_entity_id,school_id) REFERENCES campus_model_entities(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(subject_entity_id,school_id) REFERENCES campus_model_entities(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(responsible_agent_id,school_id) REFERENCES campus_model_agents(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(space_entity_id,school_id) REFERENCES campus_model_entities(id,school_id) ON DELETE RESTRICT
);
CREATE INDEX campus_model_occurrences_class_time_idx
  ON campus_model_schedule_occurrences(school_id,class_entity_id,starts_at,ends_at) WHERE state='expected';
CREATE INDEX campus_model_occurrences_agent_time_idx
  ON campus_model_schedule_occurrences(school_id,responsible_agent_id,starts_at,ends_at) WHERE state='expected';
CREATE INDEX campus_model_occurrences_space_time_idx
  ON campus_model_schedule_occurrences(school_id,space_entity_id,starts_at,ends_at) WHERE state='expected';

-- Register the existing published timetable without manufacturing presence.
INSERT INTO campus_model_entities(school_id,kind,domain,domain_id,label,lifecycle_state,source_revision,metadata)
SELECT version.school_id,'schedule','timetable',version.id::text,
  'Class '||section.grade||section.section||' timetable','active',version.revision,
  jsonb_build_object('starts_on',version.starts_on,'ends_on',version.ends_on,'timezone',school.timezone)
FROM schedule_versions version
JOIN class_sections section ON section.id=version.class_section_id
JOIN schools school ON school.id=version.school_id
WHERE version.state='published'
ON CONFLICT(school_id,domain,domain_id) DO UPDATE SET
  label=EXCLUDED.label,lifecycle_state=EXCLUDED.lifecycle_state,
  source_revision=EXCLUDED.source_revision,metadata=EXCLUDED.metadata,updated_at=now();

INSERT INTO campus_model_entities(school_id,kind,domain,domain_id,label,lifecycle_state,source_revision,metadata)
SELECT DISTINCT version.school_id,'schedule_period','timetable',period.id::text,period.title,'active',version.revision,
  jsonb_build_object('weekday',period.weekday,'period_number',period.period_number,'slot_type',period.slot_type)
FROM schedule_versions version JOIN schedule_periods period ON period.version_id=version.id
WHERE version.state='published'
ON CONFLICT(school_id,domain,domain_id) DO UPDATE SET
  label=EXCLUDED.label,lifecycle_state=EXCLUDED.lifecycle_state,
  source_revision=EXCLUDED.source_revision,metadata=EXCLUDED.metadata,updated_at=now();

INSERT INTO campus_model_entities(school_id,kind,domain,domain_id,label,lifecycle_state,source_revision,metadata)
SELECT DISTINCT subject.school_id,'subject','academic_structure',subject.id::text,subject.name,'active',1,
  jsonb_build_object('code',subject.code)
FROM subjects subject
JOIN schedule_periods period ON period.subject_id=subject.id
JOIN schedule_versions version ON version.id=period.version_id AND version.state='published'
ON CONFLICT(school_id,domain,domain_id) DO UPDATE SET
  label=EXCLUDED.label,lifecycle_state=EXCLUDED.lifecycle_state,metadata=EXCLUDED.metadata,updated_at=now();

INSERT INTO campus_model_agents(school_id,agent_kind,user_id,label,status)
SELECT DISTINCT version.school_id,'human',period.teacher_user_id,
  COALESCE(NULLIF(trim(concat_ws(' ',account.first_name,account.last_name)),''),account.username),
  CASE WHEN account.is_active THEN 'active' ELSE 'revoked' END
FROM schedule_versions version
JOIN schedule_periods period ON period.version_id=version.id AND period.teacher_user_id IS NOT NULL
JOIN users account ON account.id=period.teacher_user_id
WHERE version.state='published'
ON CONFLICT(school_id,user_id) WHERE agent_kind='human' DO UPDATE SET
  label=EXCLUDED.label,status=EXCLUDED.status,updated_at=now();

INSERT INTO campus_model_events(
  school_id,event_kind,event_type,subject_entity_id,actor_agent_id,source_domain,
  source_record_id,source_revision,event_at,effective_from,effective_until,
  correlation_id,provenance,payload,schema_version,idempotency_key,request_hash)
SELECT version.school_id,'plan','timetable.schedule_published',schedule_entity.id,actor.id,'timetable',
  version.id::text,version.revision,COALESCE(version.published_at,version.created_at),
  version.starts_on::timestamp AT TIME ZONE school.timezone,
  (version.ends_on+1)::timestamp AT TIME ZONE school.timezone,
  gen_random_uuid(),jsonb_build_object('source','schedule_versions','captured_by','migration-104'),
  jsonb_build_object('starts_on',version.starts_on,'ends_on',version.ends_on,'timezone',school.timezone,
    'period_count',(SELECT count(*) FROM schedule_periods period WHERE period.version_id=version.id)),
  1,'timetable.schedule-published:'||version.id::text||':'||version.revision::text,
  encode(digest(version.school_id::text||':'||version.id::text||':'||version.revision::text,'sha256'),'hex')
FROM schedule_versions version
JOIN schools school ON school.id=version.school_id
JOIN campus_model_entities schedule_entity ON schedule_entity.school_id=version.school_id
  AND schedule_entity.domain='timetable' AND schedule_entity.domain_id=version.id::text
LEFT JOIN campus_model_agents actor ON actor.school_id=version.school_id
  AND actor.agent_kind='human' AND actor.user_id=version.created_by
WHERE version.state='published'
ON CONFLICT(school_id,idempotency_key) DO NOTHING;

INSERT INTO campus_model_schedule_occurrences(
  school_id,source_event_id,schedule_entity_id,period_entity_id,class_entity_id,
  subject_entity_id,responsible_agent_id,space_entity_id,occurrence_date,starts_at,ends_at,
  title,slot_type,room_snapshot,state,source_revision)
SELECT version.school_id,event.id,schedule_entity.id,period_entity.id,class_entity.id,
  subject_entity.id,teacher_agent.id,space_entity.id,day::date,
  ((day::date+period.starts_at) AT TIME ZONE school.timezone),
  ((day::date+period.ends_at) AT TIME ZONE school.timezone),
  period.title,period.slot_type,period.room,'expected',version.revision
FROM schedule_versions version
JOIN schools school ON school.id=version.school_id
JOIN schedule_periods period ON period.version_id=version.id
JOIN campus_model_events event ON event.school_id=version.school_id
  AND event.idempotency_key='timetable.schedule-published:'||version.id::text||':'||version.revision::text
JOIN campus_model_entities schedule_entity ON schedule_entity.school_id=version.school_id
  AND schedule_entity.domain='timetable' AND schedule_entity.domain_id=version.id::text
JOIN campus_model_entities period_entity ON period_entity.school_id=version.school_id
  AND period_entity.domain='timetable' AND period_entity.domain_id=period.id::text
JOIN campus_model_entities class_entity ON class_entity.school_id=version.school_id
  AND class_entity.domain='academic_structure' AND class_entity.domain_id=version.class_section_id::text
LEFT JOIN campus_model_entities subject_entity ON subject_entity.school_id=version.school_id
  AND subject_entity.domain='academic_structure' AND subject_entity.domain_id=period.subject_id::text
LEFT JOIN campus_model_agents teacher_agent ON teacher_agent.school_id=version.school_id
  AND teacher_agent.agent_kind='human' AND teacher_agent.user_id=period.teacher_user_id
LEFT JOIN campus_model_entities space_entity ON space_entity.school_id=version.school_id
  AND space_entity.domain='campus_topology' AND space_entity.domain_id=period.space_id::text
CROSS JOIN LATERAL generate_series(version.starts_on,version.ends_on,'1 day') day
WHERE version.state='published' AND extract(isodow FROM day)=period.weekday
  AND NOT EXISTS(SELECT 1 FROM school_calendar_days closure
    WHERE closure.school_id=version.school_id AND closure.date=day::date AND NOT closure.is_instructional)
  AND NOT EXISTS(SELECT 1 FROM day_plans plan
    WHERE plan.school_id=version.school_id AND plan.class_section_id=version.class_section_id
      AND plan.date=day::date AND plan.published_version IS NOT NULL)
ON CONFLICT(school_id,period_entity_id,occurrence_date,source_revision) DO NOTHING;

ALTER TABLE campus_model_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_model_schedule_occurrences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE campus_model_events,campus_model_schedule_occurrences FROM PUBLIC;

DO $$
DECLARE application_owner text; role_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner FROM pg_class WHERE oid='public.students'::regclass;
  EXECUTE format('ALTER TABLE public.campus_model_events OWNER TO %I',application_owner);
  EXECUTE format('ALTER TABLE public.campus_model_schedule_occurrences OWNER TO %I',application_owner);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.campus_model_events,public.campus_model_schedule_occurrences FROM %I',role_name);
    END IF;
  END LOOP;
END $$;
