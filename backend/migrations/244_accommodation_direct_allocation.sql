-- A coordinator's allocation confirms an arrangement, not resident consent or a move.
-- Existing rows keep their original offer/response history and meaning.
ALTER TABLE accommodation_stays
 ADD COLUMN arrangement_basis varchar(24) NOT NULL DEFAULT 'resident_offer',
 ADD CONSTRAINT accommodation_stay_arrangement_basis CHECK(arrangement_basis IN('resident_offer','coordinator_allocation')),
 ADD CONSTRAINT accommodation_allocation_state CHECK(arrangement_basis<>'coordinator_allocation' OR state NOT IN('offered','declined') AND accepted_at IS NOT NULL AND proposed_ends_at IS NULL);
ALTER TABLE accommodation_receipts
 ADD COLUMN arrangement_basis varchar(24) NOT NULL DEFAULT 'resident_offer',
 DROP CONSTRAINT accommodation_receipts_action_check,
 ADD CONSTRAINT accommodation_receipts_action_check CHECK(action IN('offered','allocated','accepted','declined','response_recorded','moved_in','moved_out','extension_offered','extension_accepted','extension_declined','end_changed','cancelled','movement_corrected','reassigned','closed','access_linked')),
 ADD CONSTRAINT accommodation_receipt_arrangement_basis CHECK(arrangement_basis IN('resident_offer','coordinator_allocation')),
 ADD CONSTRAINT accommodation_allocation_no_response CHECK(arrangement_basis<>'coordinator_allocation' OR action NOT IN('offered','accepted','declined','response_recorded','extension_offered','extension_accepted','extension_declined') AND(method IS NULL OR action IN('moved_in','moved_out','movement_corrected')) AND response IS NULL AND response_for IS NULL AND proposed_ends_at IS NULL),
 ADD CONSTRAINT accommodation_allocation_evidence CHECK(action NOT IN('allocated','end_changed') OR arrangement_basis='coordinator_allocation' AND state='accepted' AND accepted_at IS NOT NULL AND observed_at IS NULL AND method IS NULL AND response IS NULL AND response_for IS NULL),
 ADD CONSTRAINT accommodation_initial_allocation CHECK(action<>'allocated' OR revision=1 AND actual_move_in_at IS NULL AND actual_move_out_at IS NULL),
 ADD CONSTRAINT accommodation_end_change_reason CHECK(action<>'end_changed' OR length(trim(note))>=3 AND actual_move_out_at IS NULL);

CREATE OR REPLACE FUNCTION accommodation_current_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Accommodation retains its operating history.' USING ERRCODE='23514';END IF;
 IF ROW(NEW.id,NEW.school_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.school_id,OLD.created_at)
  OR NEW.revision NOT IN(OLD.revision,OLD.revision+1) OR NEW.revision=OLD.revision AND(to_jsonb(NEW)-'coordination_receipt') IS DISTINCT FROM(to_jsonb(OLD)-'coordination_receipt')
 THEN RAISE EXCEPTION 'Accommodation changes require the next exact revision.' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='accommodation_stays' THEN
  IF ROW(NEW.resident_person_id,NEW.room_id,NEW.place_id,NEW.recorded_by_user_id,NEW.repair_id,NEW.origin_space_id,NEW.origin_note,NEW.instructions,NEW.access_mode,NEW.arrangement_basis)
   IS DISTINCT FROM ROW(OLD.resident_person_id,OLD.room_id,OLD.place_id,OLD.recorded_by_user_id,OLD.repair_id,OLD.origin_space_id,OLD.origin_note,OLD.instructions,OLD.access_mode,OLD.arrangement_basis)
  THEN RAISE EXCEPTION 'A stay retains its original resident, physical place and arrangement commitment.' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='accommodation_rooms' THEN
  IF NEW.space_id<>OLD.space_id THEN RAISE EXCEPTION 'A residential room retains its canonical physical identity.' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='accommodation_places' THEN
  IF NEW.room_id<>OLD.room_id THEN RAISE EXCEPTION 'A named place retains its physical room.' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION accommodation_stay_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM accommodation_receipts receipt WHERE receipt.school_id=NEW.school_id AND receipt.stay_id=NEW.id AND receipt.revision=NEW.revision AND receipt.state=NEW.state
  AND receipt.arrangement_basis=NEW.arrangement_basis
  AND receipt.coordinator_person_id=NEW.coordinator_person_id AND receipt.recorder_person_id=NEW.recorder_person_id AND receipt.planned_starts_at=NEW.planned_starts_at AND receipt.planned_ends_at=NEW.planned_ends_at
  AND receipt.proposed_ends_at IS NOT DISTINCT FROM NEW.proposed_ends_at AND receipt.accepted_at IS NOT DISTINCT FROM NEW.accepted_at AND receipt.actual_move_in_at IS NOT DISTINCT FROM NEW.actual_move_in_at
  AND receipt.actual_move_out_at IS NOT DISTINCT FROM NEW.actual_move_out_at AND receipt.destination_space_id IS NOT DISTINCT FROM NEW.destination_space_id AND receipt.destination_note=NEW.destination_note AND receipt.recorded_at=NEW.updated_at)
 THEN RAISE EXCEPTION 'Every stay revision requires its exact immutable operation.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION accommodation_receipt_authority_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE stay accommodation_stays;previous accommodation_receipts;selected_now timestamptz;
