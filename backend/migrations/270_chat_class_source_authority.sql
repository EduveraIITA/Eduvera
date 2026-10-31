-- Class conversations are derived from canonical class/enrollment/access facts,
-- not setup performed as a side effect of reading the message directory.
-- A source-derived thread has no invented human creator. Other conversations
-- still require the explicit actor recorded by their owning command.
ALTER TABLE chat_conversations ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE chat_conversations ADD CONSTRAINT chat_conversation_creator_source CHECK (
  created_by IS NOT NULL OR (
    kind='group' AND group_type IS NOT DISTINCT FROM 'student_group' AND class_section_id IS NOT NULL
    AND context_student_id IS NULL
  )
);

CREATE FUNCTION chat_actor_has_class_scope(tenant uuid,actor uuid,action text,target_class uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO public AS $$
  SELECT action=ANY(ARRAY['messages.view','messages.send']) AND EXISTS (
    SELECT 1 FROM class_sections classroom
    JOIN school_memberships membership ON membership.school_id=classroom.school_id
      AND membership.user_id=actor AND membership.is_active
    JOIN users account ON account.id=membership.user_id AND account.is_active
    WHERE classroom.school_id=tenant AND classroom.id=target_class AND (
      membership.role='admin'
      OR membership.role='staff' AND staff_has_class_permission(tenant,actor,action,target_class)
      OR membership.role='student' AND EXISTS (
        SELECT 1 FROM students learner JOIN enrollments placement ON placement.student_id=learner.id
        WHERE learner.school_id=tenant AND learner.user_id=actor
          AND placement.class_section_id=target_class AND placement.is_active
          AND placement.enrolled_on<=campus_permission_date(tenant)
          AND (placement.inactive_from IS NULL OR campus_permission_date(tenant)<placement.inactive_from)
      )
    )
  )
$$;

-- Keep the existing function OID: REST, attachment reads, notifications,
-- durable event replay and the Matrix bridge all call this same authority.
CREATE OR REPLACE FUNCTION chat_actor_is_current_participant(tenant uuid,actor uuid,action text,conversation uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO public AS $$
  SELECT action=ANY(ARRAY['messages.view','messages.send']) AND EXISTS (
    SELECT 1 FROM chat_conversations thread
    JOIN chat_participants participant ON participant.conversation_id=thread.id
      AND participant.user_id=actor AND participant.is_active
    JOIN school_memberships membership ON membership.school_id=thread.school_id
      AND membership.user_id=participant.user_id AND membership.is_active
    JOIN users account ON account.id=membership.user_id AND account.is_active
    WHERE thread.school_id=tenant AND thread.id=conversation
      AND (membership.role<>'staff' OR staff_has_conversation_permission(tenant,actor,action,thread.id))
      AND (thread.class_section_id IS NULL OR chat_actor_has_class_scope(tenant,actor,action,thread.class_section_id))
      AND (thread.context_student_id IS NULL OR chat_actor_has_student_scope(tenant,actor,action,thread.context_student_id))
  )
$$;

-- A participant row is an index/subscription projection, never a grant. Keep
-- future source assignments indexed so advancing the same institution clock
-- needs no worker/GET write to make them usable; the predicate above always
-- rechecks effective authority. Existing/revoked history remains in place.
CREATE FUNCTION chat_class_projection_role(tenant uuid,actor uuid,target_class uuid)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO public AS $$
  SELECT CASE WHEN bool_or(membership.role='admin' OR membership.role='staff') THEN 'moderator'
    WHEN bool_or(membership.role='student') THEN 'member' END
  FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
  WHERE membership.school_id=tenant AND membership.user_id=actor AND membership.is_active AND (
    membership.role='admin'
    OR membership.role='student' AND EXISTS (
      SELECT 1 FROM students learner JOIN enrollments placement ON placement.student_id=learner.id
      WHERE learner.school_id=tenant AND learner.user_id=actor AND placement.class_section_id=target_class AND placement.is_active
    )
    OR membership.role='staff' AND (
      staff_has_class_permission(tenant,actor,'messages.view',target_class)
      OR EXISTS (SELECT 1 FROM staff_role_bindings binding WHERE binding.school_id=tenant AND binding.user_id=actor
        AND binding.context_kind IN ('class','institution') AND binding.scope_id IN (target_class,tenant)
        AND binding.status='active' AND binding.role_active AND 'messages.view'=ANY(binding.permissions)
        AND COALESCE(binding.ends_on,'infinity'::date)>=campus_permission_date(tenant))
      OR EXISTS (SELECT 1 FROM timetable_slots slot JOIN academic_terms term ON term.id=slot.term_id
        WHERE slot.class_section_id=target_class AND slot.teacher_user_id=actor AND term.ends_on>=campus_permission_date(tenant))
      OR EXISTS (SELECT 1 FROM schedule_versions version JOIN schedule_periods period ON period.version_id=version.id
        WHERE version.school_id=tenant AND version.class_section_id=target_class AND version.state='published'
          AND version.ends_on>=campus_permission_date(tenant) AND period.teacher_user_id=actor)
      OR EXISTS (SELECT 1 FROM day_plans plan JOIN day_plan_periods period ON period.plan_id=plan.id AND period.version=plan.published_version
        JOIN school_memberships teacher ON teacher.id=period.teacher_membership_id
        WHERE plan.school_id=tenant AND plan.class_section_id=target_class AND plan.date>=campus_permission_date(tenant) AND teacher.user_id=actor)
      OR EXISTS (SELECT 1 FROM staff_timetable_substitutions substitution
        WHERE substitution.school_id=tenant AND substitution.class_section_id=target_class AND substitution.state='effective'
          AND substitution.replacement_teacher_user_id=actor AND substitution.duty_date>=campus_permission_date(tenant))
    )
  )
$$;

CREATE FUNCTION chat_reconcile_class_group(target_class uuid,changed_actor uuid DEFAULT NULL,create_missing boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO public AS $$
DECLARE classroom record; thread_id uuid; created boolean:=false;
BEGIN
  -- Serialize the derived identity without upgrading the enrollment FK's
  -- KEY SHARE lock (two concurrent admissions must not deadlock on the class).
  -- current_schema also isolates a COW branch's projection lock.
  PERFORM pg_advisory_xact_lock(hashtextextended(current_schema()||':chat-class:'||target_class::text,0));
  SELECT * INTO classroom FROM class_sections WHERE id=target_class;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT id INTO thread_id FROM chat_conversations WHERE school_id=classroom.school_id
    AND class_section_id=target_class AND kind='group' AND group_type='student_group' AND context_student_id IS NULL
    ORDER BY created_at,id LIMIT 1;
  IF thread_id IS NULL THEN
    IF NOT create_missing THEN RETURN; END IF;
    INSERT INTO chat_conversations(school_id,class_section_id,kind,group_type,title,created_by)
      VALUES(classroom.school_id,target_class,'group','student_group','Grade '||classroom.grade||' · '||classroom.section,NULL)
      RETURNING id INTO thread_id;
    created:=true;
  END IF;

  -- Initial per-class bootstrap, or just the affected actor on later source
  -- changes. Conditional updates preserve read state and avoid no-op rewrites.
  WITH candidates AS (
    SELECT DISTINCT membership.user_id,chat_class_projection_role(classroom.school_id,membership.user_id,target_class) AS role
    FROM school_memberships membership WHERE membership.school_id=classroom.school_id AND membership.is_active
      AND (membership.role IN ('admin','staff') OR membership.role='student' AND EXISTS (
        SELECT 1 FROM students learner JOIN enrollments placement ON placement.student_id=learner.id
        WHERE learner.school_id=classroom.school_id AND learner.user_id=membership.user_id
          AND placement.class_section_id=target_class AND placement.is_active
      ))
      AND (changed_actor IS NULL OR created OR membership.user_id=changed_actor)
  )
  INSERT INTO chat_participants(conversation_id,user_id,participant_role,is_active)
    SELECT thread.id,candidate.user_id,candidate.role,true FROM candidates candidate
    JOIN chat_conversations thread ON thread.school_id=classroom.school_id AND thread.class_section_id=target_class
      AND thread.kind='group' AND thread.group_type='student_group' AND thread.context_student_id IS NULL
    WHERE candidate.role IS NOT NULL
  ON CONFLICT(conversation_id,user_id) DO UPDATE SET participant_role=excluded.participant_role,is_active=true
    WHERE chat_participants.participant_role IS DISTINCT FROM excluded.participant_role OR NOT chat_participants.is_active;

  UPDATE chat_participants participant SET is_active=false FROM chat_conversations thread
    WHERE thread.id=participant.conversation_id AND thread.school_id=classroom.school_id AND thread.class_section_id=target_class
      AND thread.kind='group' AND thread.group_type='student_group' AND thread.context_student_id IS NULL
      AND participant.is_active AND (changed_actor IS NULL OR created OR participant.user_id=changed_actor)
      AND chat_class_projection_role(classroom.school_id,participant.user_id,target_class) IS NULL;
END
$$;

CREATE FUNCTION chat_reconcile_class_actor(tenant uuid,actor uuid,create_missing boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO public AS $$
DECLARE target_class uuid;
BEGIN
  IF actor IS NULL THEN RETURN; END IF;
  FOR target_class IN SELECT DISTINCT affected.id FROM (
    SELECT thread.class_section_id AS id FROM chat_conversations thread
      JOIN chat_participants participant ON participant.conversation_id=thread.id
      WHERE thread.school_id=tenant AND participant.user_id=actor AND thread.class_section_id IS NOT NULL
    UNION SELECT placement.class_section_id FROM enrollments placement JOIN students learner ON learner.id=placement.student_id
      WHERE learner.school_id=tenant AND learner.user_id=actor
    UNION SELECT binding.scope_id FROM staff_role_bindings binding
      WHERE binding.school_id=tenant AND binding.user_id=actor AND binding.context_kind='class'
    UNION SELECT classroom.id FROM class_sections classroom WHERE classroom.school_id=tenant AND (
      EXISTS(SELECT 1 FROM school_memberships membership WHERE membership.school_id=tenant AND membership.user_id=actor AND membership.role='admin' AND membership.is_active)
      OR EXISTS(SELECT 1 FROM staff_role_bindings binding WHERE binding.school_id=tenant AND binding.user_id=actor AND binding.context_kind='institution'))
    UNION SELECT slot.class_section_id FROM timetable_slots slot JOIN class_sections classroom ON classroom.id=slot.class_section_id
      WHERE classroom.school_id=tenant AND slot.teacher_user_id=actor
    UNION SELECT version.class_section_id FROM schedule_versions version JOIN schedule_periods period ON period.version_id=version.id
      WHERE version.school_id=tenant AND period.teacher_user_id=actor
    UNION SELECT plan.class_section_id FROM day_plans plan JOIN day_plan_periods period ON period.plan_id=plan.id
      JOIN school_memberships teacher ON teacher.id=period.teacher_membership_id WHERE plan.school_id=tenant AND teacher.user_id=actor
    UNION SELECT substitution.class_section_id FROM staff_timetable_substitutions substitution
      WHERE substitution.school_id=tenant AND substitution.replacement_teacher_user_id=actor
  ) affected ORDER BY affected.id LOOP
    PERFORM chat_reconcile_class_group(target_class,actor,create_missing);
  END LOOP;
END
$$;

-- Enrollment/class/schedule changes are class-bounded; account/assignment
-- changes affect only their explicit actor. No message-directory read writes.
CREATE FUNCTION chat_reconcile_class_source() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO public AS $$
DECLARE source jsonb; source_id uuid; tenant uuid; actor uuid; target_class uuid; pass integer;
BEGIN
  FOR pass IN 1..2 LOOP
    IF pass=1 AND TG_OP<>'INSERT' THEN source:=to_jsonb(OLD);
    ELSIF pass=2 AND TG_OP<>'DELETE' THEN source:=to_jsonb(NEW);
    ELSE CONTINUE; END IF;
    IF pass=2 AND TG_OP='UPDATE' AND source=to_jsonb(OLD) THEN CONTINUE; END IF;
    source_id:=(source->>'id')::uuid;
    tenant:=(source->>'school_id')::uuid;
    actor:=(source->>'user_id')::uuid;
    target_class:=(source->>'class_section_id')::uuid;
    CASE TG_TABLE_NAME
      WHEN 'enrollments' THEN
        SELECT learner.user_id INTO actor FROM students learner WHERE learner.id=(source->>'student_id')::uuid;
        IF actor IS NOT NULL THEN PERFORM chat_reconcile_class_group(target_class,actor,TG_OP<>'DELETE'); END IF;
      WHEN 'class_sections' THEN PERFORM chat_reconcile_class_group(source_id,NULL,TG_OP<>'DELETE');
      WHEN 'students' THEN
        IF actor IS NOT NULL THEN
          FOR target_class IN SELECT DISTINCT placement.class_section_id FROM enrollments placement WHERE placement.student_id=source_id ORDER BY 1 LOOP
            PERFORM chat_reconcile_class_group(target_class,actor,TG_OP<>'DELETE');
          END LOOP;
        END IF;
      WHEN 'users' THEN
        FOR tenant IN SELECT DISTINCT school_id FROM school_memberships WHERE user_id=source_id ORDER BY 1 LOOP
          PERFORM chat_reconcile_class_actor(tenant,source_id,TG_OP<>'DELETE');
        END LOOP;
      WHEN 'staff_profiles' THEN PERFORM chat_reconcile_class_actor(tenant,actor,TG_OP<>'DELETE');
      WHEN 'staff_responsibility_assignments' THEN
        SELECT profile.user_id INTO actor FROM staff_profiles profile WHERE profile.id=(source->>'staff_profile_id')::uuid;
        IF actor IS NOT NULL THEN
          IF target_class IS NOT NULL THEN PERFORM chat_reconcile_class_group(target_class,actor,TG_OP<>'DELETE');
          ELSE PERFORM chat_reconcile_class_actor(tenant,actor,TG_OP<>'DELETE'); END IF;
        END IF;
      WHEN 'staff_responsibility_types' THEN
        FOR actor IN SELECT DISTINCT binding.user_id FROM staff_role_bindings binding WHERE binding.school_id=tenant AND binding.role_id=source_id ORDER BY 1 LOOP
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

CREATE TRIGGER chat_class_enrollment_source AFTER INSERT OR UPDATE OF student_id,class_section_id,is_active,enrolled_on,inactive_from OR DELETE ON enrollments FOR EACH ROW EXECUTE FUNCTION chat_reconcile_class_source();
CREATE TRIGGER chat_class_identity_source AFTER INSERT ON class_sections FOR EACH ROW EXECUTE FUNCTION chat_reconcile_class_source();
CREATE TRIGGER chat_class_student_account_source AFTER UPDATE OF user_id ON students FOR EACH ROW EXECUTE FUNCTION chat_reconcile_class_source();
CREATE TRIGGER chat_class_membership_source AFTER INSERT OR UPDATE OF is_active,role OR DELETE ON school_memberships FOR EACH ROW EXECUTE FUNCTION chat_reconcile_class_source();
CREATE TRIGGER chat_class_account_source AFTER UPDATE OF is_active ON users FOR EACH ROW EXECUTE FUNCTION chat_reconcile_class_source();
CREATE TRIGGER chat_class_staff_profile_source AFTER UPDATE OF user_id,status ON staff_profiles FOR EACH ROW EXECUTE FUNCTION chat_reconcile_class_source();
CREATE TRIGGER chat_class_staff_assignment_source AFTER INSERT OR UPDATE OR DELETE ON staff_responsibility_assignments FOR EACH ROW EXECUTE FUNCTION chat_reconcile_class_source();
CREATE TRIGGER chat_class_legacy_assignment_source AFTER INSERT OR UPDATE OR DELETE ON class_section_staff_assignments FOR EACH ROW EXECUTE FUNCTION chat_reconcile_class_source();
CREATE TRIGGER chat_class_role_source AFTER UPDATE OF capability_permissions,is_active ON staff_responsibility_types FOR EACH ROW EXECUTE FUNCTION chat_reconcile_class_source();
CREATE TRIGGER chat_class_legacy_schedule_source AFTER INSERT OR UPDATE OR DELETE ON timetable_slots FOR EACH ROW EXECUTE FUNCTION chat_reconcile_class_source();
CREATE TRIGGER chat_class_schedule_version_source AFTER INSERT OR UPDATE OF state ON schedule_versions FOR EACH ROW EXECUTE FUNCTION chat_reconcile_class_source();
CREATE TRIGGER chat_class_schedule_period_source AFTER INSERT OR UPDATE OR DELETE ON schedule_periods FOR EACH ROW EXECUTE FUNCTION chat_reconcile_class_source();
CREATE TRIGGER chat_class_day_plan_source AFTER INSERT OR UPDATE OF published_version ON day_plans FOR EACH ROW EXECUTE FUNCTION chat_reconcile_class_source();
CREATE TRIGGER chat_class_day_period_source AFTER INSERT OR UPDATE OR DELETE ON day_plan_periods FOR EACH ROW EXECUTE FUNCTION chat_reconcile_class_source();
CREATE TRIGGER chat_class_substitution_source AFTER INSERT OR UPDATE ON staff_timetable_substitutions FOR EACH ROW EXECUTE FUNCTION chat_reconcile_class_source();

-- A single reviewed upgrade reconciliation. Retain duplicate/historical threads
-- and their messages rather than merging identities from a title or deleting.
DO $$ DECLARE target_class uuid; BEGIN
  FOR target_class IN SELECT id FROM class_sections ORDER BY id LOOP PERFORM chat_reconcile_class_group(target_class); END LOOP;
END $$;

REVOKE ALL ON FUNCTION chat_actor_has_class_scope(uuid,uuid,text,uuid),chat_class_projection_role(uuid,uuid,uuid),
  chat_reconcile_class_group(uuid,uuid,boolean),chat_reconcile_class_actor(uuid,uuid,boolean),chat_reconcile_class_source() FROM PUBLIC;
DO $$ DECLARE owner_name text; routine regprocedure; BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='chat_conversations'::regclass;
  FOREACH routine IN ARRAY ARRAY['chat_actor_has_class_scope(uuid,uuid,text,uuid)'::regprocedure,
    'chat_class_projection_role(uuid,uuid,uuid)'::regprocedure,'chat_reconcile_class_group(uuid,uuid,boolean)'::regprocedure,
    'chat_reconcile_class_actor(uuid,uuid,boolean)'::regprocedure,'chat_reconcile_class_source()'::regprocedure] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO %I',routine,owner_name);
  END LOOP;
END $$;
