-- Roles are permission bundles; assignments carry resource scope. Keep the old
-- physical catalogue name for compatibility, not a second work-type abstraction.
DROP TRIGGER staff_work_type_guard ON staff_responsibility_types;
DROP TRIGGER staff_work_type_origin_guard ON staff_responsibility_types;

ALTER TABLE staff_responsibility_types ADD COLUMN context_kind text;
UPDATE staff_responsibility_types SET context_kind=CASE
  WHEN workflow_family IN ('internal_examiner','exam_in_charge','invigilator') THEN 'assessment'
  WHEN workflow_family='transport_attendant' THEN 'trip'
  WHEN workflow_family='safety_officer' THEN 'restricted_care'
  WHEN scope_kind='school' THEN 'institution'
  WHEN scope_kind='class_section' THEN 'class'
  WHEN scope_kind='event' THEN 'event'
  ELSE 'task' END;
ALTER TABLE staff_responsibility_types ALTER COLUMN context_kind SET NOT NULL;
ALTER TABLE staff_responsibility_types ADD CONSTRAINT staff_role_context
  CHECK(context_kind IN ('institution','class','event','assessment','trip','restricted_care','task'));

-- Marking requires an actual assessment assignment. Teaching a class does not
-- by itself make someone the examiner for every assessment in that class.
UPDATE staff_responsibility_types SET capability_permissions=
  array_remove(array_remove(array_remove(capability_permissions,'assessments.mark'),'assessments.view'),'dayplans.respond')
WHERE context_kind='class';
UPDATE staff_responsibility_types SET capability_permissions=(SELECT array_agg(DISTINCT p ORDER BY p)
  FROM unnest(capability_permissions || ARRAY['events.view','events.manage']) p)
WHERE source_kind='system' AND code IN ('class_teacher','subject_teacher');

CREATE FUNCTION staff_role_allowed_permissions(context text) RETURNS text[]
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE context
    WHEN 'institution' THEN ARRAY['members.invite','sis.manage','fees.manage','departure.manage','messages.view','messages.send','groups.create','ai.use']
    WHEN 'class' THEN ARRAY['attendance.view','attendance.record','photo.use','timetable.view','followups.manage','messages.view','messages.send','groups.create','reports.comment','events.view','events.manage','ai.use']
    WHEN 'event' THEN ARRAY['events.view','events.manage','events.attendance']
    WHEN 'assessment' THEN ARRAY['assessments.view','assessments.mark','assessments.moderate']
    WHEN 'trip' THEN ARRAY['departure.collect']
    ELSE ARRAY[]::text[] END
