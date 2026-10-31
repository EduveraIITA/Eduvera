-- Accommodation owns residential use and capacity, not another campus catalogue.
ALTER TABLE campus_spaces DROP CONSTRAINT campus_spaces_kind_check;
ALTER TABLE campus_spaces ADD CONSTRAINT campus_spaces_kind_check CHECK(kind IN('hostel','residential_room','building','wing','floor','classroom','laboratory','library','office','auditorium','sports_area','workshop','staff_room','gate','outdoor_area','virtual','other'));
CREATE TABLE accommodation_room_types (
 id uuid PRIMARY KEY,school_id uuid NOT NULL REFERENCES schools(id),name varchar(100) NOT NULL,
 default_capacity integer NOT NULL CHECK(default_capacity BETWEEN 1 AND 1000),allocation_mode varchar(12) NOT NULL CHECK(allocation_mode IN('whole_room','shared')),
 active boolean NOT NULL,revision integer NOT NULL CHECK(revision>0),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,UNIQUE(id,school_id)
);
CREATE UNIQUE INDEX accommodation_type_name_idx ON accommodation_room_types(school_id,lower(name)) WHERE active;
CREATE TABLE accommodation_rooms (
 id uuid PRIMARY KEY,school_id uuid NOT NULL REFERENCES schools(id),space_id uuid NOT NULL,room_type_id uuid NOT NULL,
 sleeping_capacity integer NOT NULL CHECK(sleeping_capacity BETWEEN 1 AND 1000),allocation_mode varchar(12) NOT NULL CHECK(allocation_mode IN('whole_room','shared')),
 active boolean NOT NULL,revision integer NOT NULL CHECK(revision>0),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,UNIQUE(id,school_id),UNIQUE(space_id,school_id),
 FOREIGN KEY(space_id,school_id) REFERENCES campus_spaces(id,school_id),FOREIGN KEY(room_type_id,school_id) REFERENCES accommodation_room_types(id,school_id)
);
CREATE INDEX accommodation_room_type_idx ON accommodation_rooms(school_id,room_type_id);
CREATE TABLE accommodation_places (
 id uuid PRIMARY KEY,school_id uuid NOT NULL REFERENCES schools(id),room_id uuid NOT NULL,label varchar(100) NOT NULL,holding_id uuid,
 active boolean NOT NULL,revision integer NOT NULL CHECK(revision>0),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,UNIQUE(id,school_id),UNIQUE(id,school_id,room_id),
 FOREIGN KEY(room_id,school_id) REFERENCES accommodation_rooms(id,school_id),FOREIGN KEY(holding_id,school_id) REFERENCES campus_resource_holdings(id,school_id)
);
CREATE UNIQUE INDEX accommodation_place_label_idx ON accommodation_places(school_id,room_id,lower(label)) WHERE active;
CREATE UNIQUE INDEX accommodation_place_holding_idx ON accommodation_places(school_id,holding_id) WHERE active AND holding_id IS NOT NULL;
CREATE TABLE accommodation_stays (
 id uuid PRIMARY KEY,school_id uuid NOT NULL REFERENCES schools(id),resident_person_id uuid NOT NULL,coordinator_person_id uuid NOT NULL,recorder_person_id uuid NOT NULL,recorded_by_user_id uuid NOT NULL REFERENCES users(id),
 room_id uuid NOT NULL,place_id uuid,repair_id uuid,origin_space_id uuid,origin_note varchar(300) NOT NULL,instructions varchar(2000) NOT NULL,
 access_mode varchar(20) NOT NULL CHECK(access_mode IN('no_tracked_item','existing_access','tracked_required')),
 state varchar(12) NOT NULL CHECK(state IN('offered','accepted','declined','cancelled','closed')),planned_starts_at timestamptz NOT NULL,planned_ends_at timestamptz NOT NULL,proposed_ends_at timestamptz,accepted_at timestamptz,
 actual_move_in_at timestamptz,actual_move_out_at timestamptz,destination_space_id uuid,destination_note varchar(300) NOT NULL DEFAULT'',revision integer NOT NULL CHECK(revision>0),
 created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,coordination_receipt jsonb NOT NULL DEFAULT'{}',UNIQUE(id,school_id),
 FOREIGN KEY(resident_person_id,school_id) REFERENCES school_people(id,school_id),FOREIGN KEY(coordinator_person_id,school_id) REFERENCES school_people(id,school_id),FOREIGN KEY(recorder_person_id,school_id) REFERENCES school_people(id,school_id),
 FOREIGN KEY(room_id,school_id) REFERENCES accommodation_rooms(id,school_id),FOREIGN KEY(place_id,school_id,room_id) REFERENCES accommodation_places(id,school_id,room_id),
 FOREIGN KEY(repair_id,school_id) REFERENCES facilities_repairs(id,school_id),FOREIGN KEY(origin_space_id,school_id) REFERENCES campus_spaces(id,school_id),FOREIGN KEY(destination_space_id,school_id) REFERENCES campus_spaces(id,school_id),
 CHECK(planned_ends_at>planned_starts_at),CHECK(proposed_ends_at IS NULL OR proposed_ends_at>planned_ends_at),CHECK(actual_move_out_at IS NULL OR actual_move_in_at IS NOT NULL AND actual_move_out_at>=actual_move_in_at),
 CHECK(state<>'accepted' OR accepted_at IS NOT NULL),CHECK(actual_move_in_at IS NULL OR accepted_at IS NOT NULL),CHECK(state NOT IN('declined','cancelled') OR actual_move_in_at IS NULL)
);
CREATE INDEX accommodation_stay_room_idx ON accommodation_stays(school_id,room_id,planned_starts_at,planned_ends_at) WHERE state IN('offered','accepted');
CREATE INDEX accommodation_stay_place_idx ON accommodation_stays(school_id,place_id) WHERE place_id IS NOT NULL;
CREATE INDEX accommodation_stay_resident_idx ON accommodation_stays(school_id,resident_person_id,updated_at DESC,id);
CREATE INDEX accommodation_stay_coordinator_idx ON accommodation_stays(school_id,coordinator_person_id,updated_at DESC,id);
CREATE INDEX accommodation_stay_recorder_idx ON accommodation_stays(school_id,recorder_person_id,updated_at DESC,id);
CREATE INDEX accommodation_stay_author_idx ON accommodation_stays(school_id,recorded_by_user_id);
CREATE INDEX accommodation_stay_repair_idx ON accommodation_stays(school_id,repair_id) WHERE repair_id IS NOT NULL;
CREATE INDEX accommodation_stay_origin_idx ON accommodation_stays(school_id,origin_space_id) WHERE origin_space_id IS NOT NULL;
CREATE INDEX accommodation_stay_destination_idx ON accommodation_stays(school_id,destination_space_id) WHERE destination_space_id IS NOT NULL;
CREATE TABLE accommodation_receipts (
 id uuid PRIMARY KEY,school_id uuid NOT NULL,stay_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),command_id uuid NOT NULL,
 action varchar(24) NOT NULL CHECK(action IN('offered','accepted','declined','response_recorded','moved_in','moved_out','extension_offered','extension_accepted','extension_declined','cancelled','movement_corrected','reassigned','closed','access_linked')),
 actor_person_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES users(id),note varchar(2000) NOT NULL,observed_at timestamptz,method varchar(12) CHECK(method IN('in_person','phone','written')),response varchar(8) CHECK(response IN('accept','decline')),response_for varchar(12) CHECK(response_for IN('offer','extension')),supersedes_receipt_id uuid,
 state varchar(12) NOT NULL,coordinator_person_id uuid NOT NULL,recorder_person_id uuid NOT NULL,planned_starts_at timestamptz NOT NULL,planned_ends_at timestamptz NOT NULL,proposed_ends_at timestamptz,accepted_at timestamptz,actual_move_in_at timestamptz,actual_move_out_at timestamptz,destination_space_id uuid,destination_note varchar(300) NOT NULL,recorded_at timestamptz NOT NULL,
 UNIQUE(id,school_id),UNIQUE(stay_id,school_id,revision),UNIQUE(school_id,command_id),FOREIGN KEY(stay_id,school_id) REFERENCES accommodation_stays(id,school_id),FOREIGN KEY(actor_person_id,school_id) REFERENCES school_people(id,school_id),
 FOREIGN KEY(coordinator_person_id,school_id) REFERENCES school_people(id,school_id),FOREIGN KEY(recorder_person_id,school_id) REFERENCES school_people(id,school_id),FOREIGN KEY(supersedes_receipt_id,school_id) REFERENCES accommodation_receipts(id,school_id),FOREIGN KEY(destination_space_id,school_id) REFERENCES campus_spaces(id,school_id),
 CHECK(action<>'response_recorded' OR observed_at IS NOT NULL AND method IS NOT NULL AND response IS NOT NULL AND response_for IS NOT NULL AND length(trim(note))>=3),
 CHECK(action NOT IN('moved_in','moved_out','movement_corrected') OR observed_at IS NOT NULL),CHECK(action<>'movement_corrected' OR supersedes_receipt_id IS NOT NULL AND length(trim(note))>=3)
);
CREATE INDEX accommodation_receipt_actor_idx ON accommodation_receipts(school_id,actor_person_id);
CREATE INDEX accommodation_receipt_coordinator_idx ON accommodation_receipts(school_id,coordinator_person_id);
CREATE INDEX accommodation_receipt_recorder_idx ON accommodation_receipts(school_id,recorder_person_id);
CREATE INDEX accommodation_receipt_supersedes_idx ON accommodation_receipts(school_id,supersedes_receipt_id) WHERE supersedes_receipt_id IS NOT NULL;
CREATE INDEX accommodation_receipt_destination_idx ON accommodation_receipts(school_id,destination_space_id) WHERE destination_space_id IS NOT NULL;
CREATE TABLE accommodation_setup_receipts (
 id uuid PRIMARY KEY,school_id uuid NOT NULL REFERENCES schools(id),source_id uuid NOT NULL,kind varchar(12) NOT NULL CHECK(kind IN('room_type','room','place')),revision integer NOT NULL CHECK(revision>0),command_id uuid NOT NULL,
 actor_person_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES users(id),name varchar(100) NOT NULL,default_capacity integer,allocation_mode varchar(12),space_id uuid,room_type_id uuid,sleeping_capacity integer,room_id uuid,holding_id uuid,active boolean NOT NULL,reason varchar(1000) NOT NULL,recorded_at timestamptz NOT NULL,
 UNIQUE(id,school_id),UNIQUE(school_id,source_id,revision),UNIQUE(school_id,command_id),FOREIGN KEY(actor_person_id,school_id) REFERENCES school_people(id,school_id),FOREIGN KEY(space_id,school_id) REFERENCES campus_spaces(id,school_id),FOREIGN KEY(room_type_id,school_id) REFERENCES accommodation_room_types(id,school_id),FOREIGN KEY(room_id,school_id) REFERENCES accommodation_rooms(id,school_id),FOREIGN KEY(holding_id,school_id) REFERENCES campus_resource_holdings(id,school_id)
);
CREATE INDEX accommodation_setup_actor_idx ON accommodation_setup_receipts(school_id,actor_person_id);
CREATE INDEX accommodation_setup_space_idx ON accommodation_setup_receipts(school_id,space_id) WHERE space_id IS NOT NULL;
CREATE INDEX accommodation_setup_type_idx ON accommodation_setup_receipts(school_id,room_type_id) WHERE room_type_id IS NOT NULL;
CREATE INDEX accommodation_setup_room_idx ON accommodation_setup_receipts(school_id,room_id) WHERE room_id IS NOT NULL;
CREATE INDEX accommodation_setup_holding_idx ON accommodation_setup_receipts(school_id,holding_id) WHERE holding_id IS NOT NULL;
CREATE TABLE accommodation_access_loans (
 id uuid PRIMARY KEY,school_id uuid NOT NULL,stay_id uuid NOT NULL,loan_id uuid NOT NULL,return_required boolean NOT NULL,receipt_revision integer NOT NULL,created_at timestamptz NOT NULL,
 UNIQUE(id,school_id),UNIQUE(school_id,stay_id,loan_id),FOREIGN KEY(stay_id,school_id,receipt_revision) REFERENCES accommodation_receipts(stay_id,school_id,revision),FOREIGN KEY(loan_id,school_id) REFERENCES resource_loans(id,school_id)
);
CREATE INDEX accommodation_access_loan_idx ON accommodation_access_loans(school_id,loan_id);
CREATE TRIGGER accommodation_receipts_immutable BEFORE UPDATE OR DELETE ON accommodation_receipts FOR EACH ROW EXECUTE FUNCTION facilities_history_immutable();
CREATE TRIGGER accommodation_setup_immutable BEFORE UPDATE OR DELETE ON accommodation_setup_receipts FOR EACH ROW EXECUTE FUNCTION facilities_history_immutable();
CREATE TRIGGER accommodation_access_immutable BEFORE UPDATE OR DELETE ON accommodation_access_loans FOR EACH ROW EXECUTE FUNCTION facilities_history_immutable();