BEGIN
 SELECT * INTO STRICT stay FROM accommodation_stays WHERE school_id=NEW.school_id AND id=NEW.stay_id;
 SELECT * INTO previous FROM accommodation_receipts WHERE school_id=NEW.school_id AND stay_id=NEW.stay_id AND revision=NEW.revision-1;
 IF NEW.revision=1 AND NEW.action NOT IN('offered','allocated') OR NEW.revision>1 AND previous.revision IS NULL THEN RAISE EXCEPTION 'A stay operation needs its exact initial action or previous immutable revision.' USING ERRCODE='23514';END IF;
 IF NOT campus_model_account_person_is_active(NEW.school_id,NEW.actor_user_id,NEW.actor_person_id,NEW.recorded_at) THEN RAISE EXCEPTION 'A stay action requires current canonical app access.' USING ERRCODE='23514';END IF;
 IF NEW.arrangement_basis<>stay.arrangement_basis THEN RAISE EXCEPTION 'A receipt must retain the original arrangement basis.' USING ERRCODE='23514';END IF;
 IF NEW.action IN('offered','allocated') THEN
  IF NEW.revision<>1 OR NOT accommodation_actor_can_manage(NEW.school_id,NEW.actor_user_id) OR NEW.actor_user_id<>stay.recorded_by_user_id
   OR NEW.action='offered' AND(stay.state<>'offered' OR stay.arrangement_basis<>'resident_offer')
   OR NEW.action='allocated' AND(stay.state<>'accepted' OR stay.arrangement_basis<>'coordinator_allocation' OR NEW.accepted_at<>NEW.recorded_at)
  THEN RAISE EXCEPTION 'An initial room arrangement requires current explicit authority and its exact basis.' USING ERRCODE='23514';END IF;
 ELSIF NEW.action IN('accepted','declined','extension_accepted','extension_declined') THEN
  IF NEW.actor_person_id<>stay.resident_person_id THEN RAISE EXCEPTION 'Only the exact resident may give an authenticated response.' USING ERRCODE='23514';END IF;
 ELSIF NEW.action IN('moved_in','moved_out','movement_corrected') THEN
  IF NEW.actor_person_id<>previous.recorder_person_id THEN RAISE EXCEPTION 'Only the exact current recorder may record a physical move.' USING ERRCODE='23514';END IF;
 ELSIF NEW.action='reassigned' THEN
  IF NEW.actor_person_id<>previous.coordinator_person_id AND NOT(accommodation_actor_can_manage(NEW.school_id,NEW.actor_user_id) AND(NOT accommodation_person_available(NEW.school_id,previous.coordinator_person_id) OR NOT accommodation_person_available(NEW.school_id,previous.recorder_person_id))) THEN RAISE EXCEPTION 'Handover requires the current coordinator or explicit orphan recovery.' USING ERRCODE='23514';END IF;
 ELSIF NEW.action='access_linked' THEN
  IF NEW.actor_person_id NOT IN(previous.coordinator_person_id,previous.recorder_person_id) THEN RAISE EXCEPTION 'Only the current stay responsibility can link its custody evidence.' USING ERRCODE='23514';END IF;
 ELSE
  IF NEW.actor_person_id<>previous.coordinator_person_id THEN RAISE EXCEPTION 'This action requires the current exact coordinator.' USING ERRCODE='23514';END IF;
 END IF;
 IF NEW.action='response_recorded' AND NEW.actor_person_id=stay.resident_person_id THEN RAISE EXCEPTION 'Assisted response must retain a separate recorder, never impersonate the resident.' USING ERRCODE='23514';END IF;
 IF NEW.action='end_changed' THEN
  selected_now:=nullif(current_setting('thatcampus.accommodation_now',true),'')::timestamptz;
  IF selected_now IS NULL OR previous.revision IS NULL OR previous.arrangement_basis<>'coordinator_allocation' OR previous.state<>'accepted' OR previous.actual_move_out_at IS NOT NULL
   OR NEW.planned_ends_at<=selected_now OR NEW.planned_ends_at=previous.planned_ends_at
   OR ROW(NEW.state,NEW.coordinator_person_id,NEW.recorder_person_id,NEW.planned_starts_at,NEW.proposed_ends_at,NEW.accepted_at,NEW.actual_move_in_at,NEW.actual_move_out_at,NEW.destination_space_id,NEW.destination_note)
    IS DISTINCT FROM ROW(previous.state,previous.coordinator_person_id,previous.recorder_person_id,previous.planned_starts_at,previous.proposed_ends_at,previous.accepted_at,previous.actual_move_in_at,previous.actual_move_out_at,previous.destination_space_id,previous.destination_note)
  THEN RAISE EXCEPTION 'An allocation end change retains current movement facts and needs a new future end.' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
