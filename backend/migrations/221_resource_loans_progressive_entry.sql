-- Technical borrowing access is explicit; no existing Staff role is widened.
CREATE OR REPLACE FUNCTION staff_role_allowed_permissions(context text) RETURNS text[]
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE context
    WHEN 'institution' THEN ARRAY['gate.manage','members.invite','sis.manage','fees.manage','resources.manage','attendance.view','attendance.record','attendance.review','departure.manage','messages.view','messages.send','groups.create','ai.use','learning.sessions.manage']
    WHEN 'class' THEN ARRAY['attendance.view','attendance.record','photo.use','timetable.view','followups.manage','messages.view','messages.send','groups.create','reports.comment','events.view','events.manage','ai.use','learning.work.publish','learning.assignments.manage','learning.sessions.manage']
    WHEN 'event' THEN ARRAY['events.view','events.manage','events.attendance']
    WHEN 'assessment' THEN ARRAY['assessments.view','assessments.mark','assessments.moderate']
    WHEN 'trip' THEN ARRAY['departure.collect'] ELSE ARRAY[]::text[] END
$$;

INSERT INTO progressive_onboarding_goal_catalog(goal_key,label,description,destination,setup_capability,sort_order)
VALUES('resources','Resources & borrowing','Issue an item, follow returns and resolve borrowing questions.',
  '/more/setup/capabilities?task=resources','resources',37)
ON CONFLICT(goal_key) DO UPDATE SET label=EXCLUDED.label,description=EXCLUDED.description,
  destination=EXCLUDED.destination,setup_capability=EXCLUDED.setup_capability,sort_order=EXCLUDED.sort_order,is_active=true;