$$;
REVOKE ALL ON FUNCTION staff_role_allowed_permissions(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION prepare_staff_work_type() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF NEW.workflow_family IS NULL OR NEW.workflow_family='' THEN NEW.workflow_family:=NEW.code; END IF;
  IF NEW.source_kind='system' AND NEW.scope_kind='class_section' THEN
    NEW.capability_permissions:=array_remove(array_remove(array_remove(NEW.capability_permissions,'assessments.mark'),'assessments.view'),'dayplans.respond');
    IF NEW.code IN ('class_teacher','subject_teacher') THEN
      NEW.capability_permissions:=(SELECT array_agg(DISTINCT p ORDER BY p) FROM unnest(NEW.capability_permissions || ARRAY['events.view','events.manage']) p);
    END IF;
  END IF;
  IF NEW.context_kind IS NULL THEN
    NEW.context_kind:=CASE
      WHEN NEW.workflow_family IN ('internal_examiner','exam_in_charge','invigilator') THEN 'assessment'
      WHEN NEW.workflow_family='transport_attendant' THEN 'trip'
      WHEN NEW.workflow_family='safety_officer' THEN 'restricted_care'
      WHEN NEW.scope_kind='school' THEN 'institution'
      WHEN NEW.scope_kind='class_section' THEN 'class'
      WHEN NEW.scope_kind='event' THEN 'event' ELSE 'task' END;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.school_id<>OLD.school_id OR NEW.source_kind<>OLD.source_kind OR NEW.code<>OLD.code
       OR NEW.context_kind<>OLD.context_kind OR NEW.scope_kind<>OLD.scope_kind
       OR NEW.cloned_from_type_id IS DISTINCT FROM OLD.cloned_from_type_id THEN
      RAISE EXCEPTION 'Role identity and resource scope cannot change' USING ERRCODE='23514';
    END IF;
    IF OLD.source_kind='system' AND NEW.capability_permissions IS DISTINCT FROM OLD.capability_permissions THEN
      RAISE EXCEPTION 'Copy a built-in role before changing its permissions' USING ERRCODE='23514';
    END IF;
    NEW.revision:=OLD.revision+1;
    NEW.updated_at:=now();
  END IF;
  IF NEW.cloned_from_type_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM staff_responsibility_types source
    WHERE source.id=NEW.cloned_from_type_id AND source.school_id=NEW.school_id
      AND source.context_kind=NEW.context_kind
  ) THEN
    RAISE EXCEPTION 'Role template must belong to this institution and resource scope' USING ERRCODE='23514';
  END IF;
  IF NEW.source_kind='institute' AND NOT (NEW.capability_permissions <@ staff_role_allowed_permissions(NEW.context_kind)) THEN
    RAISE EXCEPTION 'Role includes unsupported actions for its resource scope' USING ERRCODE='23514';
  END IF;
  IF NEW.source_kind='institute' AND (
    ('attendance.record'=ANY(NEW.capability_permissions) AND NOT 'attendance.view'=ANY(NEW.capability_permissions)) OR
    ('photo.use'=ANY(NEW.capability_permissions) AND NOT ARRAY['attendance.view','attendance.record'] <@ NEW.capability_permissions) OR
    ('messages.send'=ANY(NEW.capability_permissions) AND NOT 'messages.view'=ANY(NEW.capability_permissions)) OR
    ('groups.create'=ANY(NEW.capability_permissions) AND NOT ARRAY['messages.view','messages.send'] <@ NEW.capability_permissions) OR
    (NEW.capability_permissions && ARRAY['events.manage','events.attendance'] AND NOT 'events.view'=ANY(NEW.capability_permissions)) OR
    (NEW.capability_permissions && ARRAY['assessments.mark','assessments.moderate'] AND NOT 'assessments.view'=ANY(NEW.capability_permissions)) OR
    (ARRAY['assessments.mark','assessments.moderate'] <@ NEW.capability_permissions)
  ) THEN RAISE EXCEPTION 'Role actions need their prerequisites and independent review' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND NEW.context_kind='assessment' AND EXISTS(
    SELECT 1 FROM assessment_staff_assignments a WHERE a.school_id=NEW.school_id AND a.access_role_id=NEW.id
      AND ((a.role='examiner' AND 'assessments.moderate'=ANY(NEW.capability_permissions))
        OR (a.role='moderator' AND 'assessments.mark'=ANY(NEW.capability_permissions)))
  ) THEN RAISE EXCEPTION 'Role edit conflicts with an assigned assessment duty' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER staff_work_type_guard BEFORE INSERT OR UPDATE ON staff_responsibility_types
FOR EACH ROW EXECUTE FUNCTION prepare_staff_work_type();

-- These overrides belong to the real operational assignment. Null means the
-- application's built-in role for that slot. No second eligibility assignment.
ALTER TABLE staff_responsibility_types ADD CONSTRAINT staff_role_school_id UNIQUE(school_id,id);
ALTER TABLE class_section_staff_assignments ADD COLUMN access_role_id uuid,
  ADD COLUMN access_revision integer NOT NULL DEFAULT 1,
  ADD COLUMN ended_at timestamptz,
  ADD FOREIGN KEY(school_id,access_role_id) REFERENCES staff_responsibility_types(school_id,id);
