-- Forward correction to169: trigger record attributes differ between sources;
-- a deliberate cleared context note must not revive its historical source note.
CREATE OR REPLACE FUNCTION guard_owned_participation_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_school uuid; row_source uuid; kind text;
BEGIN
  row_school:=COALESCE(NEW.school_id,OLD.school_id);
  kind:=CASE WHEN TG_TABLE_NAME='assessment_candidate_attendance_legacy_source' THEN 'examination' ELSE 'event' END;
  row_source:=(COALESCE(to_jsonb(NEW),to_jsonb(OLD))->>CASE WHEN kind='examination' THEN 'sitting_id' ELSE 'session_id' END)::uuid;
  IF EXISTS(SELECT 1 FROM activity_attendance_legacy_links link WHERE link.school_id=row_school
    AND link.source_kind=kind AND link.source_id=row_source::text AND link.state='active') THEN
    RAISE EXCEPTION 'Accepted participation is owned by the shared kernel, not this retained source' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE VIEW campus_event_attendance_records AS
SELECT original.* FROM campus_event_attendance_records_legacy_source original
WHERE NOT EXISTS(SELECT 1 FROM activity_attendance_legacy_links link WHERE link.school_id=original.school_id
  AND link.source_kind='event' AND link.source_id=original.session_id::text AND link.state='active')
UNION ALL
SELECT entry.id,entry.school_id,occurrence.context_ref,link.source_id::uuid,person.student_id,
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
