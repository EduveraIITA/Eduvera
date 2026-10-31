-- Explicit reported service effects on published individual campus assets.
-- Private repair descriptions, participants and photos remain in Facilities.
ALTER TABLE facilities_repairs ADD COLUMN asset_impact varchar(16)
 CHECK(asset_impact IN('not_working','degraded'));
ALTER TABLE facilities_repairs ADD CONSTRAINT facilities_asset_impact_exact_item
 CHECK(asset_impact IS NULL OR holding_id IS NOT NULL);
CREATE INDEX facilities_asset_signal_idx ON facilities_repairs(school_id,holding_id,state,updated_at DESC)
 WHERE asset_impact IS NOT NULL;
COMMENT ON COLUMN facilities_repairs.asset_impact IS 'Immutable explicit reporter declaration shared on a published campus asset. Not an independently observed diagnosis or a resource availability change.';

CREATE FUNCTION campus_asset_is_published(tenant uuid,campus uuid,holding uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM campus_resource_holdings item
 JOIN campus_resource_types type ON type.id=item.resource_type_id AND type.school_id=item.school_id
 JOIN institution_campuses place ON place.id=item.campus_id AND place.school_id=item.school_id
 JOIN campus_visual_scenes scene ON scene.school_id=item.school_id AND scene.campus_id=item.campus_id
 JOIN campus_scene_revisions publication ON publication.scene_id=scene.id AND publication.school_id=scene.school_id
  AND publication.revision=scene.published_revision AND publication.action='published'
 WHERE item.school_id=tenant AND item.campus_id=campus AND item.id=holding AND item.state<>'retired'
  AND type.tracking_mode='individual' AND type.is_active AND place.status='active'
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(publication.document->'elements') element
   WHERE element->>'kind'='fixture' AND element->>'holding_id'=item.id::text))
$$;
CREATE FUNCTION facilities_asset_report_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NEW.asset_impact IS NOT NULL AND NOT EXISTS(SELECT 1 FROM campus_resource_holdings item
  WHERE item.school_id=NEW.school_id AND item.id=NEW.holding_id
   AND campus_asset_is_published(NEW.school_id,item.campus_id,item.id))
 THEN RAISE EXCEPTION 'Shared asset status needs a current published individual campus item.' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER facilities_asset_report_scope BEFORE INSERT ON facilities_repairs FOR EACH ROW EXECUTE FUNCTION facilities_asset_report_guard();
-- Existing current-row guard already makes every non-state intake field immutable.

