ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) RENAME TO event_user_is_authorized_before_day_plans;
CREATE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE WHEN event_name='day_plan.updated' THEN EXISTS (
    SELECT 1 FROM day_plans d JOIN school_memberships m ON m.school_id=d.school_id AND m.user_id=candidate_user_id AND m.is_active
    JOIN users u ON u.id=m.user_id AND u.is_active
    WHERE d.school_id=event_school_id AND d.id::text=event_payload->>'day_plan_id'
      AND d.class_section_id::text=event_payload->>'class_section_id' AND d.date::text=event_payload->>'date'
      AND (m.role='admin' OR (event_payload->>'change_kind'<>'draft' AND m.role='staff' AND (
        EXISTS(SELECT 1 FROM day_plan_periods p JOIN school_memberships teacher ON teacher.id=p.teacher_membership_id WHERE p.plan_id=d.id AND teacher.user_id=candidate_user_id)
        OR EXISTS(SELECT 1 FROM timetable_slots slot WHERE slot.class_section_id=d.class_section_id AND slot.teacher_user_id=candidate_user_id)
      )) OR (event_payload->>'change_kind'='published' AND m.role IN ('student','guardian')
        AND event_user_is_authorized_before_day_plans(event_school_id,event_name,event_payload,candidate_user_id)))
  ) ELSE event_user_is_authorized_before_day_plans(event_school_id,event_name,event_payload,candidate_user_id)
    OR (event_name LIKE 'attendance.%' AND EXISTS (
      SELECT 1 FROM day_plans d JOIN day_plan_periods p ON p.plan_id=d.id AND p.version=d.published_version
      JOIN school_memberships m ON m.id=p.teacher_membership_id AND m.user_id=candidate_user_id AND m.is_active AND m.role='staff'
      JOIN users u ON u.id=m.user_id AND u.is_active
      WHERE d.school_id=event_school_id AND d.class_section_id::text=event_payload->>'class_section_id'
        AND d.term_id::text=event_payload->>'term_id' AND d.date::text=event_payload->>'date'
        AND p.coverage_status='accepted' AND NOT p.cancelled
    )) END
$$;
REVOKE ALL ON FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) FROM PUBLIC;
DO $$ DECLARE owner_name text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='students'::regclass;
  EXECUTE format('ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO %I',owner_name);
END $$;
