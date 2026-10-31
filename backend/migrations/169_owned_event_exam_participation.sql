-- Events and examinations retain their authoritative eligibility/consent and
-- operating context. Accepted participation converges on the same writer.
ALTER TABLE schedule_activity_occurrences DROP CONSTRAINT schedule_activity_occurrences_source_check;
ALTER TABLE schedule_activity_occurrences ADD CONSTRAINT schedule_activity_occurrences_source_check
  CHECK(source IN ('activity','academic','event','examination'));
ALTER TABLE schedule_activity_occurrences DROP CONSTRAINT schedule_activity_occurrences_context_kind_check;
ALTER TABLE schedule_activity_occurrences ADD CONSTRAINT schedule_activity_occurrences_context_kind_check
  CHECK(context_kind IN ('activity','academic_class','event','examination'));
ALTER TABLE schedule_activity_occurrence_people DROP CONSTRAINT schedule_activity_occurrence_people_source_kind_check;
ALTER TABLE schedule_activity_occurrence_people ADD CONSTRAINT schedule_activity_occurrence_people_source_kind_check
  CHECK(source_kind IN ('person','class','team','group','teaching','event','examination'));

ALTER TABLE activity_attendance_entries DROP CONSTRAINT activity_attendance_entries_status_check;
ALTER TABLE activity_attendance_entries ADD CONSTRAINT activity_attendance_entries_status_check
  CHECK(status IN ('present','absent','late','excused','half_day','no_show','checked_out','left_early'));
ALTER TABLE activity_attendance_entry_revisions DROP CONSTRAINT activity_attendance_entry_revisions_previous_status_check;
ALTER TABLE activity_attendance_entry_revisions DROP CONSTRAINT activity_attendance_entry_revisions_new_status_check;
ALTER TABLE activity_attendance_entry_revisions ADD CONSTRAINT activity_attendance_entry_revisions_previous_status_check
  CHECK(previous_status IN ('present','absent','late','excused','half_day','no_show','checked_out','left_early'));
ALTER TABLE activity_attendance_entry_revisions ADD CONSTRAINT activity_attendance_entry_revisions_new_status_check
  CHECK(new_status IN ('present','absent','late','excused','half_day','no_show','checked_out','left_early'));
ALTER TABLE activity_attendance_evidence DROP CONSTRAINT activity_attendance_evidence_claimed_status_check;
ALTER TABLE activity_attendance_evidence ADD CONSTRAINT activity_attendance_evidence_claimed_status_check
  CHECK(claimed_status IN ('present','absent','late','excused','half_day','no_show','checked_out','left_early'));

-- Context details explain an accepted common revision; they cannot independently
-- assert a status, person, recorder or accepted decision.
CREATE TABLE activity_attendance_context_details (
  entry_revision_id bigint PRIMARY KEY REFERENCES activity_attendance_entry_revisions(id) ON DELETE RESTRICT,
  school_id uuid NOT NULL REFERENCES schools(id),
  register_id uuid NOT NULL,
  source_kind varchar(24) NOT NULL CHECK(source_kind IN ('event','examination')),
  details jsonb NOT NULL CHECK(jsonb_typeof(details)='object'),
  FOREIGN KEY(register_id,school_id) REFERENCES activity_attendance_registers(id,school_id)
);
CREATE INDEX participation_context_details_register ON activity_attendance_context_details(school_id,register_id,entry_revision_id);
CREATE FUNCTION validate_participation_context_detail() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM activity_attendance_entry_revisions revision
    JOIN schedule_activity_occurrences occurrence ON occurrence.school_id=revision.school_id
    JOIN activity_attendance_registers register ON register.id=revision.register_id AND register.occurrence_id=occurrence.id
    WHERE revision.id=NEW.entry_revision_id AND revision.school_id=NEW.school_id
      AND revision.register_id=NEW.register_id AND occurrence.source=NEW.source_kind) THEN
    RAISE EXCEPTION 'Context details must explain the same accepted participation source' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER participation_context_detail_scope BEFORE INSERT ON activity_attendance_context_details
  FOR EACH ROW EXECUTE FUNCTION validate_participation_context_detail();
CREATE TRIGGER participation_context_detail_immutable BEFORE UPDATE OR DELETE ON activity_attendance_context_details
  FOR EACH ROW EXECUTE FUNCTION prevent_attendance_observation_mutation();
ALTER TABLE activity_attendance_context_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON activity_attendance_context_details FROM PUBLIC;