ALTER TABLE campus_event_staff ADD COLUMN access_role_id uuid,
  ADD COLUMN access_revision integer NOT NULL DEFAULT 1,
  ADD FOREIGN KEY(school_id,access_role_id) REFERENCES staff_responsibility_types(school_id,id);
ALTER TABLE assessment_staff_assignments ADD COLUMN access_role_id uuid,
  ADD COLUMN access_revision integer NOT NULL DEFAULT 1,
  ADD FOREIGN KEY(school_id,access_role_id) REFERENCES staff_responsibility_types(school_id,id);
ALTER TABLE transport_trips ADD COLUMN collector_access_role_id uuid, ADD COLUMN backup_access_role_id uuid,
  ADD FOREIGN KEY(school_id,collector_access_role_id) REFERENCES staff_responsibility_types(school_id,id),
  ADD FOREIGN KEY(school_id,backup_access_role_id) REFERENCES staff_responsibility_types(school_id,id);
CREATE INDEX class_assignment_access_role ON class_section_staff_assignments(school_id,access_role_id);
CREATE INDEX event_assignment_access_role ON campus_event_staff(school_id,access_role_id);
CREATE INDEX assessment_assignment_access_role ON assessment_staff_assignments(school_id,access_role_id);
CREATE INDEX trip_collector_access_role ON transport_trips(school_id,collector_access_role_id);
CREATE INDEX trip_backup_access_role ON transport_trips(school_id,backup_access_role_id);

CREATE FUNCTION validate_operational_access_role() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE selected staff_responsibility_types%ROWTYPE; expected text;
BEGIN
  IF TG_OP='UPDATE' THEN NEW.access_revision:=OLD.access_revision+1; END IF;
  IF NEW.access_role_id IS NULL THEN RETURN NEW; END IF;
  expected:=CASE TG_TABLE_NAME WHEN 'class_section_staff_assignments' THEN 'class'
    WHEN 'campus_event_staff' THEN 'event' ELSE 'assessment' END;
  SELECT * INTO selected FROM staff_responsibility_types WHERE school_id=NEW.school_id AND id=NEW.access_role_id;
  IF NOT FOUND OR selected.context_kind<>expected OR NOT selected.is_active THEN
    RAISE EXCEPTION 'Choose an active role for this assignment context' USING ERRCODE='23514';
  END IF;
  IF expected='assessment' AND (
    (NEW.role='examiner' AND 'assessments.moderate'=ANY(selected.capability_permissions)) OR
    (NEW.role='moderator' AND 'assessments.mark'=ANY(selected.capability_permissions))
  ) THEN RAISE EXCEPTION 'Examiner and independent reviewer access must remain separate' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER class_access_role_guard BEFORE INSERT OR UPDATE ON class_section_staff_assignments
FOR EACH ROW EXECUTE FUNCTION validate_operational_access_role();
CREATE TRIGGER event_access_role_guard BEFORE INSERT OR UPDATE ON campus_event_staff
FOR EACH ROW EXECUTE FUNCTION validate_operational_access_role();
CREATE TRIGGER assessment_access_role_guard BEFORE INSERT OR UPDATE ON assessment_staff_assignments
FOR EACH ROW EXECUTE FUNCTION validate_operational_access_role();
REVOKE ALL ON FUNCTION validate_operational_access_role() FROM PUBLIC;

CREATE FUNCTION validate_trip_access_role() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  -- A replacement starts with the slot's standard access, not the former
  -- collector's personal override.
  IF TG_OP='UPDATE' THEN
    IF NEW.assigned_collector_user_id IS DISTINCT FROM OLD.assigned_collector_user_id THEN NEW.collector_access_role_id:=NULL; END IF;
    IF NEW.backup_collector_user_id IS DISTINCT FROM OLD.backup_collector_user_id THEN NEW.backup_access_role_id:=NULL; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY[NEW.collector_access_role_id,NEW.backup_access_role_id]) chosen(id)
    WHERE chosen.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM staff_responsibility_types r
      WHERE r.id=chosen.id AND r.school_id=NEW.school_id AND r.context_kind='trip' AND r.is_active)) THEN
    RAISE EXCEPTION 'Choose an active journey role in this institution' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trip_access_role_guard BEFORE INSERT OR UPDATE ON transport_trips
