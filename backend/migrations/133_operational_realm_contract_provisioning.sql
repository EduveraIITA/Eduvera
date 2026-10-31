-- Complete the structural provisioning invariant introduced in migration 131.
-- Contract pins select reviewed platform schemas for the realm; they do not
-- enable an operating rule, subscription, reaction, recipient or automation.

CREATE OR REPLACE FUNCTION provision_school_operational_realm()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE provisioned_realm_id uuid;
DECLARE provisioned_namespace_id text;
BEGIN
  provisioned_namespace_id := 'live:'||NEW.id::text;
  INSERT INTO operational_realms(legacy_school_id,realm_kind,status)
  VALUES(NEW.id,'institution','active')
  ON CONFLICT(legacy_school_id) DO UPDATE SET
    updated_at=operational_realms.updated_at
  RETURNING id INTO provisioned_realm_id;

  INSERT INTO execution_environment_namespaces(
    namespace_id,realm_id,environment_kind,status
  ) VALUES(
    provisioned_namespace_id,provisioned_realm_id,'live','active'
  ) ON CONFLICT(namespace_id) DO NOTHING;

  INSERT INTO realm_model_contract_activations(
    realm_id,contract_kind,contract_key,contract_id,contract_version,status,
    activated_by_authority
  )
  SELECT provisioned_realm_id,'semantic_type',definition.namespace||'/'||definition.type_key,
    definition.id,definition.version,'active','platform-provisioning'
  FROM (
    SELECT DISTINCT ON (namespace,type_key) * FROM model_semantic_type_definitions
    WHERE status='active' ORDER BY namespace,type_key,version DESC
  ) definition
  ON CONFLICT DO NOTHING;

  INSERT INTO realm_model_contract_activations(
    realm_id,contract_kind,contract_key,contract_id,contract_version,status,
    activated_by_authority
  )
  SELECT provisioned_realm_id,'protocol_schema',definition.namespace||'/'||definition.schema_key,
    definition.id,definition.version,'active','platform-provisioning'
  FROM (
    SELECT DISTINCT ON (namespace,schema_key) * FROM model_protocol_schema_definitions
    WHERE status='active' ORDER BY namespace,schema_key,version DESC
  ) definition
  ON CONFLICT DO NOTHING;

  INSERT INTO realm_model_contract_activations(
    realm_id,contract_kind,contract_key,contract_id,contract_version,status,
    activated_by_authority
  )
  SELECT provisioned_realm_id,'capability_manifest',manifest.namespace||'/'||manifest.capability_key,
    manifest.id,manifest.version,'active','platform-provisioning'
  FROM (
    SELECT DISTINCT ON (namespace,capability_key) * FROM model_capability_manifests
    WHERE status='active' ORDER BY namespace,capability_key,version DESC
  ) manifest
  ON CONFLICT DO NOTHING;

  INSERT INTO campus_model_entities(
    school_id,realm_id,environment_namespace_id,kind,domain,domain_id,label,
    lifecycle_state,source_revision,metadata
  ) VALUES(
    NEW.id,provisioned_realm_id,provisioned_namespace_id,'institution','institutions',
    NEW.id::text,NEW.name,'active',1,'{}'::jsonb
  ) ON CONFLICT(realm_id,environment_namespace_id,domain,domain_id) DO NOTHING;

  RETURN NEW;
END $$;

-- Repair realms provisioned between migrations 131 and 133, including any
-- institution created by a legacy writer during deployment.
INSERT INTO realm_model_contract_activations(
  realm_id,contract_kind,contract_key,contract_id,contract_version,status,
  activated_by_authority
)
SELECT realm.id,'semantic_type',definition.namespace||'/'||definition.type_key,
  definition.id,definition.version,'active','platform-provisioning-backfill'
FROM operational_realms realm CROSS JOIN (
  SELECT DISTINCT ON (namespace,type_key) * FROM model_semantic_type_definitions
  WHERE status='active' ORDER BY namespace,type_key,version DESC
) definition
WHERE realm.status IN ('setup','active')
  AND NOT EXISTS(SELECT 1 FROM realm_model_contract_activations existing
    WHERE existing.realm_id=realm.id AND existing.contract_kind='semantic_type'
      AND existing.contract_key=definition.namespace||'/'||definition.type_key AND existing.status='active')
ON CONFLICT DO NOTHING;

INSERT INTO realm_model_contract_activations(
  realm_id,contract_kind,contract_key,contract_id,contract_version,status,
  activated_by_authority
)
SELECT realm.id,'protocol_schema',definition.namespace||'/'||definition.schema_key,
  definition.id,definition.version,'active','platform-provisioning-backfill'
FROM operational_realms realm CROSS JOIN (
  SELECT DISTINCT ON (namespace,schema_key) * FROM model_protocol_schema_definitions
  WHERE status='active' ORDER BY namespace,schema_key,version DESC
) definition
WHERE realm.status IN ('setup','active')
  AND NOT EXISTS(SELECT 1 FROM realm_model_contract_activations existing
    WHERE existing.realm_id=realm.id AND existing.contract_kind='protocol_schema'
      AND existing.contract_key=definition.namespace||'/'||definition.schema_key AND existing.status='active')
ON CONFLICT DO NOTHING;

INSERT INTO realm_model_contract_activations(
  realm_id,contract_kind,contract_key,contract_id,contract_version,status,
  activated_by_authority
)
SELECT realm.id,'capability_manifest',manifest.namespace||'/'||manifest.capability_key,
  manifest.id,manifest.version,'active','platform-provisioning-backfill'
FROM operational_realms realm CROSS JOIN (
  SELECT DISTINCT ON (namespace,capability_key) * FROM model_capability_manifests
  WHERE status='active' ORDER BY namespace,capability_key,version DESC
) manifest
WHERE realm.status IN ('setup','active')
  AND NOT EXISTS(SELECT 1 FROM realm_model_contract_activations existing
    WHERE existing.realm_id=realm.id AND existing.contract_kind='capability_manifest'
      AND existing.contract_key=manifest.namespace||'/'||manifest.capability_key AND existing.status='active')
ON CONFLICT DO NOTHING;

INSERT INTO campus_model_entities(
  school_id,realm_id,environment_namespace_id,kind,domain,domain_id,label,
  lifecycle_state,source_revision,metadata
)
SELECT school.id,realm.id,namespace.namespace_id,'institution','institutions',school.id::text,
  school.name,'active',1,'{}'::jsonb
FROM schools school
JOIN operational_realms realm ON realm.legacy_school_id=school.id
JOIN execution_environment_namespaces namespace
  ON namespace.realm_id=realm.id AND namespace.environment_kind='live'
WHERE NOT EXISTS(
  SELECT 1 FROM campus_model_entities entity
  WHERE entity.realm_id=realm.id AND entity.environment_namespace_id=namespace.namespace_id
    AND entity.domain='institutions' AND entity.domain_id=school.id::text
)
ON CONFLICT(realm_id,environment_namespace_id,domain,domain_id) DO NOTHING;
