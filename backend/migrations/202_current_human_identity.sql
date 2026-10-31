-- One selected-world eligibility query for endpoint resolution, candidate lists
-- and delivery. This establishes current identity only, never domain authority.
CREATE FUNCTION campus_model_current_account_endpoints(institution uuid,account_id uuid,at_time timestamptz)
RETURNS TABLE(endpoint_id uuid,agent_id uuid,school_id uuid,person_id uuid,label text,user_id uuid,
  effective_from timestamptz,effective_until timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  WITH explicit_person AS (
    SELECT account_user_id AS user_id,id AS person_id FROM school_people WHERE school_id=institution AND account_user_id IS NOT NULL
    UNION SELECT user_id,person_id FROM students WHERE school_id=institution AND user_id IS NOT NULL
    UNION SELECT parent.user_id,profile.person_id FROM parents parent JOIN guardian_school_profiles profile ON profile.guardian_id=parent.id
      WHERE profile.school_id=institution AND parent.user_id IS NOT NULL
    UNION SELECT user_id,person_id FROM staff_profiles WHERE school_id=institution AND user_id IS NOT NULL
    UNION SELECT linked_user_id,person_id FROM institution_governance_appointments WHERE school_id=institution AND linked_user_id IS NOT NULL
  ), eligible AS (
    SELECT endpoint.id AS endpoint_id,agent.id AS agent_id,agent.school_id,agent.person_id,
      trim(concat_ws(' ',person.first_name,person.last_name)) AS label,endpoint.user_id,endpoint.effective_from,endpoint.effective_until
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
    WHERE endpoint.school_id=institution AND (account_id IS NULL OR endpoint.user_id=account_id)
      AND endpoint.endpoint_kind='account' AND endpoint.provider='thatcampus'
      AND (endpoint.status='active' OR (endpoint.status='revoked' AND EXISTS(
        SELECT 1 FROM campus_model_agent_endpoint_transitions transition WHERE transition.school_id=endpoint.school_id
          AND transition.endpoint_id=endpoint.id AND transition.transition_kind='revoked' AND transition.effective_at>at_time)))
      AND endpoint.effective_from<=at_time AND (endpoint.effective_until IS NULL OR endpoint.effective_until>at_time)
      AND agent.agent_kind='human' AND agent.status='active'
      AND NOT EXISTS(SELECT 1 FROM explicit_person explicit WHERE explicit.user_id=endpoint.user_id AND explicit.person_id<>agent.person_id)
      AND EXISTS(SELECT 1 FROM school_memberships membership WHERE membership.school_id=institution
        AND membership.user_id=endpoint.user_id AND membership.is_active AND (
          membership.role='admin'
          OR (membership.role='member' AND person.account_user_id=endpoint.user_id)
          OR (membership.role='staff' AND EXISTS(SELECT 1 FROM staff_profiles profile WHERE profile.school_id=institution
            AND profile.user_id=endpoint.user_id AND profile.person_id=agent.person_id AND profile.status='active'))
          OR (membership.role='student' AND EXISTS(SELECT 1 FROM students student WHERE student.school_id=institution
            AND student.user_id=endpoint.user_id AND student.person_id=agent.person_id))
          OR (membership.role='guardian' AND EXISTS(SELECT 1 FROM parents parent JOIN guardian_school_profiles profile
            ON profile.guardian_id=parent.id WHERE profile.school_id=institution AND parent.user_id=endpoint.user_id AND profile.person_id=agent.person_id))
        ))
  ) SELECT eligible.* FROM eligible WHERE NOT EXISTS(SELECT 1 FROM eligible other
      WHERE other.user_id=eligible.user_id AND other.person_id<>eligible.person_id)
$$;
CREATE OR REPLACE FUNCTION campus_model_account_person_is_active(institution uuid,account_id uuid,expected_person uuid,at_time timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT account_id IS NOT NULL AND count(DISTINCT eligible.person_id)=1 AND COALESCE(bool_and(expected_person IS NULL OR eligible.person_id=expected_person),false)
  FROM campus_model_current_account_endpoints(institution,account_id,at_time) eligible
$$;
REVOKE ALL ON FUNCTION campus_model_current_account_endpoints(uuid,uuid,timestamptz),
  campus_model_account_person_is_active(uuid,uuid,uuid,timestamptz) FROM PUBLIC;
DO $$ DECLARE owner_name text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='campus_model_agents'::regclass;
  EXECUTE format('ALTER FUNCTION campus_model_current_account_endpoints(uuid,uuid,timestamptz) OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION campus_model_account_person_is_active(uuid,uuid,uuid,timestamptz) OWNER TO %I',owner_name);
END $$;
