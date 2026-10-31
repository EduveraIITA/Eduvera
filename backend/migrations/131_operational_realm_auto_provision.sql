-- Every institution is born inside one Live operational realm. This is a
-- platform identity invariant, not mutable school behaviour. Keeping it at the
-- database boundary prevents legacy/domain writers from creating a school that
-- later fails only when its first model-mediated command or observation runs.

CREATE FUNCTION provision_school_operational_realm()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE provisioned_realm_id uuid;
BEGIN
  INSERT INTO operational_realms(legacy_school_id,realm_kind,status)
  VALUES(NEW.id,'institution','active')
  ON CONFLICT(legacy_school_id) DO UPDATE SET
    updated_at=operational_realms.updated_at
  RETURNING id INTO provisioned_realm_id;

  INSERT INTO execution_environment_namespaces(
    namespace_id,realm_id,environment_kind,status
  ) VALUES(
    'live:'||NEW.id::text,provisioned_realm_id,'live','active'
  ) ON CONFLICT(namespace_id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER school_operational_realm_provision
  AFTER INSERT ON schools
  FOR EACH ROW EXECUTE FUNCTION provision_school_operational_realm();

-- Also repair institutions created after migration 124 by a legacy writer but
-- before this invariant was installed.
INSERT INTO operational_realms(legacy_school_id,realm_kind,status)
SELECT school.id,'institution','active'
FROM schools school
WHERE NOT EXISTS(
  SELECT 1 FROM operational_realms realm WHERE realm.legacy_school_id=school.id
)
ON CONFLICT(legacy_school_id) DO NOTHING;

INSERT INTO execution_environment_namespaces(namespace_id,realm_id,environment_kind,status)
SELECT 'live:'||realm.legacy_school_id::text,realm.id,'live','active'
FROM operational_realms realm
WHERE realm.legacy_school_id IS NOT NULL
  AND NOT EXISTS(
    SELECT 1 FROM execution_environment_namespaces namespace
    WHERE namespace.realm_id=realm.id AND namespace.environment_kind='live'
  )
ON CONFLICT(namespace_id) DO NOTHING;
