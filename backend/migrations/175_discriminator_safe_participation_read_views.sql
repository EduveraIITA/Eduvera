-- A source key is typed by its owning context, not by the reader's predicate.
-- PostgreSQL may push a session_id filter into a UNION arm before evaluating
-- its source-kind join filter. Daily keys deliberately contain class:term:date,
-- so each UUID conversion must guard its own discriminator inside CASE.
CREATE OR REPLACE VIEW attendance_session_entries AS
SELECT original.* FROM attendance_session_entries_legacy_source original
WHERE NOT EXISTS(SELECT 1 FROM activity_attendance_legacy_links link WHERE link.state='active'
  AND link.source_kind='scheduled_session' AND link.source_id=original.session_id::text AND link.school_id=original.school_id)
UNION ALL
SELECT entry.id,entry.school_id,CASE WHEN link.source_kind='scheduled_session' THEN link.source_id::uuid END,person.student_id,entry.status,entry.remarks,
  CASE entry.capture_channel WHEN 'human_roll_call' THEN 'staff_roll_call' WHEN 'self_check_in' THEN 'student_qr'
    WHEN 'registered_device' THEN 'biometric_device' WHEN 'legacy_import' THEN original.capture_channel ELSE entry.capture_channel END,
  entry.observed_at,entry.recorded_by,entry.revision,entry.created_at,entry.updated_at
FROM activity_attendance_entries entry
JOIN activity_attendance_legacy_links link ON link.register_id=entry.register_id AND link.school_id=entry.school_id
  AND link.state='active' AND link.source_kind='scheduled_session'
JOIN activity_attendance_legacy_people person ON person.register_id=entry.register_id AND person.person_id=entry.person_id
LEFT JOIN attendance_session_entries_legacy_source original ON original.id=entry.id
WHERE entry.status IS NOT NULL;

CREATE OR REPLACE VIEW attendance_session_submissions AS
SELECT original.* FROM attendance_session_submissions_legacy_source original
UNION ALL
SELECT command.id,command.school_id,CASE WHEN link.source_kind='scheduled_session' THEN link.source_id::uuid END,
  command.actor_id,command.idempotency_key,compat.legacy_request_hash,
  command.request_id,command.register_revision,compat.records_count,compat.changed_count,compat.result_body,command.created_at,
  compat.capture_source,compat.source_photo_session_id
FROM activity_attendance_legacy_command_results compat JOIN activity_attendance_commands command ON command.id=compat.command_id
JOIN activity_attendance_legacy_links link ON link.register_id=command.register_id AND link.school_id=command.school_id
  AND link.source_kind='scheduled_session' AND link.source_id=compat.source_id
WHERE compat.source_kind='scheduled_session';

CREATE OR REPLACE VIEW attendance_session_entry_revisions AS
SELECT original.* FROM attendance_session_entry_revisions_legacy_source original
UNION ALL
SELECT -revision.id,revision.school_id,CASE WHEN link.source_kind='scheduled_session' THEN link.source_id::uuid END,
  revision.entry_id,command.id,person.student_id,
  revision.previous_status,revision.new_status,revision.previous_remarks,revision.new_remarks,
  CASE revision.capture_channel WHEN 'human_roll_call' THEN 'staff_roll_call' WHEN 'self_check_in' THEN 'student_qr'
    WHEN 'registered_device' THEN 'biometric_device' ELSE revision.capture_channel END,
  revision.reason,revision.changed_by,revision.request_id,revision.register_revision,revision.created_at
FROM activity_attendance_entry_revisions revision
JOIN activity_attendance_legacy_links link ON link.register_id=revision.register_id AND link.school_id=revision.school_id
  AND link.state='active' AND link.source_kind='scheduled_session'
JOIN activity_attendance_legacy_people person ON person.register_id=revision.register_id AND person.person_id=revision.person_id
LEFT JOIN activity_attendance_commands command ON command.register_id=revision.register_id AND command.register_revision=revision.register_revision
WHERE revision.legacy_source_ref IS NULL;

CREATE OR REPLACE VIEW attendance_session_evidence AS
SELECT original.* FROM attendance_session_evidence_legacy_source original
WHERE NOT EXISTS(SELECT 1 FROM activity_attendance_legacy_links link WHERE link.state='active'
  AND link.source_kind='scheduled_session' AND link.source_id=original.session_id::text AND link.school_id=original.school_id)
