-- Institute work types may rename and describe a supported workflow, but may
-- never invent a capability package or scope. Enforce that boundary even when
-- data is written outside the application service.

CREATE OR REPLACE FUNCTION validate_staff_work_type_origin()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE
  base staff_responsibility_types%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND (
    NEW.source_kind IS DISTINCT FROM OLD.source_kind
    OR NEW.cloned_from_type_id IS DISTINCT FROM OLD.cloned_from_type_id
  ) THEN
    RAISE EXCEPTION 'Work type origin is immutable; create a new work type'
      USING ERRCODE='23514';
  END IF;

  IF NEW.source_kind='system' THEN
    IF NEW.cloned_from_type_id IS NOT NULL THEN
      RAISE EXCEPTION 'Built-in work types cannot have a clone origin'
        USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.cloned_from_type_id IS NULL THEN
    RAISE EXCEPTION 'Institute work types must use a supported workflow'
      USING ERRCODE='23514';
  END IF;

  SELECT * INTO base
  FROM staff_responsibility_types
  WHERE id=NEW.cloned_from_type_id
    AND school_id=NEW.school_id
    AND source_kind='system';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Institute work type origin must be a built-in workflow from the same institution'
      USING ERRCODE='23514';
  END IF;

  IF NEW.workflow_family IS DISTINCT FROM base.workflow_family
     OR NEW.category IS DISTINCT FROM base.category
     OR NEW.scope_kind IS DISTINCT FROM base.scope_kind
     OR NEW.capability_permissions IS DISTINCT FROM base.capability_permissions
     OR NEW.access_summary IS DISTINCT FROM base.access_summary
     OR NEW.restricted IS DISTINCT FROM base.restricted THEN
    RAISE EXCEPTION 'Institute work type access policy must match its supported workflow'
      USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER staff_work_type_origin_guard
  BEFORE INSERT OR UPDATE ON staff_responsibility_types
  FOR EACH ROW EXECUTE FUNCTION validate_staff_work_type_origin();
REVOKE ALL ON FUNCTION validate_staff_work_type_origin() FROM PUBLIC;

DO $$
DECLARE runtime_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO runtime_owner
  FROM pg_class WHERE oid='staff_responsibility_types'::regclass;
  EXECUTE format('ALTER FUNCTION validate_staff_work_type_origin() OWNER TO %I',runtime_owner);
END $$;
