-- A departed reporter/handler must not make retained evidence unmaintainable.
-- Current active recipients remain checked; revocation never grants access.
CREATE OR REPLACE FUNCTION validate_restricted_care_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE subject_user uuid; require_active boolean := true; student_school uuid;
BEGIN
  IF TG_OP='UPDATE' AND NEW.school_id IS DISTINCT FROM OLD.school_id THEN
    RAISE EXCEPTION 'Restricted care institution cannot be changed' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Restricted care record identity cannot be changed' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='restricted_care_cases' THEN
    IF TG_OP='UPDATE' AND NEW.reported_by IS DISTINCT FROM OLD.reported_by THEN
      RAISE EXCEPTION 'Restricted care original reporter cannot be changed' USING ERRCODE='23514';
    END IF;
    subject_user := NEW.reported_by;
    IF TG_OP='UPDATE' THEN require_active := NEW.reported_by IS DISTINCT FROM OLD.reported_by; END IF;
    IF NEW.student_id IS NOT NULL THEN
      SELECT school_id INTO student_school FROM students WHERE id=NEW.student_id;
      IF student_school IS DISTINCT FROM NEW.school_id THEN
        RAISE EXCEPTION 'Restricted care student must belong to the same institution' USING ERRCODE='23514';
      END IF;
    END IF;
    IF TG_OP='INSERT' OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
      IF NOT EXISTS (SELECT 1 FROM school_memberships member JOIN users account ON account.id=member.user_id
        WHERE member.school_id=NEW.school_id AND member.user_id=NEW.owner_user_id
          AND member.role IN ('admin','staff') AND member.is_active AND account.is_active) THEN
        RAISE EXCEPTION 'A new care owner requires an active staff membership' USING ERRCODE='23514';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME='restricted_care_case_assignments' THEN
    IF TG_OP='UPDATE' AND (NEW.case_id IS DISTINCT FROM OLD.case_id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
      RAISE EXCEPTION 'Restricted care assignment subject cannot be changed' USING ERRCODE='23514';
    END IF;
    subject_user := NEW.user_id;
    require_active := NEW.revoked_at IS NULL;
  ELSE
    IF TG_OP='UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Restricted care role subject cannot be changed' USING ERRCODE='23514';
    END IF;
    subject_user := NEW.user_id;
    require_active := NEW.status='active';
  END IF;
  IF require_active AND NOT EXISTS (SELECT 1 FROM school_memberships member JOIN users account ON account.id=member.user_id
    WHERE member.school_id=NEW.school_id AND member.user_id=subject_user
      AND member.role IN ('admin','staff') AND member.is_active AND account.is_active) THEN
    RAISE EXCEPTION 'Restricted care access requires an active staff membership' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION validate_restricted_care_scope() FROM PUBLIC;