FOR EACH ROW EXECUTE FUNCTION validate_trip_access_role();
REVOKE ALL ON FUNCTION validate_trip_access_role() FROM PUBLIC;

-- One read model for the profile, navigation and resource authorization. This
-- is a projection, not another writable assignment/eligibility catalogue.
CREATE VIEW staff_role_bindings AS
SELECT a.school_id,p.user_id,a.id AS source_id,'assignment'::text AS source_kind,
  r.id AS role_id,r.name AS role_name,r.context_kind,
  COALESCE(a.class_section_id,a.event_id,a.school_id) AS scope_id,a.subject_id,
  COALESCE('Class '||c.grade||c.section,e.title,NULLIF(a.scope_label,''),'Institution') AS scope_label,
  a.starts_on,a.ends_on,a.status,r.capability_permissions AS permissions,r.is_active AS role_active,
  a.revision,a.created_at
FROM staff_responsibility_assignments a
JOIN staff_profiles p ON p.id=a.staff_profile_id AND p.school_id=a.school_id
JOIN staff_responsibility_types r ON r.id=a.responsibility_type_id AND r.school_id=a.school_id
LEFT JOIN class_sections c ON c.id=a.class_section_id
LEFT JOIN campus_events e ON e.id=a.event_id
WHERE r.context_kind IN ('institution','class','event')
  AND r.capability_permissions <@ staff_role_allowed_permissions(r.context_kind)
UNION ALL
SELECT a.school_id,a.user_id,a.id,'class_assignment',r.id,r.name,'class',a.class_section_id,a.subject_id,
  'Class '||c.grade||c.section||COALESCE(' · '||s.name,''),a.valid_from,a.valid_until,
  CASE WHEN a.ended_at IS NULL THEN 'active' ELSE 'revoked' END,
  r.capability_permissions,r.is_active,a.access_revision,a.created_at
FROM class_section_staff_assignments a JOIN class_sections c ON c.id=a.class_section_id
LEFT JOIN subjects s ON s.id=a.subject_id
JOIN staff_responsibility_types r ON r.school_id=a.school_id AND
  ((a.access_role_id IS NOT NULL AND r.id=a.access_role_id) OR (a.access_role_id IS NULL AND r.code=a.role))
UNION ALL
SELECT a.school_id,a.user_id,a.event_id,'event_assignment',r.id,r.name,'event',a.event_id,NULL::uuid,
  e.title,a.assigned_at::date,NULL::date,
  CASE WHEN e.status IN ('cancelled','completed') THEN 'completed' ELSE 'active' END,
  r.capability_permissions,r.is_active,a.access_revision,a.assigned_at
FROM campus_event_staff a JOIN campus_events e ON e.id=a.event_id AND e.school_id=a.school_id
JOIN staff_responsibility_types r ON r.school_id=a.school_id AND
  ((a.access_role_id IS NOT NULL AND r.id=a.access_role_id) OR (a.access_role_id IS NULL AND r.code=CASE a.role
    WHEN 'organizer' THEN 'event_coordinator' WHEN 'attendance_taker' THEN 'event_attendance' ELSE 'event_escort' END))
UNION ALL
SELECT a.school_id,a.user_id,a.assessment_id,'assessment_assignment',r.id,r.name,'assessment',a.assessment_id,NULL::uuid,
  x.title,a.assigned_at::date,NULL::date,CASE WHEN x.status='cancelled' THEN 'revoked' ELSE 'active' END,
  r.capability_permissions,r.is_active,a.access_revision,a.assigned_at
