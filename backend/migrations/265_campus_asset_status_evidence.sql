-- Correct the unreleased asset refresh adapter's distinct command/event names.
-- Preserve the applied 262 checksum and exercise a normal forward upgrade.
DO $$ DECLARE body text;replacement text;BEGIN
 SELECT pg_get_functiondef('campus_asset_event_source_valid(uuid,text,text,uuid,jsonb)'::regprocedure) INTO STRICT body;
 replacement:=replace(body,'event.event_type=command.command_type','event.event_type=''facilities.repair.''||receipt.action');
 IF replacement=body THEN RAISE EXCEPTION 'Unreviewed campus asset source guard body';END IF;
 EXECUTE replacement;
END $$;
ALTER TABLE facilities_repair_receipts ADD COLUMN reopen_kind varchar(20)
 CHECK(reopen_kind IN('further_work','record_amendment'));
ALTER TABLE facilities_repair_receipts ADD CONSTRAINT facilities_reopen_kind_scope
 CHECK(action='reopened' OR reopen_kind IS NULL);
COMMENT ON COLUMN facilities_repair_receipts.reopen_kind IS 'Explicit purpose of reopening, retained immutably. Legacy null is unknown; a record amendment is not a claim that verified repair work failed.';
