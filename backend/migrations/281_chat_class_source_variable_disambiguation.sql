-- Role changes must reconcile class chat access without confusing the trigger's
-- source record with staff_role_bindings.source_id. Keep the existing trigger
-- function and every reconciliation branch; only the local identifier changes.
CREATE OR REPLACE FUNCTION chat_reconcile_class_source() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO public AS $$
DECLARE source jsonb; v_source_id uuid; tenant uuid; actor uuid; target_class uuid; pass integer;
BEGIN
  FOR pass IN 1..2 LOOP
    IF pass=1 AND TG_OP<>'INSERT' THEN source:=to_jsonb(OLD);
    ELSIF pass=2 AND TG_OP<>'DELETE' THEN source:=to_jsonb(NEW);
    ELSE CONTINUE; END IF;
    IF pass=2 AND TG_OP='UPDATE' AND source=to_jsonb(OLD) THEN CONTINUE; END IF;
    v_source_id:=(source->>'id')::uuid;
    tenant:=(source->>'school_id')::uuid;
    actor:=(source->>'user_id')::uuid;
    target_class:=(source->>'class_section_id')::uuid;
    CASE TG_TABLE_NAME
      WHEN 'enrollments' THEN
        SELECT learner.user_id INTO actor FROM students learner WHERE learner.id=(source->>'student_id')::uuid;
        IF actor IS NOT NULL THEN PERFORM chat_reconcile_class_group(target_class,actor,TG_OP<>'DELETE'); END IF;
      WHEN 'class_sections' THEN PERFORM chat_reconcile_class_group(v_source_id,NULL,TG_OP<>'DELETE');
      WHEN 'students' THEN
        IF actor IS NOT NULL THEN
          FOR target_class IN SELECT DISTINCT placement.class_section_id FROM enrollments placement WHERE placement.student_id=v_source_id ORDER BY 1 LOOP
            PERFORM chat_reconcile_class_group(target_class,actor,TG_OP<>'DELETE');
          END LOOP;
        END IF;
      WHEN 'users' THEN
        FOR tenant IN SELECT DISTINCT school_id FROM school_memberships WHERE user_id=v_source_id ORDER BY 1 LOOP
          PERFORM chat_reconcile_class_actor(tenant,v_source_id,TG_OP<>'DELETE');
        END LOOP;
      WHEN 'staff_profiles' THEN PERFORM chat_reconcile_class_actor(tenant,actor,TG_OP<>'DELETE');
      WHEN 'staff_responsibility_assignments' THEN
        SELECT profile.user_id INTO actor FROM staff_profiles profile WHERE profile.id=(source->>'staff_profile_id')::uuid;
        IF actor IS NOT NULL THEN
          IF target_class IS NOT NULL THEN PERFORM chat_reconcile_class_group(target_class,actor,TG_OP<>'DELETE');
          ELSE PERFORM chat_reconcile_class_actor(tenant,actor,TG_OP<>'DELETE'); END IF;
        END IF;
      WHEN 'staff_responsibility_types' THEN
        FOR actor IN SELECT DISTINCT binding.user_id FROM staff_role_bindings binding WHERE binding.school_id=tenant AND binding.role_id=v_source_id ORDER BY 1 LOOP
          PERFORM chat_reconcile_class_actor(tenant,actor,TG_OP<>'DELETE');
        END LOOP;
      WHEN 'schedule_periods' THEN
        SELECT version.class_section_id INTO target_class FROM schedule_versions version WHERE version.id=(source->>'version_id')::uuid;
        actor:=(source->>'teacher_user_id')::uuid;
        IF actor IS NOT NULL THEN PERFORM chat_reconcile_class_group(target_class,actor,TG_OP<>'DELETE'); END IF;
      WHEN 'day_plan_periods' THEN
        SELECT plan.class_section_id INTO target_class FROM day_plans plan WHERE plan.id=(source->>'plan_id')::uuid;
        SELECT teacher.user_id INTO actor FROM school_memberships teacher WHERE teacher.id=(source->>'teacher_membership_id')::uuid;
        IF actor IS NOT NULL THEN PERFORM chat_reconcile_class_group(target_class,actor,TG_OP<>'DELETE'); END IF;
      WHEN 'staff_timetable_substitutions' THEN
        PERFORM chat_reconcile_class_group(target_class,(source->>'original_teacher_user_id')::uuid,TG_OP<>'DELETE');
        PERFORM chat_reconcile_class_group(target_class,(source->>'replacement_teacher_user_id')::uuid,TG_OP<>'DELETE');
      WHEN 'timetable_slots' THEN
        actor:=(source->>'teacher_user_id')::uuid;
        IF actor IS NOT NULL THEN PERFORM chat_reconcile_class_group(target_class,actor,TG_OP<>'DELETE'); END IF;
      WHEN 'schedule_versions' THEN
        IF pass=2 AND source->>'state'='published' THEN PERFORM chat_reconcile_class_group(target_class); END IF;
      WHEN 'day_plans' THEN
        IF pass=2 AND (source->>'published_version' IS NOT NULL OR TG_OP='UPDATE' AND to_jsonb(OLD)->>'published_version' IS NOT NULL)
          THEN PERFORM chat_reconcile_class_group(target_class); END IF;
      WHEN 'class_section_staff_assignments' THEN PERFORM chat_reconcile_class_group(target_class,actor,TG_OP<>'DELETE');
      WHEN 'school_memberships' THEN PERFORM chat_reconcile_class_actor(tenant,actor,TG_OP<>'DELETE');
      ELSE RAISE EXCEPTION 'Unreviewed chat class source: %',TG_TABLE_NAME;
    END CASE;
  END LOOP;
  RETURN NULL;
END
$$;