CREATE FUNCTION campus_asset_event_source_valid(tenant uuid,event_name text,aggregate_kind text,aggregate uuid,envelope jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT event_name='campus_assets.updated' AND aggregate_kind='campus_asset'
 AND jsonb_typeof(envelope)='object' AND envelope ?& ARRAY['campus_id','holding_id','revision','source_command_id','refresh']
 AND envelope-ARRAY['campus_id','holding_id','revision','source_command_id','refresh']='{}'::jsonb
 AND envelope->>'holding_id'=aggregate::text AND envelope->'refresh'='["campus-assets"]'::jsonb
 AND EXISTS(SELECT 1 FROM facilities_repair_receipts receipt
 JOIN facilities_repairs repair ON repair.id=receipt.repair_id AND repair.school_id=receipt.school_id
 JOIN campus_resource_holdings item ON item.id=repair.holding_id AND item.school_id=repair.school_id
 JOIN campus_model_commands command ON command.id=receipt.command_id AND command.school_id=receipt.school_id
 JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
 JOIN campus_model_events event ON event.source_outbox_event_id=outcome.domain_event_id AND event.school_id=command.school_id
 WHERE repair.school_id=tenant AND repair.holding_id=aggregate AND repair.asset_impact IS NOT NULL
  AND item.campus_id::text=envelope->>'campus_id' AND receipt.revision::text=envelope->>'revision'
  AND receipt.command_id::text=envelope->>'source_command_id' AND receipt.action<>'photo_added'
  AND command.source_domain='facilities' AND command.handler_key='facilities.commands' AND command.handler_version=1
  AND command.state='accepted' AND command.command_type='facilities.'||receipt.action
  AND command.expected_revision=receipt.revision-1 AND command.safe_context->>'repair_id'=repair.id::text
  AND outcome.resulting_revision=receipt.revision AND event.source_domain='facilities'
  AND event.source_record_id=repair.id::text AND event.source_revision=receipt.revision
  AND event.event_type=command.command_type AND event.actor_agent_id=command.actor_agent_id
  AND event.environment_namespace_id=command.environment_namespace_id AND event.realm_id=command.realm_id
  AND command.environment_namespace_id=coalesce(nullif(current_setting('thatcampus.namespace_id',true),''),CASE WHEN current_schema()='public' THEN 'live:'||tenant::text END)
  AND campus_asset_is_published(tenant,item.campus_id,item.id))
$$;
CREATE FUNCTION campus_asset_event_recipient_valid(tenant uuid,event_name text,envelope jsonb,actor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT event_name='campus_assets.updated' AND EXISTS(SELECT 1 FROM school_memberships membership
 JOIN users account ON account.id=membership.user_id AND account.is_active
 WHERE membership.school_id=tenant AND membership.user_id=actor AND membership.is_active)
 AND EXISTS(SELECT 1 FROM campus_model_agents agent
 JOIN campus_model_agent_endpoints endpoint ON endpoint.school_id=agent.school_id AND endpoint.agent_id=agent.id
  AND endpoint.endpoint_kind='account' AND endpoint.user_id=actor
 WHERE agent.school_id=tenant AND campus_model_account_person_is_active(tenant,actor,agent.person_id,campus_scene_clock()))
 AND EXISTS(SELECT 1 FROM institution_campuses campus WHERE campus.school_id=tenant AND campus.id::text=envelope->>'campus_id' AND campus.status='active')
$$;
DO $$ DECLARE body text;BEGIN
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='event_user_is_authorized(uuid,text,jsonb,uuid)'::regprocedure;
 body:=regexp_replace(btrim(body),';\s*$','');
 EXECUTE format($definition$CREATE OR REPLACE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $campus_asset_recipient_262$
 SELECT CASE WHEN event_name LIKE 'campus_assets.%%' THEN campus_asset_event_recipient_valid(event_school_id,event_name,event_payload,candidate_user_id) ELSE (%s) END
 $campus_asset_recipient_262$ $definition$,body);
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='event_source_is_valid(uuid,text,text,uuid,jsonb)'::regprocedure;
 body:=regexp_replace(btrim(body),';\s*$','');
 EXECUTE format($definition$CREATE OR REPLACE FUNCTION event_source_is_valid(institution uuid,event_name text,aggregate_kind text,aggregate uuid,event_payload jsonb)
 RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $campus_asset_source_262$
 SELECT CASE WHEN event_name LIKE 'campus_assets.%%' OR aggregate_kind='campus_asset' THEN campus_asset_event_source_valid(institution,event_name,aggregate_kind,aggregate,event_payload) ELSE (%s) END
 $campus_asset_source_262$ $definition$,body);
END $$;
CREATE FUNCTION campus_asset_event_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND(OLD.event_type LIKE 'campus_assets.%' OR NEW.event_type LIKE 'campus_assets.%') THEN
  IF ROW(NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload,NEW.audience_user_ids,NEW.notification_user_ids,NEW.notification_payload,NEW.idempotency_key,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.school_id,OLD.event_type,OLD.aggregate_type,OLD.aggregate_id,OLD.payload,OLD.audience_user_ids,OLD.notification_user_ids,OLD.notification_payload,OLD.idempotency_key,OLD.created_at)
  THEN RAISE EXCEPTION 'Campus asset refresh retains its exact accepted source.' USING ERRCODE='23514';END IF;RETURN NEW;
 END IF;
 IF NEW.event_type LIKE 'campus_assets.%' AND(cardinality(NEW.notification_user_ids)>0 OR NEW.notification_payload IS NOT NULL
  OR NOT coalesce(campus_asset_event_source_valid(NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload),false)
  OR EXISTS(SELECT 1 FROM unnest(NEW.audience_user_ids) actor WHERE NOT campus_asset_event_recipient_valid(NEW.school_id,NEW.event_type,NEW.payload,actor)))
 THEN RAISE EXCEPTION 'Campus asset refresh needs accepted repair evidence and current members.' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER campus_asset_event_scope AFTER INSERT OR UPDATE ON event_outbox DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION campus_asset_event_guard();
DO $$ DECLARE owner_name text;signature text;BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='school_people'::regclass;
 FOREACH signature IN ARRAY ARRAY['campus_asset_is_published(uuid,uuid,uuid)','facilities_asset_report_guard()',
  'campus_asset_event_source_valid(uuid,text,text,uuid,jsonb)','campus_asset_event_recipient_valid(uuid,text,jsonb,uuid)','campus_asset_event_guard()'] LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO %I',signature,owner_name);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
 END LOOP;
END $$;
INSERT INTO model_protocol_schema_definitions(namespace,schema_key,protocol_kind,version,owning_domain,status,schema_document,content_hash,approved_by_authority,activated_at)
SELECT 'thatcampus.facilities','campus_assets.event.updated','event',1,'facilities','active',definition,
 encode(sha256(convert_to(definition::text,'UTF8')),'hex'),'platform-architecture',now()
FROM (SELECT '{"event_type":"campus_assets.updated","source":"exact_accepted_facilities_repair_command","payload_fields":["campus_id","holding_id","revision","source_command_id","refresh"],"private_content":false,"audience":"current_canonical_campus_members","meaning":"refresh_reported_asset_status_not_verified_physical_presence"}'::jsonb AS definition) definition
ON CONFLICT(namespace,schema_key,protocol_kind,version) DO NOTHING;
