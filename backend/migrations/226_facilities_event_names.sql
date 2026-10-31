-- Native progress `updated` is not the public refresh `facilities.updated`.
-- Keep one distinct reviewed internal source-event namespace, no runtime alias.
DO $$ DECLARE signature text;definition text;replacement text;BEGIN
 FOREACH signature IN ARRAY ARRAY['facilities_event_source_valid(uuid,text,text,uuid,jsonb)','facilities_receipt_command_guard()'] LOOP
  SELECT pg_get_functiondef(signature::regprocedure) INTO STRICT definition;
  replacement:=replace(definition,'event_name=''facilities.''||receipt.action','event_name=''facilities.repair.''||receipt.action');
  replacement:=replace(replacement,'event.event_type=''facilities.''||receipt.action','event.event_type=''facilities.repair.''||receipt.action');
  replacement:=replace(replacement,'''facilities.''||NEW.action','''facilities.repair.''||NEW.action');
  IF replacement=definition THEN RAISE EXCEPTION 'Unreviewed Facilities event naming body: %',signature;END IF;
  EXECUTE replacement;
 END LOOP;
END $$;
