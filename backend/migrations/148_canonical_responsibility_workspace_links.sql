-- Finish the persisted-navigation side of the responsibility-composed
-- application migration. These are transport targets only: every canonical
-- screen still resolves the current Live/Simulation namespace, relationship,
-- responsibility and domain authority when opened.
--
-- The helper deliberately changes only the route prefix. Existing query
-- parameters and fragment anchors are retained verbatim, while a missing
-- relationship/responsibility context is added for legacy bookmark families.

CREATE FUNCTION canonical_responsibility_path_v148(legacy_path text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  route text;
  suffix text;
  target text;
  defaults text;
  pair text;
  pair_key text;
  missing_defaults text := '';
  setup_task text;
BEGIN
  IF legacy_path !~ '^/' THEN
    RETURN legacy_path;
  END IF;

  route := regexp_replace(legacy_path,'([?#].*)$','');
  suffix := COALESCE(substring(legacy_path FROM '([?#].*)$'),'');

  -- Shared shell and relationship work.
  IF route='/account/profile' THEN target := '/more/account';
  ELSIF route='/gate' OR route='/teacher/gate' THEN target := '/areas/in-out/operate';
  ELSIF route='/principal/gate' THEN target := '/areas/in-out/manage';

  ELSIF route IN ('/parent','/parent/home') THEN target := '/today';
  ELSIF route='/parent/requests' THEN target := '/work';
  ELSIF route ~ '^/parent/leave(?:/|$)' THEN
    target := regexp_replace(route,'^/parent/leave','/areas/attendance/leave'); defaults := 'scope=dependent';
  ELSIF route='/parent/more' THEN target := '/more';
  ELSIF route ~ '^/parent/attendance(?:/|$)' THEN
    target := regexp_replace(route,'^/parent/attendance','/areas/attendance/records'); defaults := 'scope=dependent';
  ELSIF route ~ '^/parent/timetable(?:/|$)' THEN
    target := regexp_replace(route,'^/parent/timetable','/areas/timetable/schedule'); defaults := 'scope=dependent';
  ELSIF route ~ '^/parent/calendar(?:/|$)' THEN
    target := regexp_replace(route,'^/parent/calendar','/areas/timetable/calendar'); defaults := 'scope=dependent';
  ELSIF route ~ '^/parent/notices(?:/|$)' THEN
    target := regexp_replace(route,'^/parent/notices','/areas/messages/updates'); defaults := 'scope=dependent';
  ELSIF route ~ '^/parent/diary(?:/|$)' THEN
    target := regexp_replace(route,'^/parent/diary','/areas/messages/diary'); defaults := 'scope=dependent';
  ELSIF route ~ '^/parent/messages(?:/|$)' THEN
    target := regexp_replace(route,'^/parent/messages','/areas/messages/conversations'); defaults := 'scope=dependent';
  ELSIF route ~ '^/parent/results(?:/|$)' THEN
    target := regexp_replace(route,'^/parent/results','/areas/assessments/results'); defaults := 'scope=dependent';
  ELSIF route ~ '^/parent/events(?:/|$)' THEN
    target := regexp_replace(route,'^/parent/events','/areas/events/calendar'); defaults := 'scope=dependent';
  ELSIF route ~ '^/parent/fees(?:/|$)' THEN
    target := regexp_replace(route,'^/parent/fees','/areas/fees/account'); defaults := 'scope=dependent';
  ELSIF route ~ '^/parent/departure(?:/|$)' THEN
    target := regexp_replace(route,'^/parent/departure','/areas/departure/plan'); defaults := 'scope=dependent';
  ELSIF route ~ '^/parent/(insights|analytics)(?:/|$)' THEN
    target := regexp_replace(route,'^/parent/(insights|analytics)','/areas/insights'); defaults := 'scope=dependent';
  ELSIF route='/parent/teacher-feedback' THEN target := '/more/feedback';
  ELSIF route='/parent/policies' THEN target := '/more/policies';
  ELSIF route='/parent/assistant' THEN target := '/areas/assistant/conversation';

  ELSIF route IN ('/student','/student/home') THEN target := '/today';
  ELSIF route='/student/requests' THEN target := '/work';
  ELSIF route='/student/apps' OR route='/student/more' THEN target := '/more';
  ELSIF route='/student/leave/new' THEN target := '/areas/attendance/leave'; defaults := 'scope=self&view=apply';
  ELSIF route ~ '^/student/leave(?:/|$)' THEN
    target := regexp_replace(route,'^/student/leave','/areas/attendance/leave'); defaults := 'scope=self';
  ELSIF route='/student/attendance/eligibility' THEN target := '/areas/attendance/eligibility'; defaults := 'scope=self';
  ELSIF route='/student/attendance' THEN target := '/areas/attendance/records'; defaults := 'scope=self';
  ELSIF route='/student/timetable/week' THEN target := '/areas/timetable/schedule'; defaults := 'scope=self&view=week';
  ELSIF route ~ '^/student/timetable(?:/|$)' THEN
    target := regexp_replace(route,'^/student/timetable','/areas/timetable/schedule'); defaults := 'scope=self';
  ELSIF route ~ '^/student/calendar(?:/|$)' THEN
    target := regexp_replace(route,'^/student/calendar','/areas/timetable/calendar'); defaults := 'scope=self';
  ELSIF route ~ '^/student/notices(?:/|$)' THEN
    target := regexp_replace(route,'^/student/notices','/areas/messages/updates'); defaults := 'scope=self';
  ELSIF route ~ '^/student/diary(?:/|$)' THEN
    target := regexp_replace(route,'^/student/diary','/areas/messages/diary'); defaults := 'scope=self';
  ELSIF route ~ '^/student/messages(?:/|$)' THEN
    target := regexp_replace(route,'^/student/messages','/areas/messages/conversations'); defaults := 'scope=self';
  ELSIF route ~ '^/student/results(?:/|$)' THEN
    target := regexp_replace(route,'^/student/results','/areas/assessments/results'); defaults := 'scope=self';
  ELSIF route ~ '^/student/events(?:/|$)' THEN
    target := regexp_replace(route,'^/student/events','/areas/events/calendar'); defaults := 'scope=self';
  ELSIF route ~ '^/student/fees(?:/|$)' THEN
    target := regexp_replace(route,'^/student/fees','/areas/fees/account'); defaults := 'scope=self';
  ELSIF route ~ '^/student/departure(?:/|$)' THEN
    target := regexp_replace(route,'^/student/departure','/areas/departure/plan'); defaults := 'scope=self';
  ELSIF route ~ '^/student/(insights|analytics)(?:/|$)' THEN
    target := regexp_replace(route,'^/student/(insights|analytics)','/areas/insights'); defaults := 'scope=self';
  ELSIF route='/student/classes' THEN target := '/areas/timetable/schedule'; defaults := 'scope=self';
  ELSIF route='/student/teacher-feedback' THEN target := '/more/feedback';
  ELSIF route='/student/policies' THEN target := '/more/policies';
  ELSIF route IN ('/student/assistant','/student/copilot') THEN target := '/areas/assistant/conversation';

  -- Assigned staff work.
  ELSIF route='/teacher' AND (legacy_path ~ '[?&]followup=' OR suffix LIKE '%#attendance-followups%') THEN
    target := '/areas/attendance/follow-ups';
  ELSIF route IN ('/teacher','/teacher/home') THEN target := '/today';
  ELSIF route='/teacher/requests' THEN target := '/work';
  ELSIF route ~ '^/teacher/attendance(?:/|$)' THEN
    target := regexp_replace(route,'^/teacher/attendance','/areas/attendance/registers');
  ELSIF route='/teacher/leave' THEN target := '/areas/responsibilities/leave';
  ELSIF route='/teacher/timetable/weekly' THEN target := '/areas/timetable/schedule'; defaults := 'view=week';
  ELSIF route ~ '^/teacher/timetable(?:/|$)' THEN
    target := regexp_replace(route,'^/teacher/timetable','/areas/timetable/schedule'); defaults := 'view=day';
  ELSIF route ~ '^/teacher/calendar(?:/|$)' THEN
    target := regexp_replace(route,'^/teacher/calendar','/areas/timetable/calendar'); defaults := 'surface=assigned';
  ELSIF route ~ '^/teacher/classes(?:/|$)' THEN target := regexp_replace(route,'^/teacher/classes','/areas/people/classes');
  ELSIF route='/teacher/fees' THEN target := '/areas/fees/ledger';
  ELSIF route='/teacher/administration' THEN
    target := CASE
      WHEN legacy_path ~ '[?&]section=campus(?:&|#|$)' THEN '/more/setup/institution/campus'
      WHEN legacy_path ~ '[?&]section=setup(?:&|#|$)' THEN '/more/setup/institution/academics'
      WHEN legacy_path ~ '[?&]section=access(?:&|#|$)' THEN '/more/setup/people/access'
      WHEN legacy_path ~ '[?&]section=audit(?:&|#|$)' THEN '/more/setup/institution/history'
      WHEN legacy_path ~ '[?&]section=promotion(?:&|#|$)' THEN '/more/setup/institution/promotion'
      WHEN legacy_path ~ '[?&]section=rules(?:&|#|$)' THEN '/more/setup/institution/operating-rules'
      ELSE '/more/setup/institution' END;
  ELSIF route='/teacher/invitations' THEN target := '/more/setup/people/invitations';
  ELSIF route='/teacher/students/import' THEN target := '/areas/people/import';
  ELSIF route ~ '^/teacher/students(?:/|$)' THEN target := regexp_replace(route,'^/teacher/students','/areas/people/records');
  ELSIF route='/teacher/more' THEN target := '/more';
  ELSIF route ~ '^/teacher/messages(?:/|$)' THEN target := regexp_replace(route,'^/teacher/messages','/areas/messages/conversations');
  ELSIF route ~ '^/teacher/assessments?(?:/|$)' THEN target := regexp_replace(route,'^/teacher/assessments?','/areas/assessments/assigned');
  ELSIF route='/teacher/events/new' THEN target := '/areas/assessments/assigned'; defaults := 'create=class-test';
  ELSIF route ~ '^/teacher/events(?:/|$)' THEN
    target := regexp_replace(regexp_replace(route,'^/teacher/events','/areas/events/assigned'),'/register$','/attendance');
  ELSIF route ~ '^/teacher/notices(?:/|$)' THEN target := regexp_replace(route,'^/teacher/notices','/areas/messages/updates');
  ELSIF route ~ '^/teacher/report-cards(?:/|$)' THEN target := regexp_replace(route,'^/teacher/report-cards','/areas/reports/remarks');
  ELSIF route ~ '^/teacher/safeguarding(?:/|$)' THEN target := regexp_replace(route,'^/teacher/safeguarding','/areas/care/concerns');
  ELSIF route ~ '^/teacher/transport(?:/|$)' THEN target := regexp_replace(route,'^/teacher/transport','/areas/departure/operate');
  ELSIF route='/teacher/responsibilities' AND legacy_path ~ '[?&]coverage=' THEN target := '/areas/responsibilities/coverage';
  ELSIF route='/teacher/responsibilities' THEN target := '/areas/responsibilities/mine';
  ELSIF route ~ '^/teacher/(insights|analytics)(?:/|$)' THEN
    target := regexp_replace(route,'^/teacher/(insights|analytics)','/areas/insights'); defaults := 'scope=assigned';
  ELSIF route='/teacher/teacher-feedback' THEN target := '/more/feedback';
  ELSIF route='/teacher/policies' THEN target := '/more/policies';
  ELSIF route='/teacher/assistant' THEN target := '/areas/assistant/conversation';

  -- Institution coordination and setup.
  ELSIF route IN ('/principal','/principal/home') THEN target := '/today';
  ELSIF route='/principal/requests' THEN target := '/work';
  ELSIF route='/principal/followups' THEN target := '/areas/attendance/follow-ups';
  ELSIF route='/principal/attendance/thresholds' THEN target := '/areas/attendance/thresholds';
  ELSIF route='/principal/student-leave' THEN target := '/areas/attendance/leave/review';
  ELSIF route ~ '^/principal/attendance(?:/|$)' THEN target := regexp_replace(route,'^/principal/attendance','/areas/attendance/coordination');
  ELSIF route='/principal/timetable/day' THEN target := '/areas/timetable/planning/day';
  ELSIF route='/principal/timetable/weekly' THEN target := '/areas/timetable/planning/settings';
  ELSIF route ~ '^/principal/timetable(?:/|$)' THEN target := regexp_replace(route,'^/principal/timetable','/areas/timetable/planning');
  ELSIF route ~ '^/principal/calendar(?:/|$)' THEN
    target := regexp_replace(route,'^/principal/calendar','/areas/timetable/calendar'); defaults := 'surface=manage';
  ELSIF route='/principal/fees' THEN target := '/areas/fees/ledger';
  ELSIF route='/principal/administration' THEN
    target := CASE
      WHEN legacy_path ~ '[?&]section=campus(?:&|#|$)' THEN '/more/setup/institution/campus'
      WHEN legacy_path ~ '[?&]section=setup(?:&|#|$)' THEN '/more/setup/institution/academics'
      WHEN legacy_path ~ '[?&]section=access(?:&|#|$)' THEN '/more/setup/people/access'
      WHEN legacy_path ~ '[?&]section=audit(?:&|#|$)' THEN '/more/setup/institution/history'
      WHEN legacy_path ~ '[?&]section=promotion(?:&|#|$)' THEN '/more/setup/institution/promotion'
      WHEN legacy_path ~ '[?&]section=rules(?:&|#|$)' THEN '/more/setup/institution/operating-rules'
      ELSE '/more/setup/institution' END;
  ELSIF route ~ '^/principal/get-started/([a-z][a-z0-9_-]*)$' THEN
    setup_task := substring(route FROM '^/principal/get-started/([a-z][a-z0-9_-]*)$');
    target := '/more/setup/capabilities'; defaults := 'task='||setup_task;
  ELSIF route='/principal/get-started' THEN target := '/more/setup/capabilities';
  ELSIF route='/principal/invitations' THEN target := '/more/setup/people/invitations';
  ELSIF route='/principal/organization' THEN target := '/more/setup/organization';
  ELSIF route='/principal/students/import' THEN target := '/areas/people/import';
  ELSIF route ~ '^/principal/students(?:/|$)' THEN target := regexp_replace(route,'^/principal/students','/areas/people/records');
  ELSIF route='/principal/roles' THEN target := '/more/setup/responsibilities'; defaults := 'section=roles';
  ELSIF route ~ '^/principal/staff/[^/]+$' THEN target := regexp_replace(route,'^/principal/staff/','/more/setup/responsibilities/');
  ELSIF route='/principal/staff' AND legacy_path ~ '[?&]coverage=' THEN target := '/areas/responsibilities/coverage';
  ELSIF route='/principal/staff' AND legacy_path ~ '[?&]section=leave(?:&|#|$)' THEN target := '/areas/responsibilities/leave';
  ELSIF route='/principal/staff' THEN target := '/more/setup/responsibilities';
  ELSIF route='/principal/more' THEN target := '/more';
  ELSIF route ~ '^/principal/messages(?:/|$)' THEN target := regexp_replace(route,'^/principal/messages','/areas/messages/conversations');
  ELSIF route ~ '^/principal/assessments?(?:/|$)' THEN target := regexp_replace(route,'^/principal/assessments?','/areas/assessments/manage');
  ELSIF route ~ '^/principal/events(?:/|$)' THEN
    target := regexp_replace(regexp_replace(route,'^/principal/events','/areas/events/manage'),'/register$','/attendance');
  ELSIF route ~ '^/principal/notices(?:/|$)' THEN target := regexp_replace(route,'^/principal/notices','/areas/messages/updates');
  ELSIF route ~ '^/principal/report-cards(?:/|$)' THEN target := regexp_replace(route,'^/principal/report-cards','/areas/reports/remarks');
  ELSIF route ~ '^/principal/safeguarding(?:/|$)' THEN target := regexp_replace(route,'^/principal/safeguarding','/areas/care/concerns');
  ELSIF route ~ '^/principal/departure/journeys(?:/|$)' THEN target := regexp_replace(route,'^/principal/departure/journeys','/areas/departure/manage/journeys');
  ELSIF route ~ '^/principal/departure(?:/|$)' THEN target := regexp_replace(route,'^/principal/departure','/areas/departure/manage');
  ELSIF route ~ '^/principal/(insights|analytics)(?:/|$)' THEN
    target := regexp_replace(route,'^/principal/(insights|analytics)','/areas/insights'); defaults := 'scope=institution';
  ELSIF route='/principal/teacher-feedback' THEN target := '/more/feedback';
  ELSIF route='/principal/policies' THEN target := '/more/policies';
  ELSIF route='/principal/governance' THEN target := '/more/governance';
  ELSIF route='/principal/verification' THEN target := '/more/verification';
  ELSIF route='/principal/campus' THEN target := '/more/campus-view';
  ELSIF route='/principal/experimental' THEN target := '/more/development';
  ELSIF route='/principal/campus-lab' THEN target := '/more/development/campus-lab';
  ELSIF route='/principal/assistant' THEN target := '/areas/assistant/conversation';
  ELSE
    RETURN legacy_path;
  END IF;

  -- Do not duplicate a context key already retained by the legacy query.
  IF defaults IS NOT NULL THEN
    FOREACH pair IN ARRAY string_to_array(defaults,'&') LOOP
      pair_key := split_part(pair,'=',1);
      IF legacy_path !~ ('[?&]'||pair_key||'=') THEN
        missing_defaults := missing_defaults||CASE WHEN missing_defaults='' THEN '' ELSE '&' END||pair;
      END IF;
    END LOOP;
  END IF;

  IF missing_defaults<>'' THEN
    IF suffix LIKE '?%' THEN
      RETURN target||'?'||missing_defaults
        ||CASE WHEN length(suffix)>1 THEN '&'||substring(suffix FROM 2) ELSE '' END;
    END IF;
    RETURN target||'?'||missing_defaults||suffix;
  END IF;
  RETURN target||suffix;
END $$;

-- Purpose selection always resumes in the one progressive setup guide. Once a
-- capability is accepted, the owning domain transaction promotes the workspace
-- to its canonical operating destination.
UPDATE progressive_onboarding_goal_catalog
SET destination='/more/setup/capabilities?task='||goal_key
WHERE goal_key IN ('attendance','gate','timetable','examinations','performance','staff','messages')
  AND destination IS DISTINCT FROM '/more/setup/capabilities?task='||goal_key;

UPDATE progressive_onboarding_workspaces workspace
SET resume_path=canonical_responsibility_path_v148(workspace.resume_path),
    updated_at=now()
WHERE canonical_responsibility_path_v148(workspace.resume_path) IS DISTINCT FROM workspace.resume_path;

UPDATE notifications notification
SET link=canonical_responsibility_path_v148(notification.link)
WHERE notification.link IS NOT NULL
  AND canonical_responsibility_path_v148(notification.link) IS DISTINCT FROM notification.link;

-- Published outbox rows are immutable delivery evidence. Only queued payloads
-- can still manufacture a future notification, so only they are repaired.
UPDATE event_outbox event
SET notification_payload=(
  SELECT jsonb_object_agg(entry.key,
    CASE
      WHEN entry.key IN ('link','parent_link','student_link','staff_link','admin_link')
        AND jsonb_typeof(entry.value)='string'
      THEN to_jsonb(canonical_responsibility_path_v148(entry.value #>> '{}'))
      ELSE entry.value
    END)
  FROM jsonb_each(event.notification_payload) entry
)
WHERE event.published_at IS NULL
  AND event.notification_payload IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM jsonb_each(event.notification_payload) candidate
    WHERE candidate.key IN ('link','parent_link','student_link','staff_link','admin_link')
      AND jsonb_typeof(candidate.value)='string'
      AND canonical_responsibility_path_v148(candidate.value #>> '{}')
        IS DISTINCT FROM candidate.value #>> '{}'
  );

-- An active operational hand-off keeps its realm, environment namespace,
-- tenant, recipient, correlation and evidence unchanged. Only the UI target is
-- moved; terminal protocol records remain immutable history.
UPDATE campus_model_operational_messages message
SET payload=jsonb_set(
      message.payload,
      '{action_path}',
      to_jsonb(canonical_responsibility_path_v148(message.payload->>'action_path')),
      false
    ),
    updated_at=now()
WHERE message.state IN ('queued','delivered','acknowledged')
  AND jsonb_typeof(message.payload->'action_path')='string'
  AND canonical_responsibility_path_v148(message.payload->>'action_path')
    IS DISTINCT FROM message.payload->>'action_path';

DROP FUNCTION canonical_responsibility_path_v148(text);