FROM assessment_staff_assignments a JOIN assessments x ON x.id=a.assessment_id AND x.school_id=a.school_id
JOIN staff_responsibility_types r ON r.school_id=a.school_id AND
  ((a.access_role_id IS NOT NULL AND r.id=a.access_role_id) OR (a.access_role_id IS NULL AND r.code=CASE a.role
    WHEN 'examiner' THEN 'internal_examiner' ELSE 'exam_in_charge' END))
UNION ALL
SELECT t.school_id,collector.user_id,t.id,'transport_trip',r.id,r.name,'trip',t.id,NULL::uuid,
  route.name||CASE WHEN collector.backup THEN ' · backup' ELSE '' END,
  LEAST(t.created_at::date,t.service_date),t.service_date,
  CASE WHEN t.state IN ('planned','boarding','in_progress') THEN 'active' ELSE 'completed' END,
  r.capability_permissions,r.is_active,t.revision,t.created_at
FROM transport_trips t JOIN transport_routes route ON route.id=t.route_id AND route.school_id=t.school_id
CROSS JOIN LATERAL (VALUES(t.assigned_collector_user_id,false,t.collector_access_role_id),(t.backup_collector_user_id,true,t.backup_access_role_id)) collector(user_id,backup,access_role_id)
JOIN staff_responsibility_types r ON r.school_id=t.school_id AND
  ((collector.access_role_id IS NOT NULL AND r.id=collector.access_role_id) OR (collector.access_role_id IS NULL AND r.code='transport_attendant'))
WHERE collector.user_id IS NOT NULL;

CREATE FUNCTION staff_has_resource_permission(tenant uuid,actor uuid,action text,context text,resource uuid,at_date date DEFAULT current_date)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM staff_role_bindings b
    JOIN school_memberships m ON m.school_id=b.school_id AND m.user_id=b.user_id AND m.role='staff' AND m.is_active
    JOIN users u ON u.id=m.user_id AND u.is_active
    WHERE b.school_id=tenant AND b.user_id=actor AND b.context_kind=context AND b.scope_id=resource
      AND b.role_active AND b.status='active' AND action=ANY(b.permissions)
      AND current_date BETWEEN b.starts_on AND COALESCE(b.ends_on,'infinity'::date)
      AND at_date BETWEEN b.starts_on AND COALESCE(b.ends_on,'infinity'::date))
$$;
REVOKE ALL ON FUNCTION staff_has_resource_permission(uuid,uuid,text,text,uuid,date) FROM PUBLIC;

-- Transitional schedule authority is limited to the existing teaching actions.
-- Any explicit class assignment (even ended/disabled) takes precedence, so a
-- timetable cannot silently restore an administrator's removed access.
CREATE FUNCTION staff_has_class_permission(tenant uuid,actor uuid,action text,resource uuid,at_date date DEFAULT current_date)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT staff_has_resource_permission(tenant,actor,action,'class',resource,at_date)
    OR staff_has_resource_permission(tenant,actor,action,'institution',tenant,at_date)
    OR (action=ANY(ARRAY['attendance.view','attendance.record','photo.use','timetable.view','followups.manage','messages.view','messages.send','groups.create'])
      AND NOT EXISTS(SELECT 1 FROM staff_role_bindings b WHERE b.school_id=tenant AND b.user_id=actor AND b.context_kind='class' AND b.scope_id=resource)
      AND EXISTS(SELECT 1 FROM timetable_slots slot
        JOIN class_sections c ON c.id=slot.class_section_id AND c.school_id=tenant
        JOIN academic_terms term ON term.id=slot.term_id
        JOIN school_memberships m ON m.school_id=tenant AND m.user_id=actor AND m.role='staff' AND m.is_active
        JOIN users u ON u.id=actor AND u.is_active
        WHERE slot.class_section_id=resource AND slot.teacher_user_id=actor
          AND at_date BETWEEN term.starts_on AND term.ends_on))
$$;
REVOKE ALL ON FUNCTION staff_has_class_permission(uuid,uuid,text,uuid,date) FROM PUBLIC;

