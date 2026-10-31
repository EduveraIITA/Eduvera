-- A repair assignment permits handling that one repair, not institution-wide
-- configuration or access to other people's repairs. Managers retain routing.
CREATE OR REPLACE FUNCTION facilities_repair_next_owner_available(tenant uuid,repair_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM facilities_repairs repair JOIN school_people person ON person.school_id=repair.school_id
  AND person.id=CASE WHEN repair.state='awaiting_verification' THEN repair.verifier_person_id ELSE repair.handler_person_id END
  JOIN users account ON account.id=person.account_user_id AND account.is_active
  JOIN school_memberships membership ON membership.school_id=repair.school_id AND membership.user_id=account.id AND membership.is_active
  WHERE repair.school_id=tenant AND repair.id=repair_id AND campus_model_account_person_is_active(tenant,account.id,person.id,now()))
$$;
CREATE OR REPLACE FUNCTION facilities_receipt_participant_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE repair facilities_repairs;
BEGIN
 SELECT * INTO repair FROM facilities_repairs WHERE school_id=NEW.school_id AND id=NEW.repair_id;
 IF NEW.action='reported' AND(NEW.actor_person_id<>repair.recorder_person_id OR repair.reporter_person_id<>NEW.actor_person_id AND NOT facilities_actor_can_manage(NEW.school_id,NEW.actor_user_id))
  OR NEW.action IN('accepted','updated','completed') AND NEW.actor_person_id<>repair.handler_person_id
  OR NEW.action='verified' AND NEW.actor_person_id<>repair.verifier_person_id
  OR NEW.action='reopened' AND NEW.actor_person_id NOT IN(repair.reporter_person_id,repair.verifier_person_id)
  OR NEW.action='assigned' AND NOT facilities_actor_can_manage(NEW.school_id,NEW.actor_user_id)
  OR NEW.action='photo_added' AND NEW.actor_person_id NOT IN(repair.reporter_person_id,repair.recorder_person_id,repair.handler_person_id,repair.verifier_person_id)
 THEN RAISE EXCEPTION 'A repair operation needs its exact current participant authority.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