UNION ALL
SELECT evidence.id,evidence.school_id,CASE WHEN link.source_kind='scheduled_session' THEN link.source_id::uuid END,person.student_id,
  CASE evidence.capture_channel WHEN 'self_check_in' THEN 'student_qr' WHEN 'registered_device' THEN 'biometric_device'
    ELSE evidence.capture_channel END,evidence.state,evidence.observed_at,evidence.submitted_by,evidence.source_reference,
  COALESCE(evidence.legacy_snapshot->'metadata','{}'::jsonb),evidence.decided_by,evidence.decided_at,COALESCE(evidence.decision_note,''),
  evidence.created_at,COALESCE(evidence.decided_at,evidence.received_at)
FROM activity_attendance_evidence evidence
JOIN activity_attendance_legacy_links link ON link.register_id=evidence.register_id AND link.school_id=evidence.school_id
  AND link.state='active' AND link.source_kind='scheduled_session'
JOIN activity_attendance_legacy_people person ON person.register_id=evidence.register_id AND person.person_id=evidence.person_id;

CREATE OR REPLACE VIEW campus_event_attendance_records AS
SELECT original.* FROM campus_event_attendance_records_legacy_source original
WHERE NOT EXISTS(SELECT 1 FROM activity_attendance_legacy_links link WHERE link.school_id=original.school_id
  AND link.source_kind='event' AND link.source_id=original.session_id::text AND link.state='active')
UNION ALL
SELECT entry.id,entry.school_id,occurrence.context_ref,CASE WHEN link.source_kind='event' THEN link.source_id::uuid END,person.student_id,
  COALESCE(entry.status,'not_recorded'),entry.remarks,
  CASE WHEN detail.entry_revision_id IS NOT NULL THEN detail.details->>'readiness_contradiction_note' ELSE original.readiness_contradiction_note END,
  CASE WHEN detail.entry_revision_id IS NOT NULL THEN (detail.details->>'checked_in_at')::timestamptz ELSE original.checked_in_at END,
  CASE WHEN detail.entry_revision_id IS NOT NULL THEN (detail.details->>'checked_out_at')::timestamptz ELSE original.checked_out_at END,
  entry.revision,entry.recorded_by,entry.updated_at,entry.updated_at
FROM activity_attendance_entries entry
JOIN activity_attendance_registers register ON register.id=entry.register_id AND register.school_id=entry.school_id
JOIN schedule_activity_occurrences occurrence ON occurrence.id=register.occurrence_id AND occurrence.school_id=register.school_id
JOIN activity_attendance_legacy_links link ON link.register_id=entry.register_id AND link.school_id=entry.school_id
  AND link.source_kind='event' AND link.state='active'
JOIN activity_attendance_legacy_people person ON person.register_id=entry.register_id AND person.person_id=entry.person_id
LEFT JOIN campus_event_attendance_records_legacy_source original ON original.id=entry.id
LEFT JOIN LATERAL(SELECT metadata.* FROM activity_attendance_context_details metadata
  JOIN activity_attendance_entry_revisions revision ON revision.id=metadata.entry_revision_id
  WHERE revision.entry_id=entry.id ORDER BY revision.register_revision DESC,revision.id DESC LIMIT 1) detail ON true;

CREATE OR REPLACE VIEW campus_event_attendance_revisions AS
SELECT original.* FROM campus_event_attendance_revisions_legacy_source original
UNION ALL
SELECT -revision.id,revision.school_id,occurrence.context_ref,CASE WHEN link.source_kind='event' THEN link.source_id::uuid END,
  person.student_id,revision.entry_id,
  COALESCE(revision.previous_status,'not_recorded'),COALESCE(revision.new_status,'not_recorded'),
  revision.previous_remarks,revision.new_remarks,detail.details->>'previous_readiness_contradiction_note',
  detail.details->>'readiness_contradiction_note',(detail.details->>'previous_checked_in_at')::timestamptz,
  (detail.details->>'checked_in_at')::timestamptz,(detail.details->>'previous_checked_out_at')::timestamptz,
  (detail.details->>'checked_out_at')::timestamptz,revision.reason,revision.register_revision,revision.changed_by,
  revision.request_id,revision.created_at
FROM activity_attendance_entry_revisions revision
JOIN activity_attendance_registers register ON register.id=revision.register_id AND register.school_id=revision.school_id
JOIN schedule_activity_occurrences occurrence ON occurrence.id=register.occurrence_id AND occurrence.school_id=register.school_id
JOIN activity_attendance_legacy_links link ON link.register_id=revision.register_id AND link.school_id=revision.school_id
  AND link.source_kind='event' AND link.state='active'
JOIN activity_attendance_legacy_people person ON person.register_id=revision.register_id AND person.person_id=revision.person_id
LEFT JOIN activity_attendance_context_details detail ON detail.entry_revision_id=revision.id
WHERE revision.legacy_source_ref IS NULL;