CREATE FUNCTION accommodation_assert_capacity(tenant uuid,target_room uuid,excluded uuid,resident uuid,target_place uuid,starts timestamptz,ends timestamptz,physical boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE room accommodation_rooms;peak integer;selected_now timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('accommodation-capacity:'||tenant::text,0));
 selected_now:=nullif(current_setting('thatcampus.accommodation_now',true),'')::timestamptz;
 IF selected_now IS NULL THEN RAISE EXCEPTION 'Accommodation capacity requires the selected execution clock.' USING ERRCODE='23514';END IF;
 SELECT * INTO room FROM accommodation_rooms WHERE school_id=tenant AND id=target_room FOR UPDATE;
 IF room.id IS NULL OR NOT room.active THEN RAISE EXCEPTION 'Choose an active residential room.' USING ERRCODE='23514';END IF;
 IF target_place IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accommodation_places WHERE school_id=tenant AND room_id=target_room AND id=target_place AND active) THEN RAISE EXCEPTION 'Choose a current place in this room.' USING ERRCODE='23514';END IF;
 IF room.allocation_mode='whole_room' AND target_place IS NOT NULL THEN RAISE EXCEPTION 'Whole-room allocation does not allocate an individual place.' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM accommodation_stays stay WHERE stay.school_id=tenant AND stay.id<>excluded AND stay.resident_person_id=resident AND stay.state IN('offered','accepted') AND stay.actual_move_out_at IS NULL
  AND (tstzrange(stay.planned_starts_at,greatest(stay.planned_ends_at,coalesce(stay.proposed_ends_at,stay.planned_ends_at)),'[)') && tstzrange(starts,ends,'[)') OR stay.actual_move_in_at IS NOT NULL AND (physical OR stay.planned_ends_at<=selected_now)))
 THEN RAISE EXCEPTION 'This person already has an overlapping arrangement or unresolved occupancy.' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM accommodation_stays stay WHERE stay.school_id=tenant AND stay.room_id=target_room AND stay.id<>excluded AND stay.actual_move_out_at IS NULL AND stay.actual_move_in_at IS NOT NULL
   AND (physical OR stay.planned_ends_at<=selected_now) AND(room.allocation_mode='whole_room' OR target_place IS NOT NULL AND stay.place_id=target_place))
 THEN RAISE EXCEPTION 'The room or named place is still physically occupied.' USING ERRCODE='23514';END IF;
 -- Required temporary access is never inferred returned from an expected date.
 IF EXISTS(SELECT 1 FROM accommodation_stays stay WHERE stay.school_id=tenant AND stay.room_id=target_room AND stay.id<>excluded AND stay.actual_move_out_at IS NOT NULL AND stay.access_mode='tracked_required'
  AND(room.allocation_mode='whole_room' OR target_place IS NOT NULL AND stay.place_id=target_place)
  AND(NOT EXISTS(SELECT 1 FROM accommodation_access_loans link WHERE link.school_id=tenant AND link.stay_id=stay.id AND link.return_required)
   OR EXISTS(SELECT 1 FROM accommodation_access_loans link JOIN resource_loan_status balance ON balance.school_id=link.school_id AND balance.id=link.loan_id WHERE link.school_id=tenant AND link.stay_id=stay.id AND link.return_required AND balance.outstanding_count>0)))
 THEN RAISE EXCEPTION 'Required temporary access is still unsettled for this room or place.' USING ERRCODE='23514';END IF;
 IF target_place IS NOT NULL AND EXISTS(SELECT 1 FROM accommodation_stays stay WHERE stay.school_id=tenant AND stay.room_id=target_room AND stay.place_id=target_place AND stay.id<>excluded AND stay.state IN('offered','accepted') AND stay.actual_move_out_at IS NULL
  AND tstzrange(stay.planned_starts_at,greatest(stay.planned_ends_at,coalesce(stay.proposed_ends_at,stay.planned_ends_at)),'[)') && tstzrange(starts,ends,'[)')) THEN RAISE EXCEPTION 'This named place is already held.' USING ERRCODE='23514';END IF;
 WITH claims AS(SELECT stay.planned_starts_at AS lo,CASE WHEN stay.actual_move_in_at IS NOT NULL AND stay.actual_move_out_at IS NULL AND stay.planned_ends_at<=selected_now OR stay.actual_move_out_at IS NOT NULL THEN 'infinity'::timestamptz ELSE greatest(stay.planned_ends_at,coalesce(stay.proposed_ends_at,stay.planned_ends_at)) END AS hi
  FROM accommodation_stays stay WHERE stay.school_id=tenant AND stay.room_id=target_room AND stay.id<>excluded AND(stay.state IN('offered','accepted') AND stay.actual_move_out_at IS NULL OR stay.actual_move_out_at IS NOT NULL AND stay.access_mode='tracked_required' AND(
   NOT EXISTS(SELECT 1 FROM accommodation_access_loans link WHERE link.school_id=tenant AND link.stay_id=stay.id AND link.return_required) OR EXISTS(SELECT 1 FROM accommodation_access_loans link JOIN resource_loan_status balance ON balance.school_id=link.school_id AND balance.id=link.loan_id WHERE link.school_id=tenant AND link.stay_id=stay.id AND link.return_required AND balance.outstanding_count>0)))),
 boundaries AS(SELECT starts AS at UNION SELECT lo FROM claims WHERE lo>starts AND lo<ends)
 SELECT coalesce(max((SELECT count(*) FROM claims WHERE lo<=boundary.at AND hi>boundary.at)),0)::int INTO peak FROM boundaries boundary;
 IF physical THEN SELECT count(*)::int INTO peak FROM accommodation_stays stay WHERE stay.school_id=tenant AND stay.room_id=target_room AND stay.id<>excluded AND(stay.actual_move_in_at IS NOT NULL AND stay.actual_move_out_at IS NULL OR stay.actual_move_out_at IS NOT NULL AND stay.access_mode='tracked_required' AND(
  NOT EXISTS(SELECT 1 FROM accommodation_access_loans link WHERE link.school_id=tenant AND link.stay_id=stay.id AND link.return_required) OR EXISTS(SELECT 1 FROM accommodation_access_loans link JOIN resource_loan_status balance ON balance.school_id=link.school_id AND balance.id=link.loan_id WHERE link.school_id=tenant AND link.stay_id=stay.id AND link.return_required AND balance.outstanding_count>0)));END IF;
 IF peak+1>(CASE WHEN room.allocation_mode='whole_room' THEN 1 ELSE room.sleeping_capacity END) THEN RAISE EXCEPTION 'This room has no capacity for this arrangement.' USING ERRCODE='23514';END IF;
