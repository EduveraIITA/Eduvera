-- A legacy school owns its compatibility realm and the realm owns its
-- execution namespaces.  Empty/new institutions must therefore be removable
-- atomically; model records below a namespace continue to use RESTRICT and
-- must be retired or explicitly removed by their owning domain first.

ALTER TABLE execution_environment_namespaces
  DROP CONSTRAINT execution_environment_namespaces_realm_id_fkey,
  ADD CONSTRAINT execution_environment_namespaces_realm_id_fkey
    FOREIGN KEY(realm_id) REFERENCES operational_realms(id) ON DELETE CASCADE;

ALTER TABLE operational_realms
  DROP CONSTRAINT operational_realms_legacy_school_id_fkey,
  ADD CONSTRAINT operational_realms_legacy_school_id_fkey
    FOREIGN KEY(legacy_school_id) REFERENCES schools(id) ON DELETE CASCADE;