ALTER TABLE campus_event_attendance_records RENAME TO campus_event_attendance_records_legacy_source;
ALTER TABLE campus_event_attendance_revisions RENAME TO campus_event_attendance_revisions_legacy_source;
ALTER TABLE assessment_candidate_attendance RENAME TO assessment_candidate_attendance_legacy_source;

CREATE VIEW campus_event_attendance_records AS
SELECT original.* FROM campus_event_attendance_records_legacy_source original
WHERE NOT EXISTS(SELECT 1 FROM activity_attendance_legacy_links link WHERE link.school_id=original.school_id
  AND link.source_kind='event' AND link.source_id=original.session_id::text AND link.state='active')
UNION ALL
SELECT entry.id,entry.school_id,occurrence.context_ref,link.source_id::uuid,person.student_id,
  COALESCE(entry.status,'not_recorded'),entry.remarks,
  COALESCE(detail.details->>'readiness_contradiction_note',original.readiness_contradiction_note),
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

CREATE VIEW campus_event_attendance_revisions AS
SELECT original.* FROM campus_event_attendance_revisions_legacy_source original
UNION ALL
SELECT -revision.id,revision.school_id,occurrence.context_ref,link.source_id::uuid,person.student_id,revision.entry_id,
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

CREATE VIEW assessment_candidate_attendance AS
SELECT original.* FROM assessment_candidate_attendance_legacy_source original
WHERE NOT EXISTS(SELECT 1 FROM activity_attendance_legacy_links link WHERE link.school_id=original.school_id
  AND link.source_kind='examination' AND link.source_id=original.sitting_id::text AND link.state='active')
UNION ALL
SELECT COALESCE(entry.id,candidate.id),candidate.school_id,candidate.sitting_id,candidate.id,candidate.student_id,
  COALESCE(entry.status,'unrecorded'),entry.observed_at,COALESCE(entry.remarks,''),COALESCE(entry.revision,1),
  entry.recorded_by,COALESCE(entry.updated_at,candidate.frozen_at)
FROM assessment_sitting_candidates candidate
JOIN activity_attendance_legacy_links link ON link.school_id=candidate.school_id AND link.source_kind='examination'
  AND link.source_id=candidate.sitting_id::text AND link.state='active'
JOIN activity_attendance_legacy_people person ON person.register_id=link.register_id AND person.student_id=candidate.student_id
LEFT JOIN activity_attendance_entries entry ON entry.register_id=link.register_id AND entry.person_id=person.person_id;

-- Direct writes into an activated original table are forbidden too. The public
-- names are read-only views; retained sources cannot become a maintenance bypass.
CREATE FUNCTION guard_owned_participation_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_school uuid; row_source uuid; kind text;
BEGIN
  row_school:=COALESCE(NEW.school_id,OLD.school_id);
  kind:=CASE WHEN TG_TABLE_NAME='assessment_candidate_attendance_legacy_source' THEN 'examination' ELSE 'event' END;
  row_source:=CASE WHEN kind='examination' THEN COALESCE(NEW.sitting_id,OLD.sitting_id) ELSE COALESCE(NEW.session_id,OLD.session_id) END;
  IF EXISTS(SELECT 1 FROM activity_attendance_legacy_links link WHERE link.school_id=row_school
    AND link.source_kind=kind AND link.source_id=row_source::text AND link.state='active') THEN
    RAISE EXCEPTION 'Accepted participation is owned by the shared kernel, not this retained source' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER owned_event_participation_fence BEFORE INSERT OR UPDATE OR DELETE ON campus_event_attendance_records_legacy_source
  FOR EACH ROW EXECUTE FUNCTION guard_owned_participation_source();
CREATE TRIGGER owned_exam_participation_fence BEFORE INSERT OR UPDATE OR DELETE ON assessment_candidate_attendance_legacy_source
  FOR EACH ROW EXECUTE FUNCTION guard_owned_participation_source();
REVOKE ALL ON campus_event_attendance_records,campus_event_attendance_revisions,assessment_candidate_attendance FROM PUBLIC;
DO $$ DECLARE database_role text;
BEGIN
  FOREACH database_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=database_role) THEN
      EXECUTE format('REVOKE ALL ON activity_attendance_context_details,campus_event_attendance_records,campus_event_attendance_revisions,assessment_candidate_attendance FROM %I',database_role);
    END IF;
  END LOOP;
END $$;