END $$;

CREATE FUNCTION accommodation_native_command_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE source uuid;event_name text;
BEGIN
 source:=CASE WHEN TG_TABLE_NAME='accommodation_receipts' THEN NEW.stay_id ELSE NEW.source_id END;
 event_name:=CASE WHEN TG_TABLE_NAME='accommodation_receipts' THEN 'accommodation.stay.'||NEW.action ELSE 'accommodation.setup.'||NEW.kind END;
 IF NOT EXISTS(SELECT 1 FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
  JOIN campus_model_events event ON event.source_outbox_event_id=outcome.domain_event_id AND event.school_id=command.school_id
  JOIN campus_model_agents actor ON actor.id=command.actor_agent_id AND actor.person_id=NEW.actor_person_id
  WHERE command.id=NEW.command_id AND command.school_id=NEW.school_id AND command.source_domain='accommodation' AND command.handler_key='accommodation.commands' AND command.handler_version=1
   AND command.state='accepted' AND outcome.status='accepted' AND command.expected_revision=NEW.revision-1 AND outcome.resulting_revision=NEW.revision
   AND command.safe_context->>'source_id'=source::text AND event.source_domain='accommodation' AND event.source_record_id=source::text AND event.source_revision=NEW.revision AND event.event_type=event_name
   AND event.actor_agent_id=command.actor_agent_id AND event.realm_id=command.realm_id AND event.environment_namespace_id=command.environment_namespace_id
   AND command.environment_namespace_id=coalesce(nullif(current_setting('thatcampus.namespace_id',true),''),CASE WHEN current_schema()='public' THEN 'live:'||NEW.school_id::text END))
 THEN RAISE EXCEPTION 'Accommodation evidence requires its exact accepted DT command and event.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER accommodation_receipt_dt AFTER INSERT ON accommodation_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION accommodation_native_command_guard();