CREATE FUNCTION staff_has_student_permission(tenant uuid,actor uuid,action text,student uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM enrollments e JOIN students s ON s.id=e.student_id AND s.school_id=tenant
    WHERE e.student_id=student AND e.is_active AND staff_has_class_permission(tenant,actor,action,e.class_section_id))
$$;
REVOKE ALL ON FUNCTION staff_has_student_permission(uuid,uuid,text,uuid) FROM PUBLIC;

ALTER TABLE chat_conversations ADD COLUMN class_section_id uuid,
  ADD FOREIGN KEY(school_id,class_section_id) REFERENCES class_sections(school_id,id);
CREATE INDEX chat_class_scope ON chat_conversations(school_id,class_section_id) WHERE class_section_id IS NOT NULL;

CREATE FUNCTION staff_has_conversation_permission(tenant uuid,actor uuid,action text,conversation uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM chat_conversations c WHERE c.id=conversation AND c.school_id=tenant AND
    CASE WHEN c.class_section_id IS NOT NULL THEN staff_has_class_permission(tenant,actor,action,c.class_section_id)
      WHEN c.context_student_id IS NOT NULL THEN staff_has_student_permission(tenant,actor,action,c.context_student_id)
      ELSE NOT EXISTS(SELECT 1 FROM chat_participants p
        JOIN school_memberships m ON m.school_id=tenant AND m.user_id=p.user_id AND m.is_active
        WHERE p.conversation_id=c.id AND p.user_id<>actor AND p.is_active AND (
          (m.role='student' AND NOT EXISTS(SELECT 1 FROM students s WHERE s.school_id=tenant AND s.user_id=p.user_id
            AND staff_has_student_permission(tenant,actor,action,s.id)))
          OR (m.role='guardian' AND NOT EXISTS(SELECT 1 FROM parents parent JOIN guardian_relationships g ON g.guardian_id=parent.id
            WHERE parent.user_id=p.user_id AND staff_has_student_permission(tenant,actor,action,g.student_id))))) END)
$$;
REVOKE ALL ON FUNCTION staff_has_conversation_permission(uuid,uuid,text,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION coordination_actor_authorized(school uuid,student uuid,actor uuid,context text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM school_memberships m JOIN users u ON u.id=m.user_id AND u.is_active
    JOIN students s ON s.id=student AND s.school_id=m.school_id
    WHERE m.school_id=school AND m.user_id=actor AND m.is_active AND (
      (context='staff' AND (m.role='admin' OR (m.role='staff' AND EXISTS(
        SELECT 1 FROM enrollments e WHERE e.student_id=student AND e.is_active
          AND staff_has_class_permission(school,actor,'followups.manage',e.class_section_id)))))
      OR (context='guardian' AND m.role='guardian' AND EXISTS(SELECT 1 FROM parents p
        JOIN guardian_relationships g ON g.guardian_id=p.id WHERE p.user_id=actor AND g.student_id=student))))
$$;

-- PG14-compatible server-only view: never expose this cross-tenant projection
-- through PostgREST. Every server query supplies the authenticated tenant/user.
REVOKE ALL ON staff_role_bindings FROM PUBLIC;
DO $$ DECLARE actor text; owner_name text; BEGIN
  FOREACH actor IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=actor) THEN
      EXECUTE format('REVOKE ALL ON staff_role_bindings FROM %I',actor);
    END IF;
  END LOOP;
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='staff_profiles'::regclass;
  EXECUTE format('ALTER VIEW staff_role_bindings OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION staff_role_allowed_permissions(text) OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION validate_operational_access_role() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION validate_trip_access_role() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION staff_has_resource_permission(uuid,uuid,text,text,uuid,date) OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION staff_has_class_permission(uuid,uuid,text,uuid,date) OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION staff_has_student_permission(uuid,uuid,text,uuid) OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION staff_has_conversation_permission(uuid,uuid,text,uuid) OWNER TO %I',owner_name);
END $$;
