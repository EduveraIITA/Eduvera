-- Reviewed Core identity adapter for the internal delivery boundary. This is a
-- boolean contract, not a domain query into model persistence or a new grant.
CREATE FUNCTION campus_model_account_person_is_active(institution uuid,account_id uuid,expected_person uuid,at_time timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  WITH explicit_person AS (
    SELECT person_id FROM students WHERE school_id=institution AND user_id=account_id
    UNION SELECT profile.person_id FROM parents parent JOIN guardian_school_profiles profile ON profile.guardian_id=parent.id
      WHERE profile.school_id=institution AND parent.user_id=account_id
    UNION SELECT person_id FROM staff_profiles WHERE school_id=institution AND user_id=account_id
    UNION SELECT person_id FROM institution_governance_appointments WHERE school_id=institution AND linked_user_id=account_id
  ), eligible AS (
    SELECT endpoint.id,agent.person_id
    FROM campus_model_agent_endpoints endpoint
    JOIN campus_model_agents agent ON agent.id=endpoint.agent_id AND agent.school_id=endpoint.school_id
    JOIN school_people person ON person.id=agent.person_id AND person.school_id=agent.school_id AND person.retired_at IS NULL
    JOIN users account ON account.id=endpoint.user_id AND account.is_active
    JOIN operational_realms realm ON realm.legacy_school_id=agent.school_id AND realm.status='active'
    JOIN execution_environment_namespaces address ON address.realm_id=realm.id AND address.status='active'
      AND (address.expires_at IS NULL OR address.expires_at>at_time)
      AND address.namespace_id=COALESCE(NULLIF(current_setting('thatcampus.namespace_id',true),''),
        CASE WHEN current_schema()='public' THEN 'live:'||institution::text END)
      AND address.environment_kind=CASE WHEN current_schema()='public' THEN 'live' ELSE 'simulation' END
    WHERE endpoint.school_id=institution AND endpoint.user_id=account_id
      AND endpoint.endpoint_kind='account' AND endpoint.provider='thatcampus'
      AND (endpoint.status='active' OR (endpoint.status='revoked' AND EXISTS(
        SELECT 1 FROM campus_model_agent_endpoint_transitions transition WHERE transition.school_id=endpoint.school_id
          AND transition.endpoint_id=endpoint.id AND transition.transition_kind='revoked' AND transition.effective_at>at_time)))
      AND endpoint.effective_from<=at_time AND (endpoint.effective_until IS NULL OR endpoint.effective_until>at_time)
      AND agent.agent_kind='human' AND agent.status='active'
      AND NOT EXISTS(SELECT 1 FROM explicit_person explicit WHERE explicit.person_id<>agent.person_id)
      AND EXISTS(SELECT 1 FROM school_memberships membership WHERE membership.school_id=institution
        AND membership.user_id=account_id AND membership.is_active AND (
          membership.role='admin'
          OR (membership.role='staff' AND EXISTS(SELECT 1 FROM staff_profiles profile WHERE profile.school_id=institution
            AND profile.user_id=account_id AND profile.person_id=agent.person_id AND profile.status='active'))
          OR (membership.role='student' AND EXISTS(SELECT 1 FROM students student WHERE student.school_id=institution
            AND student.user_id=account_id AND student.person_id=agent.person_id))
          OR (membership.role='guardian' AND EXISTS(SELECT 1 FROM parents parent JOIN guardian_school_profiles profile
            ON profile.guardian_id=parent.id WHERE profile.school_id=institution AND parent.user_id=account_id AND profile.person_id=agent.person_id))
        ))
  ) SELECT count(DISTINCT person_id)=1 AND COALESCE(bool_and(expected_person IS NULL OR person_id=expected_person),false) FROM eligible
$$;
COMMENT ON FUNCTION campus_model_account_person_is_active(uuid,uuid,uuid,timestamptz) IS
  'Core-owned, environment-qualified current identity boolean for internal event delivery; grants no domain authority.';

ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) RENAME TO event_user_is_authorized_before_participation;
CREATE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE
    WHEN event_name='attendance.participation.updated' THEN EXISTS(
      SELECT 1 FROM activity_attendance_registers register
      JOIN schedule_activity_occurrences occurrence ON occurrence.id=register.occurrence_id AND occurrence.school_id=register.school_id
      JOIN school_memberships membership ON membership.school_id=register.school_id AND membership.user_id=candidate_user_id AND membership.is_active
      JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE register.school_id=event_school_id AND register.id::text=event_payload->>'register_id'
        AND occurrence.id::text=event_payload->>'occurrence_id'
        AND campus_model_account_person_is_active(event_school_id,candidate_user_id,NULL,now())
        AND (
          -- An explicitly addressed administrator may receive read oversight.
          -- This is not permission to record, review, or appoint an operator.
          membership.role='admin'
          OR EXISTS(SELECT 1 FROM schedule_activity_occurrence_recorders appointment
            LEFT JOIN schedule_versions version ON version.id=occurrence.plan_version_id AND version.school_id=occurrence.school_id
            WHERE appointment.school_id=event_school_id AND appointment.occurrence_id=occurrence.id
              AND campus_model_account_person_is_active(event_school_id,candidate_user_id,appointment.person_id,now())
              AND (occurrence.source='academic' OR version.state='published'
                OR (version.state='cancelled' AND occurrence.starts_at<version.cancelled_at))
              AND staff_has_resource_permission(event_school_id,candidate_user_id,'attendance.'||appointment.action,
                'institution',event_school_id,(now() AT TIME ZONE occurrence.timezone)::date))
          OR (occurrence.source='academic' AND EXISTS(SELECT 1 FROM activity_attendance_legacy_links link
            WHERE link.school_id=register.school_id AND link.register_id=register.id AND link.state='active') AND (
              staff_has_resource_permission(event_school_id,candidate_user_id,'attendance.view','class',occurrence.context_ref,occurrence.local_date)
              OR staff_has_resource_permission(event_school_id,candidate_user_id,'attendance.record','class',occurrence.context_ref,occurrence.local_date)
              OR staff_has_resource_permission(event_school_id,candidate_user_id,'attendance.review','class',occurrence.context_ref,occurrence.local_date)
              OR staff_has_resource_permission(event_school_id,candidate_user_id,'attendance.view','institution',event_school_id,occurrence.local_date)
              OR staff_has_resource_permission(event_school_id,candidate_user_id,'attendance.record','institution',event_school_id,occurrence.local_date)
              OR staff_has_resource_permission(event_school_id,candidate_user_id,'attendance.review','institution',event_school_id,occurrence.local_date)
              OR EXISTS(SELECT 1 FROM effective_school_schedule_v4(event_school_id,occurrence.local_date) slot
                WHERE slot.class_section_id=occurrence.context_ref AND slot.term_id=occurrence.term_id
                  AND slot.teacher_user_id=candidate_user_id AND NOT slot.cancelled AND slot.coverage_status='accepted')
          ))
        )
    )
    WHEN event_name='people.updated' AND COALESCE(event_payload->'refresh','[]'::jsonb) ?| ARRAY['people.participants','activities.catalogue'] THEN EXISTS(
      SELECT 1 FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
      JOIN schools school ON school.id=membership.school_id
      WHERE membership.school_id=event_school_id AND membership.user_id=candidate_user_id AND membership.is_active
        AND campus_model_account_person_is_active(event_school_id,candidate_user_id,NULL,now())
        AND (membership.role='admin' OR staff_has_resource_permission(event_school_id,candidate_user_id,'sis.manage',
          'institution',event_school_id,(now() AT TIME ZONE school.timezone)::date))
    )
    ELSE event_user_is_authorized_before_participation(event_school_id,event_name,event_payload,candidate_user_id)
  END
