-- Supported choice only. No existing role, account or assignment gains access.
CREATE OR REPLACE FUNCTION staff_role_allowed_permissions(context text) RETURNS text[]
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE context
    WHEN 'institution' THEN ARRAY['gate.manage','members.invite','sis.manage','fees.manage','attendance.view','attendance.record','attendance.review','departure.manage','messages.view','messages.send','groups.create','ai.use']
    WHEN 'class' THEN ARRAY['attendance.view','attendance.record','photo.use','timetable.view','followups.manage','messages.view','messages.send','groups.create','reports.comment','events.view','events.manage','ai.use','learning.work.publish']
    WHEN 'event' THEN ARRAY['events.view','events.manage','events.attendance']
    WHEN 'assessment' THEN ARRAY['assessments.view','assessments.mark','assessments.moderate']
    WHEN 'trip' THEN ARRAY['departure.collect']
    ELSE ARRAY[]::text[] END
$$;
