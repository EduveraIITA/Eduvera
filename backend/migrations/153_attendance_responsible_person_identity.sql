-- An explicit Attendance responsibility is not evidence of an employment contract
-- or hire date. Preserve unknown Staff facts while keeping one campus person.
ALTER TABLE staff_profiles DROP CONSTRAINT staff_profiles_employment_type_check;
ALTER TABLE staff_profiles ADD CONSTRAINT staff_profiles_employment_type_check
  CHECK (employment_type IN ('full_time','part_time','contract','unspecified'));
ALTER TABLE staff_profiles ALTER COLUMN joined_on DROP NOT NULL;

-- Repair only previously accepted progressive Attendance setup whose responsible
-- account already has an active, unambiguous exact person/agent endpoint. Never
-- match names/contact details, reactivate a Staff record, or invent an appointment.
DO $$
DECLARE candidate record; profile_id uuid; source record;
BEGIN
  FOR candidate IN
    SELECT DISTINCT assignment.school_id,assignment.user_id,agent.person_id,
      person.first_name,person.last_name,account.email
    FROM class_section_staff_assignments assignment
    JOIN schools school ON school.id=assignment.school_id
    JOIN users account ON account.id=assignment.user_id AND account.is_active
    JOIN campus_model_agent_endpoints endpoint
      ON endpoint.school_id=assignment.school_id AND endpoint.user_id=assignment.user_id
      AND endpoint.endpoint_kind='account' AND endpoint.provider='thatcampus'
      AND endpoint.status='active' AND endpoint.effective_from<=now()
      AND (endpoint.effective_until IS NULL OR endpoint.effective_until>now())
    JOIN campus_model_agents agent ON agent.school_id=endpoint.school_id
      AND agent.id=endpoint.agent_id AND agent.agent_kind='human' AND agent.status='active'
    JOIN school_people person ON person.school_id=agent.school_id AND person.id=agent.person_id
    WHERE assignment.role='class_teacher' AND assignment.ended_at IS NULL
      AND assignment.valid_from<=(now() AT TIME ZONE school.timezone)::date
      AND (assignment.valid_until IS NULL OR assignment.valid_until>=(now() AT TIME ZONE school.timezone)::date)
      AND EXISTS (SELECT 1 FROM school_memberships membership
        WHERE membership.school_id=assignment.school_id AND membership.user_id=assignment.user_id
          AND membership.is_active AND membership.role IN ('admin','staff'))
      AND EXISTS (SELECT 1 FROM audit_events audit
        WHERE audit.school_id=assignment.school_id AND audit.action='progressive.attendance.configured'
          AND audit.target_type='class_section' AND audit.target_id=assignment.class_section_id
          AND audit.metadata->>'responsible_user_id'=assignment.user_id::text)
      AND NOT EXISTS (SELECT 1 FROM staff_profiles profile
        WHERE profile.school_id=assignment.school_id AND
          (profile.user_id=assignment.user_id OR profile.person_id=agent.person_id
            OR lower(profile.email)=lower(account.email)))
      AND NOT EXISTS (SELECT 1 FROM campus_model_agent_endpoints other
        JOIN campus_model_agents other_agent ON other_agent.school_id=other.school_id AND other_agent.id=other.agent_id
        WHERE other.school_id=assignment.school_id AND other.user_id=assignment.user_id
          AND other.endpoint_kind='account' AND other.provider='thatcampus'
          AND other.status='active' AND other.effective_from<=now()
          AND (other.effective_until IS NULL OR other.effective_until>now())
          AND other_agent.person_id<>agent.person_id)
    ORDER BY assignment.school_id,assignment.user_id
  LOOP
    INSERT INTO staff_profiles(school_id,user_id,person_id,staff_code,first_name,last_name,email,
      staff_kind,designation,employment_type,joined_on,status,created_by,updated_by)
    VALUES(candidate.school_id,candidate.user_id,candidate.person_id,
      'ATD-'||replace(candidate.user_id::text,'-',''),candidate.first_name,candidate.last_name,candidate.email,
      'teaching','Attendance responsible person','unspecified',NULL,'active',candidate.user_id,candidate.user_id)
    ON CONFLICT DO NOTHING RETURNING id INTO profile_id;
    IF profile_id IS NULL THEN CONTINUE; END IF;

    INSERT INTO school_memberships(school_id,user_id,role,is_active)
    VALUES(candidate.school_id,candidate.user_id,'staff',true)
    ON CONFLICT(user_id,school_id,role) DO NOTHING;

    -- Existing assignments predate the new profile. Invoke the same reviewed
    -- writer adapter used by assignment changes; do not insert Core projections.
    FOR source IN SELECT id,access_revision FROM class_section_staff_assignments
      WHERE school_id=candidate.school_id AND user_id=candidate.user_id
      ORDER BY id
    LOOP
      PERFORM reconcile_campus_responsibility_binding_source(
        candidate.school_id,'class_assignment',source.id,source.access_revision);
    END LOOP;
    INSERT INTO audit_events(actor_id,school_id,action,target_type,target_id,request_id,ip_hash,metadata)
    VALUES(candidate.user_id,candidate.school_id,'progressive.attendance.identity_repaired','staff_profile',
      profile_id,gen_random_uuid(),NULL,jsonb_build_object(
        'source','accepted_progressive_attendance_setup','person_id',candidate.person_id,
        'employment_type','unspecified','joined_on',NULL));
  END LOOP;
END $$;