$$;

-- The publisher also verifies the source; a routing audience or refresh hint
-- cannot relabel another register's envelope as an authorized participation event.
CREATE FUNCTION validate_participation_event_source() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.event_type='attendance.participation.updated' AND (
    NEW.aggregate_type<>'attendance_register' OR NEW.aggregate_id::text IS DISTINCT FROM NEW.payload->>'register_id'
    OR NOT EXISTS(SELECT 1 FROM activity_attendance_registers register
      WHERE register.school_id=NEW.school_id AND register.id=NEW.aggregate_id
        AND register.occurrence_id::text=NEW.payload->>'occurrence_id')
  ) THEN
    RAISE EXCEPTION 'Participation event does not match its authoritative register' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER participation_event_source_scope BEFORE INSERT OR UPDATE ON event_outbox
  FOR EACH ROW EXECUTE FUNCTION validate_participation_event_source();
REVOKE ALL ON FUNCTION campus_model_account_person_is_active(uuid,uuid,uuid,timestamptz),
  event_user_is_authorized(uuid,text,jsonb,uuid),validate_participation_event_source() FROM PUBLIC;
DO $$ DECLARE owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='event_outbox'::regclass;
  EXECUTE format('ALTER FUNCTION campus_model_account_person_is_active(uuid,uuid,uuid,timestamptz) OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION validate_participation_event_source() OWNER TO %I',owner_name);
END $$;
