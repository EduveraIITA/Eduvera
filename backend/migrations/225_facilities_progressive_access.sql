-- Facilities is an additive capability. Listing it grants no repair ownership,
-- institutional authority, external delivery or physical access.
CREATE OR REPLACE FUNCTION staff_role_allowed_permissions(context text) RETURNS text[]
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE context
    WHEN 'institution' THEN ARRAY['gate.manage','members.invite','sis.manage','fees.manage','resources.manage','facilities.manage','attendance.view','attendance.record','attendance.review','departure.manage','messages.view','messages.send','groups.create','ai.use','learning.sessions.manage']
    WHEN 'class' THEN ARRAY['attendance.view','attendance.record','photo.use','timetable.view','followups.manage','messages.view','messages.send','groups.create','reports.comment','events.view','events.manage','ai.use','learning.work.publish','learning.assignments.manage','learning.sessions.manage']
    WHEN 'event' THEN ARRAY['events.view','events.manage','events.attendance']
    WHEN 'assessment' THEN ARRAY['assessments.view','assessments.mark','assessments.moderate']
    WHEN 'trip' THEN ARRAY['departure.collect'] ELSE ARRAY[]::text[] END
$$;

ALTER TABLE school_access_exceptions DROP CONSTRAINT school_access_exceptions_permission_check;
ALTER TABLE school_access_exceptions ADD CONSTRAINT school_access_exceptions_permission_check CHECK(permission=ANY(ARRAY[
  'members.invite','sis.manage','fees.manage','resources.manage','facilities.manage','attendance.view','attendance.record','photo.use',
  'timetable.view','dayplans.respond','followups.manage','messages.view','messages.send','groups.create',
  'safeguarding.review','events.view','events.manage','events.attendance','assessments.view',
  'assessments.mark','assessments.moderate','reports.comment','departure.manage','departure.collect','ai.use'
]::text[]));
ALTER TABLE school_access_exceptions ADD CONSTRAINT facilities_access_exception_institution_scope
  CHECK(permission<>'facilities.manage' OR scope_kind='institution');

INSERT INTO progressive_onboarding_goal_catalog(goal_key,label,description,destination,setup_capability,sort_order)
VALUES('facilities','Repairs & maintenance','Report a problem, follow repairs and confirm the result.',
  '/more/setup/capabilities?task=facilities','facilities',39)
ON CONFLICT(goal_key) DO UPDATE SET label=EXCLUDED.label,description=EXCLUDED.description,
  destination=EXCLUDED.destination,setup_capability=EXCLUDED.setup_capability,sort_order=EXCLUDED.sort_order,is_active=true;
