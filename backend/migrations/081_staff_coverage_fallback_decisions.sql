-- A fallback is an administrative decision, not proof of classroom delivery.
-- Convert previously closed, unconfirmed tasks only where the school now has
-- an explicit enabled policy, preserving the earlier audit event in the chain.

DO $$
DECLARE
  candidate record;
  updated_task record;
BEGIN
  FOR candidate IN
    SELECT task.id,task.school_id,task.status,task.title,
      policy.fallback_kind,policy.fallback_label,
      policy.supervisor_staff_profile_id,policy.revision AS policy_revision,
      policy.updated_by
    FROM staff_coverage_tasks task
    JOIN staff_coverage_policies policy ON policy.school_id=task.school_id
    WHERE task.status='expired_unconfirmed' AND policy.enabled
    FOR UPDATE OF task
  LOOP
    UPDATE staff_coverage_tasks
    SET status='fallback_applied',
      fallback_kind=candidate.fallback_kind,
      fallback_label=candidate.fallback_label,
      fallback_supervisor_staff_profile_id=candidate.supervisor_staff_profile_id,
      resolution_policy_revision=candidate.policy_revision,
      resolved_at=COALESCE(resolved_at,now()),
      updated_at=now()
    WHERE id=candidate.id AND status='expired_unconfirmed'
    RETURNING revision INTO updated_task;

    IF FOUND THEN
      INSERT INTO staff_coverage_task_audits(
        school_id,task_id,actor_id,action,from_status,to_status,note,automated
      ) VALUES (
        candidate.school_id,candidate.id,candidate.updated_by,
        'fallback_applied','expired_unconfirmed','fallback_applied',
        candidate.fallback_label || ' fallback decision recorded; delivery not asserted.',true
      );

      INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata)
      VALUES (
        candidate.school_id,candidate.updated_by,'staff.coverage.fallback_applied',candidate.id,
        jsonb_build_object(
          'automated',true,
          'from_status','expired_unconfirmed',
          'fallback_kind',candidate.fallback_kind,
          'fallback_label',candidate.fallback_label,
          'policy_revision',candidate.policy_revision,
          'delivery_asserted',false
        )
      );

      -- The earlier alert no longer represents an unresolved item. Retain it
      -- for auditability, but remove it from unread attention counts.
      UPDATE notifications notification
      SET read_at=COALESCE(notification.read_at,now())
      WHERE notification.dedupe_key IN (
        SELECT 'event:' || event.id::text
        FROM event_outbox event
        WHERE event.aggregate_type='staff_coverage_task'
          AND event.aggregate_id=candidate.id
          AND event.event_type='staff.coverage.expired_unconfirmed'
      );
    END IF;
  END LOOP;
END $$;
