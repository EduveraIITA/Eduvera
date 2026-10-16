-- Connect immutable attendance evidence to the private campus model without
-- moving attendance truth or validation rules out of the attendance domain.

ALTER TABLE campus_model_observations
  ADD COLUMN request_hash char(64);

UPDATE campus_model_observations
SET request_hash = md5(
    concat_ws('|', school_id::text, kind, source_type, source_record_id, idempotency_key)
  ) || md5(
    concat_ws('|', idempotency_key, source_record_id, kind, school_id::text)
  )
WHERE request_hash IS NULL;

ALTER TABLE campus_model_observations
  ALTER COLUMN request_hash SET NOT NULL,
  ADD CONSTRAINT campus_model_observations_request_hash_check
    CHECK (request_hash ~ '^[0-9a-f]{64}$');

INSERT INTO campus_model_entities(
  school_id,kind,domain,domain_id,label,lifecycle_state,source_revision,metadata
)
SELECT student.school_id,'student','people',student.id::text,
  COALESCE(NULLIF(trim(concat_ws(' ',person.first_name,person.last_name)),''),student.admission_number),
  'active',person.revision,jsonb_build_object('admission_number',student.admission_number)
FROM students student
JOIN school_people person ON person.id=student.person_id
ON CONFLICT(school_id,domain,domain_id) DO UPDATE SET
  label=EXCLUDED.label,source_revision=EXCLUDED.source_revision,metadata=EXCLUDED.metadata,
  updated_at=now();

INSERT INTO campus_model_observations(
  school_id,kind,subject_entity_id,context_entity_id,captured_by_agent_id,
  source_type,source_ref,source_record_id,observed_at,received_at,evidence_refs,
  payload,schema_version,state,idempotency_key,request_hash
)
SELECT observation.school_id,'attendance.status_observed',student_entity.id,class_entity.id,agent.id,
  'attendance.capture',observation.batch_id::text,observation.id::text,
  observation.observed_at,batch.received_at,
  ARRAY['attendance_capture_batch:' || observation.batch_id::text],
  jsonb_build_object(
    'attendance_status',observation.observed_status,
    'attendance_date',observation.date,
    'capture_source',observation.source
  ),
  1,
  CASE batch.status
    WHEN 'accepted' THEN 'accepted'
    WHEN 'quarantined' THEN 'quarantined'
    WHEN 'rejected' THEN 'rejected'
    ELSE 'pending'
  END,
  'attendance-observation:' || observation.id::text,
  md5(concat_ws('|',observation.school_id::text,observation.id::text,observation.observed_status,observation.observed_at::text))
    || md5(concat_ws('|',observation.batch_id::text,observation.student_id::text,observation.date::text,observation.source))
FROM attendance_observations observation
JOIN attendance_capture_batches batch ON batch.id=observation.batch_id
JOIN campus_model_entities student_entity
  ON student_entity.school_id=observation.school_id
  AND student_entity.domain='people' AND student_entity.domain_id=observation.student_id::text
JOIN campus_model_entities class_entity
  ON class_entity.school_id=observation.school_id
  AND class_entity.domain='academic_structure' AND class_entity.domain_id=observation.class_section_id::text
JOIN campus_model_agents agent
  ON agent.school_id=observation.school_id AND agent.agent_kind='human'
  AND agent.user_id=observation.recorded_by
ON CONFLICT(school_id,source_type,source_record_id) DO NOTHING;

CREATE INDEX campus_model_observations_source_ref_idx
  ON campus_model_observations(school_id,source_type,source_ref,created_at DESC);
