-- An explicit campus destination is not a synthetic room or a reservation.
ALTER TABLE gate_visit_arrangements ALTER COLUMN place_id DROP NOT NULL;
ALTER TABLE gate_visit_arrangements ADD COLUMN destination_campus_id uuid;
ALTER TABLE gate_visit_arrangements ADD CONSTRAINT gate_visit_campus_destination_fk FOREIGN KEY(destination_campus_id,school_id) REFERENCES institution_campuses(id,school_id) ON DELETE RESTRICT;
ALTER TABLE gate_visit_arrangements ADD CONSTRAINT gate_visit_exact_destination CHECK(num_nonnulls(place_id,destination_campus_id)=1);
CREATE INDEX gate_visit_campus_destination_idx ON gate_visit_arrangements(destination_campus_id,school_id) WHERE destination_campus_id IS NOT NULL;
CREATE OR REPLACE FUNCTION gate_visit_revision_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Visit versions are immutable.' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM gate_visit_arrangements visit
  LEFT JOIN school_people guest ON guest.id=visit.person_id AND guest.school_id=visit.school_id
  JOIN school_people contact ON contact.id=visit.contact_person_id AND contact.school_id=visit.school_id
  JOIN school_people actor ON actor.id=visit.updated_by_person_id AND actor.school_id=visit.school_id
  LEFT JOIN campus_spaces place ON place.id=visit.place_id AND place.school_id=visit.school_id
  LEFT JOIN institution_campuses campus ON campus.id=visit.destination_campus_id AND campus.school_id=visit.school_id
  WHERE visit.school_id=NEW.school_id AND visit.id=NEW.visit_id AND visit.revision=NEW.revision
  AND visit.last_command_id=NEW.command_id AND visit.updated_by_person_id=NEW.actor_person_id AND visit.updated_by_user_id=NEW.actor_user_id
  AND visit.updated_at=NEW.recorded_at AND NEW.snapshot=to_jsonb(visit)-'last_domain_event_id'
  AND NEW.guest_label=CASE WHEN visit.person_id IS NOT NULL THEN btrim(concat(guest.first_name,' ',guest.last_name)) ELSE visit.guest_name END
  AND NEW.place_label=coalesce(place.name,campus.name) AND NEW.contact_label=btrim(concat(contact.first_name,' ',contact.last_name))
  AND NEW.actor_label=btrim(concat(actor.first_name,' ',actor.last_name)))
 THEN RAISE EXCEPTION 'A visit version must retain its exact typed source state and actor.' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
