-- Reviewed, versioned presentation geometry. Campus topology remains the owner
-- of operational place identities; imagery and inferred geometry grant no access.
CREATE TABLE campus_visual_scenes (
 id uuid PRIMARY KEY, school_id uuid NOT NULL REFERENCES schools(id), campus_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0), draft_document jsonb, published_revision integer,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 UNIQUE(school_id,campus_id), UNIQUE(id,school_id,campus_id),
 FOREIGN KEY(campus_id,school_id) REFERENCES institution_campuses(id,school_id),
 CHECK(id=campus_id), CHECK(published_revision IS NULL OR published_revision>0 AND published_revision<=revision),
 CHECK(draft_document IS NULL OR jsonb_typeof(draft_document)='object' AND octet_length(draft_document::text)<=2097152),
 CHECK(draft_document IS NOT NULL OR published_revision IS NOT NULL)
);
CREATE TABLE campus_scene_images (
 id uuid PRIMARY KEY, school_id uuid NOT NULL REFERENCES schools(id), campus_id uuid NOT NULL,
 mime_type text NOT NULL CHECK(mime_type IN('image/png','image/jpeg','image/webp')), bytes bytea NOT NULL,
 byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 4194304), width integer NOT NULL CHECK(width BETWEEN 1 AND 30000), height integer NOT NULL CHECK(height BETWEEN 1 AND 30000),
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'), rights_confirmed boolean NOT NULL CHECK(rights_confirmed),
 command_id uuid NOT NULL REFERENCES campus_model_commands(id), actor_user_id uuid NOT NULL REFERENCES users(id), actor_person_id uuid NOT NULL, created_at timestamptz NOT NULL,
 UNIQUE(id,school_id,campus_id), UNIQUE(school_id,command_id),
 FOREIGN KEY(campus_id,school_id) REFERENCES institution_campuses(id,school_id), FOREIGN KEY(actor_person_id,school_id) REFERENCES school_people(id,school_id),
 CHECK(octet_length(bytes)=byte_size), CHECK(width::bigint*height<=100000000), CHECK(encode(sha256(bytes),'hex')=sha256)
);
CREATE TABLE campus_scene_revisions (
 id uuid PRIMARY KEY, school_id uuid NOT NULL REFERENCES schools(id), campus_id uuid NOT NULL, scene_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0), action text NOT NULL CHECK(action IN('draft_saved','published','reopened')),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=2097152), published_revision integer,
 command_id uuid NOT NULL REFERENCES campus_model_commands(id), actor_user_id uuid NOT NULL REFERENCES users(id), actor_person_id uuid NOT NULL, recorded_at timestamptz NOT NULL,
 UNIQUE(scene_id,school_id,revision), UNIQUE(school_id,command_id),
 FOREIGN KEY(scene_id,school_id,campus_id) REFERENCES campus_visual_scenes(id,school_id,campus_id), FOREIGN KEY(actor_person_id,school_id) REFERENCES school_people(id,school_id),
 CHECK(published_revision IS NULL OR published_revision>0 AND published_revision<=revision), CHECK(action<>'published' OR published_revision=revision)
);
ALTER TABLE campus_visual_scenes ADD FOREIGN KEY(id,school_id,published_revision) REFERENCES campus_scene_revisions(scene_id,school_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX campus_scene_revision_actor_account ON campus_scene_revisions(actor_user_id);
CREATE INDEX campus_scene_revision_actor ON campus_scene_revisions(school_id,actor_person_id,recorded_at);
CREATE INDEX campus_scene_revision_campus ON campus_scene_revisions(school_id,campus_id,revision);
CREATE INDEX campus_scene_revision_command ON campus_scene_revisions(command_id);
CREATE INDEX campus_scene_image_actor_account ON campus_scene_images(actor_user_id);
CREATE INDEX campus_scene_image_actor ON campus_scene_images(school_id,actor_person_id,created_at);
CREATE INDEX campus_scene_image_campus ON campus_scene_images(school_id,campus_id,created_at);
CREATE INDEX campus_scene_image_command ON campus_scene_images(command_id);

CREATE FUNCTION campus_scene_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Campus scene publication, draft history and source images are immutable.' USING ERRCODE='23514'; END $$;
CREATE TRIGGER campus_scene_revision_immutable BEFORE UPDATE OR DELETE ON campus_scene_revisions FOR EACH ROW EXECUTE FUNCTION campus_scene_immutable();
CREATE TRIGGER campus_scene_image_immutable BEFORE UPDATE OR DELETE ON campus_scene_images FOR EACH ROW EXECUTE FUNCTION campus_scene_immutable();
CREATE FUNCTION campus_scene_current_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Campus scenes retain their published history.' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.id,NEW.school_id,NEW.campus_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.school_id,OLD.campus_id,OLD.created_at)
  OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Campus scenes require their next exact revision.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER campus_scene_current BEFORE UPDATE OR DELETE ON campus_visual_scenes FOR EACH ROW EXECUTE FUNCTION campus_scene_current_guard();

CREATE FUNCTION campus_scene_links_valid(tenant uuid,campus uuid,document jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT jsonb_typeof(document->'elements')='array' AND jsonb_array_length(document->'elements')<=2000
 AND (document->'source'->>'image_asset_id' IS NULL OR EXISTS(SELECT 1 FROM campus_scene_images image WHERE image.school_id=tenant AND image.campus_id=campus AND image.id::text=document->'source'->>'image_asset_id'))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(document->'elements') element WHERE
  (element->>'space_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM campus_spaces space WHERE space.school_id=tenant AND space.campus_id=campus AND space.id::text=element->>'space_id'))
  OR(element->>'floor_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM campus_spaces floor WHERE floor.school_id=tenant AND floor.campus_id=campus AND floor.id::text=element->>'floor_id' AND floor.kind='floor')))
$$;
CREATE FUNCTION campus_scene_native_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE source uuid;rev integer;action_name text;at timestamptz;content_hash text;previous campus_scene_revisions;
BEGIN
 IF TG_TABLE_NAME='campus_scene_images' THEN source:=NEW.id;rev:=1;action_name:='image_uploaded';at:=NEW.created_at;content_hash:=NEW.sha256;
 ELSE source:=NEW.scene_id;rev:=NEW.revision;action_name:=NEW.action;at:=NEW.recorded_at;content_hash:=encode(sha256(convert_to(NEW.document::text,'UTF8')),'hex');END IF;
 IF NOT EXISTS(SELECT 1 FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
  JOIN campus_model_events event ON event.source_outbox_event_id=outcome.domain_event_id AND event.school_id=command.school_id
  JOIN campus_model_agents actor ON actor.id=command.actor_agent_id AND actor.school_id=command.school_id AND actor.person_id=NEW.actor_person_id
  JOIN campus_model_entities target ON target.id=command.target_entity_id AND target.school_id=command.school_id AND target.domain='campus_scenes' AND target.domain_id=source::text
  WHERE command.id=NEW.command_id AND command.school_id=NEW.school_id AND command.source_domain='campus_scenes' AND command.handler_key='campus_scenes.commands' AND command.handler_version=1
   AND command.command_type='campus_scenes.'||action_name AND command.state='accepted' AND command.expected_revision=rev-1 AND outcome.resulting_revision=rev
   AND command.safe_context->>'source_id'=source::text AND command.safe_context->>'campus_id'=NEW.campus_id::text AND command.safe_context->>'content_hash'=content_hash
   AND event.source_domain='campus_scenes' AND event.source_record_id=source::text AND event.source_revision=rev AND event.event_type='campus_scenes.'||action_name
   AND event.actor_agent_id=command.actor_agent_id AND event.realm_id=command.realm_id AND event.environment_namespace_id=command.environment_namespace_id
   AND command.environment_namespace_id=coalesce(nullif(current_setting('thatcampus.namespace_id',true),''),CASE WHEN current_schema()='public' THEN 'live:'||NEW.school_id::text END))
 THEN RAISE EXCEPTION 'Campus scene evidence requires its exact accepted DT command and event.' USING ERRCODE='23514';END IF;
 IF NOT campus_model_account_person_is_active(NEW.school_id,NEW.actor_user_id,NEW.actor_person_id,at)
  OR NOT EXISTS(SELECT 1 FROM school_memberships WHERE school_id=NEW.school_id AND user_id=NEW.actor_user_id AND role='admin' AND is_active)
 THEN RAISE EXCEPTION 'Campus scene changes require a current canonical administrator.' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='campus_scene_revisions' THEN
  IF NEW.revision=1 THEN
   IF NEW.action<>'draft_saved' OR NEW.published_revision IS NOT NULL THEN RAISE EXCEPTION 'A campus scene starts as its first draft.' USING ERRCODE='23514';END IF;
  ELSE
   SELECT * INTO previous FROM campus_scene_revisions WHERE school_id=NEW.school_id AND scene_id=NEW.scene_id AND revision=NEW.revision-1;
   IF previous.id IS NULL
    OR NEW.action='draft_saved' AND(previous.action='published' OR NEW.published_revision IS DISTINCT FROM previous.published_revision)
    OR NEW.action='published' AND(previous.action='published' OR NEW.document<>previous.document)
    OR NEW.action='reopened' AND(previous.action<>'published' OR NEW.document<>previous.document OR NEW.published_revision IS DISTINCT FROM previous.published_revision)
   THEN RAISE EXCEPTION 'Campus scene history requires a valid draft, publication or reopen transition.' USING ERRCODE='23514';END IF;
  END IF;
  IF NOT coalesce(campus_scene_links_valid(NEW.school_id,NEW.campus_id,NEW.document),false) THEN RAISE EXCEPTION 'Campus scene links must belong to its canonical campus.' USING ERRCODE='23514';END IF;
  IF NEW.action='published' AND(jsonb_array_length(NEW.document->'elements')=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.document->'elements') element WHERE element->>'review_state' IS DISTINCT FROM 'reviewed'))
  THEN RAISE EXCEPTION 'Publishing requires a nonempty reviewed campus scene.' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER campus_scene_revision_command AFTER INSERT ON campus_scene_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION campus_scene_native_guard();
CREATE CONSTRAINT TRIGGER campus_scene_image_command AFTER INSERT ON campus_scene_images DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION campus_scene_native_guard();
CREATE FUNCTION campus_scene_revision_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM campus_scene_revisions receipt WHERE receipt.scene_id=NEW.id AND receipt.school_id=NEW.school_id AND receipt.campus_id=NEW.campus_id AND receipt.revision=NEW.revision
  AND receipt.recorded_at=NEW.updated_at AND receipt.published_revision IS NOT DISTINCT FROM NEW.published_revision
  AND(CASE WHEN receipt.action='published' THEN NEW.draft_document IS NULL ELSE NEW.draft_document=receipt.document END))
 THEN RAISE EXCEPTION 'Every campus scene revision needs its immutable source receipt.' USING ERRCODE='23514';END IF;
 IF NEW.published_revision IS NOT NULL AND NOT EXISTS(SELECT 1 FROM campus_scene_revisions publication WHERE publication.scene_id=NEW.id AND publication.school_id=NEW.school_id AND publication.revision=NEW.published_revision AND publication.action='published')
 THEN RAISE EXCEPTION 'A campus publication must reference an immutable published revision.' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER campus_scene_revision_evidence AFTER INSERT OR UPDATE ON campus_visual_scenes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION campus_scene_revision_guard();

CREATE FUNCTION campus_scene_event_source_valid(tenant uuid,event_name text,aggregate_kind text,aggregate uuid,envelope jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT jsonb_typeof(envelope)='object' AND EXISTS(SELECT 1 FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
 JOIN campus_model_events event ON event.source_outbox_event_id=outcome.domain_event_id AND event.school_id=command.school_id AND event.source_domain='campus_scenes'
 JOIN campus_model_entities target ON target.id=command.target_entity_id AND target.school_id=command.school_id
 WHERE command.school_id=tenant AND command.id::text=envelope->>'source_command_id' AND command.source_domain='campus_scenes' AND command.handler_key='campus_scenes.commands' AND command.handler_version=1
 AND command.state='accepted' AND command.safe_context->>'source_id'=aggregate::text AND command.safe_context->>'campus_id'=envelope->>'campus_id'
 AND command.expected_revision=outcome.resulting_revision-1 AND outcome.resulting_revision::text=envelope->>'revision'
 AND event.event_type='campus_scenes.'||(envelope->>'action') AND event.source_record_id=aggregate::text AND event.source_revision=outcome.resulting_revision
 AND event.actor_agent_id=command.actor_agent_id AND event.environment_namespace_id=command.environment_namespace_id AND event.realm_id=command.realm_id
 AND command.environment_namespace_id=coalesce(nullif(current_setting('thatcampus.namespace_id',true),''),CASE WHEN current_schema()='public' THEN 'live:'||tenant::text END)
 AND (aggregate_kind=target.kind AND event_name='campus_scenes.updated' OR aggregate_kind=target.kind||'_event' AND event_name=command.command_type) AND target.domain='campus_scenes' AND target.domain_id=aggregate::text
 AND command.command_type='campus_scenes.'||(envelope->>'action')
 AND envelope=jsonb_build_object('scene_id',aggregate::text,'campus_id',command.safe_context->>'campus_id','revision',outcome.resulting_revision,'action',envelope->>'action','source_command_id',command.id::text,'refresh',jsonb_build_array('campus-scenes')))
$$;
CREATE FUNCTION campus_scene_clock() RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE at timestamptz;BEGIN
 IF current_schema()<>'public' THEN EXECUTE 'SELECT simulation_now()' INTO at;RETURN at;END IF;
 RETURN now();
END $$;
CREATE FUNCTION campus_scene_event_recipient_valid(tenant uuid,event_name text,envelope jsonb,actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT event_name='campus_scenes.updated' AND envelope->>'action' IN('draft_saved','published','reopened','image_uploaded')
 AND EXISTS(SELECT 1 FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active WHERE membership.school_id=tenant AND membership.user_id=actor AND membership.is_active AND(envelope->>'action'='published' OR membership.role='admin'))
 AND EXISTS(SELECT 1 FROM campus_model_agents agent JOIN campus_model_agent_endpoints endpoint ON endpoint.agent_id=agent.id AND endpoint.school_id=agent.school_id AND endpoint.endpoint_kind='account' WHERE agent.school_id=tenant AND endpoint.user_id=actor AND campus_model_account_person_is_active(tenant,actor,agent.person_id,campus_scene_clock()))
$$;
DO $$ DECLARE body text;BEGIN
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='event_user_is_authorized(uuid,text,jsonb,uuid)'::regprocedure;body:=regexp_replace(btrim(body),';\s*$','');
 EXECUTE format($definition$CREATE OR REPLACE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $campus_scene_recipient_240$ SELECT CASE WHEN event_name LIKE 'campus_scenes.%%' THEN campus_scene_event_recipient_valid(event_school_id,event_name,event_payload,candidate_user_id) ELSE (%s) END $campus_scene_recipient_240$ $definition$,body);
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='event_source_is_valid(uuid,text,text,uuid,jsonb)'::regprocedure;body:=regexp_replace(btrim(body),';\s*$','');
 EXECUTE format($definition$CREATE OR REPLACE FUNCTION event_source_is_valid(institution uuid,event_name text,aggregate_kind text,aggregate uuid,event_payload jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $campus_scene_source_240$ SELECT CASE WHEN event_name='campus_scenes.updated' OR aggregate_kind IN('campus_scene','campus_scene_image') THEN campus_scene_event_source_valid(institution,event_name,aggregate_kind,aggregate,event_payload) ELSE (%s) END $campus_scene_source_240$ $definition$,body);
END $$;
CREATE FUNCTION campus_scene_event_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND(OLD.event_type LIKE 'campus_scenes.%' OR NEW.event_type LIKE 'campus_scenes.%') THEN
  IF ROW(NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload,NEW.audience_user_ids,NEW.notification_user_ids,NEW.notification_payload,NEW.idempotency_key,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.school_id,OLD.event_type,OLD.aggregate_type,OLD.aggregate_id,OLD.payload,OLD.audience_user_ids,OLD.notification_user_ids,OLD.notification_payload,OLD.idempotency_key,OLD.created_at)
  THEN RAISE EXCEPTION 'Campus scene event envelopes retain their source evidence.' USING ERRCODE='23514';END IF;RETURN NEW;
 END IF;
 IF NEW.event_type LIKE 'campus_scenes.%' AND(cardinality(NEW.notification_user_ids)>0 OR NEW.notification_payload IS NOT NULL
  OR NOT coalesce(campus_scene_event_source_valid(NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload),false)
  OR EXISTS(SELECT 1 FROM unnest(NEW.audience_user_ids) actor WHERE NOT campus_scene_event_recipient_valid(NEW.school_id,NEW.event_type,NEW.payload,actor)))
 THEN RAISE EXCEPTION 'Campus scene updates need exact accepted source evidence and current members.' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER campus_scene_event_source_guard AFTER INSERT OR UPDATE ON event_outbox DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION campus_scene_event_guard();
DO $$ DECLARE owner_name text;relation text;signature text;BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='school_people'::regclass;
 FOREACH relation IN ARRAY ARRAY['campus_visual_scenes','campus_scene_revisions','campus_scene_images'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',relation);EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',relation);EXECUTE format('ALTER TABLE %I OWNER TO %I',relation,owner_name);
 END LOOP;
 FOREACH signature IN ARRAY ARRAY['campus_scene_immutable()','campus_scene_current_guard()','campus_scene_links_valid(uuid,uuid,jsonb)','campus_scene_native_guard()','campus_scene_revision_guard()','campus_scene_event_source_valid(uuid,text,text,uuid,jsonb)','campus_scene_clock()','campus_scene_event_recipient_valid(uuid,text,jsonb,uuid)','campus_scene_event_guard()'] LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO %I',signature,owner_name);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
 END LOOP;
END $$;
COMMENT ON TABLE campus_visual_scenes IS 'Campus-owned presentation geometry, independently versioned from canonical places. AI and manual drafts require administrator review before member publication.';
COMMENT ON TABLE campus_scene_images IS 'Private immutable raster provenance, bounded to 4 MiB and copied within the selected world; never returned by the member scene API.';

-- Discoverable reviewed contracts. These catalogue pins do not grant an
-- administrator role, activate software behavior or certify aerial accuracy.
INSERT INTO model_semantic_type_definitions(namespace,type_key,definition_kind,version,owning_domain,status,definition,content_hash,approved_by_authority,activated_at)
SELECT 'thatcampus.campus_scenes',type_key,'entity',1,'campus_scenes','active',definition,
 encode(sha256(convert_to(definition::text,'UTF8')),'hex'),'platform-architecture',now()
FROM (VALUES
 ('campus_scene','{"privacy_class":"operational","identity_owner":"campus_scenes","canonical_place_owner":"campus_topology","publication":"administrator_reviewed","physical_claim":"presentation_only"}'::jsonb),
 ('campus_scene_image','{"privacy_class":"private_administrator_source","max_bytes":4194304,"content_types":["image/png","image/jpeg","image/webp"],"rights_attestation":true,"simulation":"captured_run_local_bytes"}'::jsonb)
) definitions(type_key,definition) ON CONFLICT(namespace,type_key,definition_kind,version) DO NOTHING;
INSERT INTO model_protocol_schema_definitions(namespace,schema_key,protocol_kind,version,owning_domain,status,schema_document,content_hash,approved_by_authority,activated_at)
SELECT 'thatcampus.campus_scenes','campus_scenes.'||protocol_kind||'.'||action,protocol_kind,1,'campus_scenes','active',definition,
 encode(sha256(convert_to(definition::text,'UTF8')),'hex'),'platform-architecture',now()
FROM (SELECT action,protocol_kind,jsonb_build_object('action',action,'handler_key','campus_scenes.commands','handler_version',1,
 'domain_contract','SceneDocument@1','event_type','campus_scenes.'||action,'authority','current_canonical_institution_administrator',
 'revision','exact_expected_revision','idempotency','actor_world_payload_bound','native_content','sha256_bound','payload_class',
 CASE WHEN protocol_kind='event' THEN 'minimal_ids_and_refresh_no_document_or_image' ELSE 'bounded_typed_scene_or_raster' END) AS definition
 FROM unnest(ARRAY['draft_saved','published','reopened','image_uploaded']) action CROSS JOIN unnest(ARRAY['command','event']) protocol_kind
) definitions ON CONFLICT(namespace,schema_key,protocol_kind,version) DO NOTHING;
INSERT INTO model_protocol_schema_definitions(namespace,schema_key,protocol_kind,version,owning_domain,status,schema_document,content_hash,approved_by_authority,activated_at)
SELECT 'thatcampus.campus_scenes','campus_scenes.event.updated','event',1,'campus_scenes','active',definition,
 encode(sha256(convert_to(definition::text,'UTF8')),'hex'),'platform-architecture',now()
FROM (SELECT '{"event_type":"campus_scenes.updated","source":"exact_accepted_campus_scene_command","payload_fields":["scene_id","campus_id","revision","action","source_command_id","refresh"],"private_content":false,"audience":"current_canonical_members_for_publication_otherwise_administrators"}'::jsonb AS definition) definition
ON CONFLICT(namespace,schema_key,protocol_kind,version) DO NOTHING;
INSERT INTO model_capability_manifests(namespace,capability_key,version,status,adapter_key,compatible_core_range,manifest,content_hash,approved_by_authority,activated_at)
SELECT 'thatcampus.campus_scenes','campus_visualization',1,'active','campus_scenes.commands','>=1 <2',manifest,
 encode(sha256(convert_to(manifest::text,'UTF8')),'hex'),'platform-architecture',now()
FROM (SELECT '{"schema_version":1,"tables":["campus_visual_scenes","campus_scene_revisions","campus_scene_images"],"read":"current_member_published_physical_scene","write":"current_administrator","correction":"reopen_then_publish_next_immutable_revision","simulation":"same_service_captured_geometry_and_run_local_image_bytes","operational_data":"not_projected","source_metadata":"private"}'::jsonb AS manifest) definition
ON CONFLICT(namespace,capability_key,version) DO NOTHING;
INSERT INTO realm_model_contract_activations(realm_id,contract_kind,contract_key,contract_id,contract_version,status,activated_by_authority)
SELECT realm.id,definition.kind,definition.contract_key,definition.id,1,'active','platform-migration-240'
FROM operational_realms realm CROSS JOIN (
 SELECT 'semantic_type' AS kind,namespace||'/'||type_key AS contract_key,id FROM model_semantic_type_definitions WHERE namespace='thatcampus.campus_scenes' AND version=1
 UNION ALL SELECT 'protocol_schema',namespace||'/'||schema_key,id FROM model_protocol_schema_definitions WHERE namespace='thatcampus.campus_scenes' AND version=1
 UNION ALL SELECT 'capability_manifest',namespace||'/'||capability_key,id FROM model_capability_manifests WHERE namespace='thatcampus.campus_scenes' AND version=1
) definition WHERE realm.status IN('setup','active') ON CONFLICT DO NOTHING;
