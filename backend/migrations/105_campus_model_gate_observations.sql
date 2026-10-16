-- Feed accepted gate movement evidence into the private temporal campus model.
-- Gate remains the owning domain; this migration only normalizes retained evidence.

CREATE INDEX campus_model_observations_context_time_idx
  ON campus_model_observations(school_id,context_entity_id,observed_at DESC)
  WHERE context_entity_id IS NOT NULL;

INSERT INTO campus_model_entities(
  school_id,kind,domain,domain_id,label,lifecycle_state,source_revision,metadata
)
SELECT student.school_id,'student','people',student.id::text,
  COALESCE(NULLIF(trim(concat_ws(' ',person.first_name,person.last_name)),''),student.admission_number),
  'active',person.revision,jsonb_build_object('admission_number',student.admission_number)
FROM students student
JOIN school_people person ON person.id=student.person_id
WHERE EXISTS(SELECT 1 FROM gate_events event WHERE event.student_id=student.id)
ON CONFLICT(school_id,domain,domain_id) DO UPDATE SET
  label=EXCLUDED.label,source_revision=EXCLUDED.source_revision,metadata=EXCLUDED.metadata,
  updated_at=now();

-- Legacy rows without a recorded operator retain honest import provenance. This
-- integration agent does not imply that a hardware gate reader existed.
INSERT INTO campus_model_agents(school_id,agent_kind,external_ref,label,status,metadata)
SELECT DISTINCT student.school_id,'integration','legacy-gate-events','Imported gate history','active',
  jsonb_build_object('backfilled',true,'source','gate_events')
FROM gate_events event JOIN students student ON student.id=event.student_id
ON CONFLICT(school_id,agent_kind,external_ref) WHERE external_ref IS NOT NULL DO NOTHING;

INSERT INTO campus_model_observations(
  school_id,kind,subject_entity_id,context_entity_id,captured_by_agent_id,
  source_type,source_ref,source_record_id,observed_at,received_at,evidence_refs,
  payload,schema_version,state,idempotency_key,request_hash
)
SELECT student.school_id,'movement.gate_observed',student_entity.id,NULL,
  COALESCE(human_agent.id,import_agent.id),'gate.movement',
  COALESCE(event.command_id::text,event.id::text),event.id::text,event.occurred_at,event.occurred_at,
  ARRAY['gate_event:'||event.id::text],
  jsonb_build_object(
    'direction',event.direction,'gate',event.gate,'capture_source',event.source,
    'device_reference',event.device_reference,'identity_verified',false,
    'evidence_scope','campus_boundary','backfilled',true
  ),1,'accepted','gate-observation:'||event.id::text,
  encode(digest(concat_ws('|',student.school_id::text,event.id::text,event.direction,event.occurred_at::text),'sha256'),'hex')
FROM gate_events event
JOIN students student ON student.id=event.student_id
JOIN campus_model_entities student_entity ON student_entity.school_id=student.school_id
  AND student_entity.domain='people' AND student_entity.domain_id=student.id::text
LEFT JOIN campus_model_agents human_agent ON human_agent.school_id=student.school_id
  AND human_agent.agent_kind='human' AND human_agent.user_id=event.recorded_by
JOIN campus_model_agents import_agent ON import_agent.school_id=student.school_id
  AND import_agent.agent_kind='integration' AND import_agent.external_ref='legacy-gate-events'
ON CONFLICT(school_id,source_type,source_record_id) DO NOTHING;
