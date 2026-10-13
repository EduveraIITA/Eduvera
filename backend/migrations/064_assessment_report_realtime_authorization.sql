-- Realtime assessment and report-card invalidations re-check the same current
-- resource authority as their request projections. The frozen outbox audience
-- remains a routing hint and cannot preserve access after a role is revoked.
ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid)
  RENAME TO event_user_is_authorized_before_assessment_reports;

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
    WHEN event_name='assessment.updated' THEN EXISTS (
      SELECT 1
      FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id AND account.is_active
      JOIN assessments assessment ON assessment.school_id=membership.school_id
        AND assessment.id::text=event_payload->>'assessment_id'
      WHERE membership.school_id=event_school_id
        AND membership.user_id=candidate_user_id
        AND membership.is_active
        AND (
          membership.role='admin'
          OR (
            membership.role='staff'
            AND EXISTS (
              SELECT 1 FROM assessment_staff_assignments assignment
              WHERE assignment.school_id=assessment.school_id
                AND assignment.assessment_id=assessment.id
                AND assignment.user_id=membership.user_id
            )
            AND staff_has_resource_permission(
              assessment.school_id,
              membership.user_id,
              'assessments.view',
              'assessment',
              assessment.id
            )
          )
          OR (
            event_payload->>'action'='publish'
            AND membership.role='student'
            AND EXISTS (
              SELECT 1
              FROM assessment_results result
              JOIN students student ON student.id=result.student_id
              WHERE result.school_id=assessment.school_id
                AND result.assessment_id=assessment.id
                AND student.user_id=membership.user_id
            )
          )
          OR (
            event_payload->>'action'='publish'
            AND membership.role='guardian'
            AND EXISTS (
              SELECT 1
              FROM assessment_results result
              JOIN guardian_relationships relationship
                ON relationship.school_id=result.school_id
                AND relationship.student_id=result.student_id
              JOIN parents parent ON parent.id=relationship.guardian_id
              WHERE result.school_id=assessment.school_id
                AND result.assessment_id=assessment.id
                AND parent.user_id=membership.user_id
            )
          )
        )
    )
    WHEN event_name='academic_report.updated' THEN EXISTS (
      SELECT 1
      FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id AND account.is_active
      JOIN grading_report_batches batch ON batch.school_id=membership.school_id
        AND batch.id::text=event_payload->>'report_batch_id'
      JOIN grading_schemes scheme ON scheme.id=batch.scheme_id
      WHERE membership.school_id=event_school_id
        AND membership.user_id=candidate_user_id
        AND membership.is_active
        AND (
          membership.role='admin'
          OR (
            membership.role='staff'
            AND EXISTS (
              SELECT 1 FROM staff_role_bindings binding
              WHERE binding.school_id=scheme.school_id
                AND binding.user_id=membership.user_id
                AND binding.context_kind='class'
                AND binding.scope_id=scheme.class_section_id
                AND binding.role_active
                AND binding.status='active'
                AND 'reports.comment'=ANY(binding.permissions)
                AND binding.starts_on<=CURRENT_DATE
                AND (binding.ends_on IS NULL OR binding.ends_on>=CURRENT_DATE)
            )
          )
          OR (
            event_payload->>'action'='publish'
            AND membership.role='student'
            AND EXISTS (
              SELECT 1
              FROM grading_report_students report
              JOIN students student ON student.id=report.student_id
              WHERE report.school_id=batch.school_id
                AND report.batch_id=batch.id
                AND student.user_id=membership.user_id
            )
          )
          OR (
            event_payload->>'action'='publish'
            AND membership.role='guardian'
            AND EXISTS (
              SELECT 1
              FROM grading_report_students report
              JOIN guardian_relationships relationship
                ON relationship.school_id=report.school_id
                AND relationship.student_id=report.student_id
              JOIN parents parent ON parent.id=relationship.guardian_id
              WHERE report.school_id=batch.school_id
                AND report.batch_id=batch.id
                AND parent.user_id=membership.user_id
            )
          )
        )
    )
    ELSE event_user_is_authorized_before_assessment_reports(
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
