-- Explicit correction evidence is additive; existing receipt facts are untouched.
ALTER TABLE accommodation_receipts ADD COLUMN movement_kind varchar(8) CHECK(movement_kind IN('move_in','move_out')),
 ADD COLUMN movement_retracted boolean NOT NULL DEFAULT false,
 ADD CONSTRAINT accommodation_movement_retraction_evidence CHECK(NOT movement_retracted OR action='movement_corrected' AND movement_kind IS NOT NULL AND supersedes_receipt_id IS NOT NULL AND length(trim(note))>=3);
CREATE UNIQUE INDEX accommodation_temporary_access_owner_idx ON accommodation_access_loans(school_id,loan_id) WHERE return_required;

CREATE OR REPLACE FUNCTION accommodation_physical_topology_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE residential_descendant boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('accommodation-capacity:'||OLD.school_id::text,0));
 IF TG_TABLE_NAME='campus_spaces' THEN
  WITH RECURSIVE descendants AS(
   SELECT id,ARRAY[id] AS visited FROM campus_spaces WHERE school_id=OLD.school_id AND id=OLD.id
   UNION ALL SELECT child.id,parent.visited||child.id FROM campus_spaces child JOIN descendants parent ON child.parent_space_id=parent.id WHERE child.school_id=OLD.school_id AND NOT child.id=ANY(parent.visited))
  SELECT EXISTS(SELECT 1 FROM accommodation_rooms room JOIN descendants ON descendants.id=room.space_id WHERE room.school_id=OLD.school_id AND room.active) INTO residential_descendant;
  IF residential_descendant AND(NEW.status<>'active' OR NEW.kind='virtual' OR ROW(NEW.campus_id,NEW.parent_space_id) IS DISTINCT FROM ROW(OLD.campus_id,OLD.parent_space_id)) THEN RAISE EXCEPTION 'End active residential use before inactivating or relocating this room or its containing hostel/block.' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='institution_campuses' THEN
  IF NEW.status<>'active' AND EXISTS(SELECT 1 FROM accommodation_rooms room JOIN campus_spaces space ON space.id=room.space_id AND space.school_id=room.school_id WHERE space.campus_id=OLD.id AND room.school_id=OLD.school_id AND room.active) THEN RAISE EXCEPTION 'This campus still has active residential rooms.' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='campus_resource_holdings' THEN
  IF EXISTS(SELECT 1 FROM accommodation_places WHERE school_id=OLD.school_id AND holding_id=OLD.id AND active) AND ROW(NEW.space_id,NEW.campus_id,NEW.resource_type_id,NEW.state) IS DISTINCT FROM ROW(OLD.space_id,OLD.campus_id,OLD.resource_type_id,OLD.state) THEN RAISE EXCEPTION 'End or correct the named-place furniture link before relocating, retyping or retiring that holding.' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='campus_resource_types' THEN
  IF (NEW.tracking_mode<>'individual' OR NOT NEW.is_active) AND EXISTS(SELECT 1 FROM accommodation_places place JOIN campus_resource_holdings holding ON holding.id=place.holding_id AND holding.school_id=place.school_id WHERE place.school_id=OLD.school_id AND holding.resource_type_id=OLD.id AND place.active) THEN RAISE EXCEPTION 'This resource type still identifies active named-place furniture.' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE FUNCTION accommodation_access_link_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM accommodation_stays stay JOIN accommodation_receipts receipt ON receipt.school_id=stay.school_id AND receipt.stay_id=stay.id AND receipt.revision=NEW.receipt_revision AND receipt.action='access_linked'
  JOIN resource_loans loan ON loan.school_id=stay.school_id AND loan.id=NEW.loan_id AND loan.borrower_person_id=stay.resident_person_id
  WHERE stay.school_id=NEW.school_id AND stay.id=NEW.stay_id AND stay.state IN('offered','accepted') AND stay.access_mode<>'no_tracked_item' AND NEW.return_required=(stay.access_mode='tracked_required'))
 THEN RAISE EXCEPTION 'A linked access loan needs exact current resident custody, mode and native source evidence.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER accommodation_access_link_scope BEFORE INSERT ON accommodation_access_loans FOR EACH ROW EXECUTE FUNCTION accommodation_access_link_guard();
