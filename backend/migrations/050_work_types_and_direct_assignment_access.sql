-- Replace the role-eligibility layer with institute work types and direct,
-- scoped assignment access. A position remains descriptive; access exists only
-- while a concrete assignment (or an explicitly reviewed exception) is active.

ALTER TABLE staff_responsibility_types
  ADD COLUMN workflow_family varchar(48),
  ADD COLUMN source_kind varchar(16) NOT NULL DEFAULT 'system'
    CHECK (source_kind IN ('system','institute')),
  ADD COLUMN cloned_from_type_id uuid REFERENCES staff_responsibility_types(id) ON DELETE SET NULL,
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN updated_by uuid REFERENCES users(id),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE staff_responsibility_types SET workflow_family=code WHERE workflow_family IS NULL;
ALTER TABLE staff_responsibility_types
  ALTER COLUMN workflow_family SET NOT NULL,
  ADD CONSTRAINT staff_work_type_family_format
    CHECK (workflow_family ~ '^[a-z][a-z0-9_]{1,47}$'),
  ADD CONSTRAINT staff_work_type_clone_origin
    CHECK ((source_kind='system' AND cloned_from_type_id IS NULL) OR source_kind='institute');

CREATE INDEX staff_work_type_catalog
  ON staff_responsibility_types(school_id,is_active,category,name);
CREATE INDEX staff_work_type_family
  ON staff_responsibility_types(school_id,workflow_family);

CREATE OR REPLACE FUNCTION prepare_staff_work_type()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF NEW.workflow_family IS NULL OR NEW.workflow_family='' THEN
    NEW.workflow_family := NEW.code;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.workflow_family IS DISTINCT FROM OLD.workflow_family
       OR NEW.capability_permissions IS DISTINCT FROM OLD.capability_permissions
       OR NEW.scope_kind IS DISTINCT FROM OLD.scope_kind
       OR NEW.category IS DISTINCT FROM OLD.category
       OR NEW.restricted IS DISTINCT FROM OLD.restricted THEN
      RAISE EXCEPTION 'Work type workflow and access policy are immutable; create a new type from a supported workflow'
        USING ERRCODE='23514';
    END IF;
    NEW.revision := OLD.revision + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER staff_work_type_guard
  BEFORE INSERT OR UPDATE ON staff_responsibility_types
  FOR EACH ROW EXECUTE FUNCTION prepare_staff_work_type();
REVOKE ALL ON FUNCTION prepare_staff_work_type() FROM PUBLIC;

-- Realtime finance visibility must use the same access rule as command guards:
-- the active assignment activates the work type's capabilities directly.
CREATE OR REPLACE FUNCTION event_user_is_authorized(
  event_school_id uuid,
  event_name text,
  event_payload jsonb,
  candidate_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public
AS $$
  SELECT CASE WHEN (
    event_name='fees.updated'
    OR (
      event_name='campus_event.updated'
      AND event_payload->>'change_kind' IN ('participant_withdrawn','refund_recorded')
      AND EXISTS (
        SELECT 1 FROM campus_events event
        WHERE event.school_id=event_school_id AND event.id::text=event_payload->>'event_id'
      )
    )
  ) AND EXISTS (
    SELECT 1
    FROM school_memberships membership
    JOIN users account ON account.id=membership.user_id AND account.is_active
    WHERE membership.school_id=event_school_id
      AND membership.user_id=candidate_user_id
      AND membership.role='staff' AND membership.is_active
      AND (
        EXISTS (
          SELECT 1 FROM school_access_exceptions exception
          WHERE exception.school_id=membership.school_id
            AND exception.user_id=membership.user_id
            AND exception.permission='fees.manage' AND exception.status='active'
            AND current_date BETWEEN exception.valid_from AND exception.valid_until
        )
        OR EXISTS (
          SELECT 1
          FROM staff_responsibility_assignments assignment
          JOIN staff_profiles staff_profile ON staff_profile.id=assignment.staff_profile_id
            AND staff_profile.user_id=membership.user_id
          JOIN staff_responsibility_types work_type
            ON work_type.school_id=assignment.school_id
            AND work_type.id=assignment.responsibility_type_id
            AND work_type.is_active
          WHERE assignment.school_id=membership.school_id
            AND assignment.status='active'
            AND assignment.starts_on<=current_date
            AND (assignment.ends_on IS NULL OR assignment.ends_on>=current_date)
            AND 'fees.manage'=ANY(work_type.capability_permissions)
        )
      )
  ) THEN true ELSE event_user_is_authorized_before_work_profiles(
    event_school_id,event_name,event_payload,candidate_user_id
  ) END
$$;
REVOKE ALL ON FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) FROM PUBLIC;

DO $$
DECLARE runtime_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO runtime_owner
  FROM pg_class WHERE oid='staff_responsibility_types'::regclass;
  EXECUTE format('ALTER FUNCTION prepare_staff_work_type() OWNER TO %I',runtime_owner);
  EXECUTE format('ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO %I',runtime_owner);
END $$;