CREATE CONSTRAINT TRIGGER accommodation_setup_dt AFTER INSERT ON accommodation_setup_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION accommodation_native_command_guard();
CREATE FUNCTION accommodation_stay_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM accommodation_receipts receipt WHERE receipt.school_id=NEW.school_id AND receipt.stay_id=NEW.id AND receipt.revision=NEW.revision AND receipt.state=NEW.state
  AND receipt.coordinator_person_id=NEW.coordinator_person_id AND receipt.recorder_person_id=NEW.recorder_person_id AND receipt.planned_starts_at=NEW.planned_starts_at AND receipt.planned_ends_at=NEW.planned_ends_at
  AND receipt.proposed_ends_at IS NOT DISTINCT FROM NEW.proposed_ends_at AND receipt.accepted_at IS NOT DISTINCT FROM NEW.accepted_at AND receipt.actual_move_in_at IS NOT DISTINCT FROM NEW.actual_move_in_at
  AND receipt.actual_move_out_at IS NOT DISTINCT FROM NEW.actual_move_out_at AND receipt.destination_space_id IS NOT DISTINCT FROM NEW.destination_space_id AND receipt.destination_note=NEW.destination_note AND receipt.recorded_at=NEW.updated_at)
 THEN RAISE EXCEPTION 'Every stay revision requires its exact immutable operation.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER accommodation_stay_revision AFTER INSERT OR UPDATE ON accommodation_stays DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION accommodation_stay_revision_guard();
CREATE FUNCTION accommodation_current_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Accommodation retains its operating history.' USING ERRCODE='23514';END IF;
 IF NEW.revision NOT IN(OLD.revision,OLD.revision+1) OR NEW.revision=OLD.revision AND(to_jsonb(NEW)-'coordination_receipt') IS DISTINCT FROM(to_jsonb(OLD)-'coordination_receipt')
 THEN RAISE EXCEPTION 'Accommodation changes require the next exact revision.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER accommodation_stay_current BEFORE UPDATE OR DELETE ON accommodation_stays FOR EACH ROW EXECUTE FUNCTION accommodation_current_guard();
CREATE TRIGGER accommodation_room_current BEFORE UPDATE OR DELETE ON accommodation_rooms FOR EACH ROW EXECUTE FUNCTION accommodation_current_guard();
CREATE TRIGGER accommodation_type_current BEFORE UPDATE OR DELETE ON accommodation_room_types FOR EACH ROW EXECUTE FUNCTION accommodation_current_guard();
CREATE TRIGGER accommodation_place_current BEFORE UPDATE OR DELETE ON accommodation_places FOR EACH ROW EXECUTE FUNCTION accommodation_current_guard();
