-- Teacher-feedback and governance rejection invalidations use a frozen outbox
-- audience only as a routing hint. Durable delivery rechecks current campaign
-- eligibility or current administrator authority so revoked access cannot replay.
ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid)
  RENAME TO event_user_is_authorized_before_feedback_governance;

CREATE FUNCTION event_user_is_authorized(
  event_school_id uuid,
  event_name text,
  event_payload jsonb,
  candidate_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public
AS $$
  SELECT CASE
    WHEN event_name='teacher_feedback.updated' THEN EXISTS (
      SELECT 1
      FROM teacher_feedback_campaigns campaign
      JOIN schools school ON school.id=campaign.school_id
      JOIN school_memberships membership
        ON membership.school_id=campaign.school_id
        AND membership.user_id=candidate_user_id
        AND membership.is_active
      JOIN users account
        ON account.id=membership.user_id
        AND account.is_active
      WHERE campaign.school_id=event_school_id
        AND campaign.id::text=event_payload->>'campaign_id'
        AND (
          membership.role='admin'
          OR (
            membership.role='student'
            AND campaign.audience='students'
            AND campaign.teacher_user_id<>membership.user_id
            AND EXISTS (
              SELECT 1
              FROM students student
              JOIN enrollments enrollment
                ON enrollment.student_id=student.id
                AND enrollment.class_section_id=campaign.class_section_id
                AND enrollment.is_active
              JOIN academic_terms term
                ON term.id=enrollment.term_id
                AND term.school_id=campaign.school_id
              WHERE student.school_id=campaign.school_id
                AND student.user_id=membership.user_id
                AND (now() AT TIME ZONE school.timezone)::date
                  BETWEEN GREATEST(enrollment.enrolled_on,term.starts_on) AND term.ends_on
            )
          )
          OR (
            membership.role='guardian'
            AND campaign.audience='parents'
            AND campaign.teacher_user_id<>membership.user_id
            AND EXISTS (
              SELECT 1
              FROM enrollments enrollment
              JOIN academic_terms term
                ON term.id=enrollment.term_id
                AND term.school_id=campaign.school_id
              JOIN students student
                ON student.id=enrollment.student_id
                AND student.school_id=campaign.school_id
              JOIN guardian_relationships relationship
                ON relationship.school_id=campaign.school_id
                AND relationship.student_id=student.id
              JOIN parents parent
                ON parent.id=relationship.guardian_id
                AND parent.user_id=membership.user_id
              WHERE enrollment.class_section_id=campaign.class_section_id
                AND enrollment.is_active
                AND (now() AT TIME ZONE school.timezone)::date
                  BETWEEN GREATEST(enrollment.enrolled_on,term.starts_on) AND term.ends_on
            )
          )
        )
    )
    WHEN event_name='governance.policy.rejected' THEN EXISTS (
      SELECT 1
      FROM institution_policy_versions version
      JOIN school_memberships membership
        ON membership.school_id=version.school_id
        AND membership.user_id=candidate_user_id
        AND membership.role='admin'
        AND membership.is_active
      JOIN users account
        ON account.id=membership.user_id
        AND account.is_active
      WHERE version.school_id=event_school_id
        AND version.id::text=event_payload->>'version_id'
    )
    ELSE event_user_is_authorized_before_feedback_governance(
      event_school_id,event_name,event_payload,candidate_user_id
    )
  END
$$;

REVOKE ALL ON FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) FROM PUBLIC;

DO $$
DECLARE runtime_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO runtime_owner
  FROM pg_class WHERE oid='event_outbox'::regclass;
  EXECUTE format(
    'ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO %I',
    runtime_owner
  );
END $$;
