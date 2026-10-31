-- Calendar authority belongs to the owning institution. Simulation captures and
-- rewrites now() to its selected branch clock, using the same timezone conversion.
CREATE FUNCTION campus_permission_date(tenant uuid,at_instant timestamptz DEFAULT now())
RETURNS date LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO public AS $$
  SELECT (at_instant AT TIME ZONE timezone)::date FROM schools WHERE id=tenant
$$;
REVOKE ALL ON FUNCTION campus_permission_date(uuid,timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION staff_has_resource_permission(tenant uuid,actor uuid,action text,context text,resource uuid,at_date date DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO public AS $$
  SELECT EXISTS(SELECT 1 FROM staff_role_bindings b
    JOIN school_memberships m ON m.school_id=b.school_id AND m.user_id=b.user_id AND m.role='staff' AND m.is_active
    JOIN users u ON u.id=m.user_id AND u.is_active
    WHERE b.school_id=tenant AND b.user_id=actor AND b.context_kind=context AND b.scope_id=resource
      AND b.role_active AND b.status='active' AND action=ANY(b.permissions)
      AND campus_permission_date(tenant) BETWEEN b.starts_on AND COALESCE(b.ends_on,'infinity'::date)
      AND COALESCE(at_date,campus_permission_date(tenant)) BETWEEN b.starts_on AND COALESCE(b.ends_on,'infinity'::date))
$$;
CREATE OR REPLACE FUNCTION staff_has_class_permission(tenant uuid,actor uuid,action text,resource uuid,at_date date DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO public AS $$
  SELECT staff_has_resource_permission(tenant,actor,action,'class',resource,at_date)
    OR staff_has_resource_permission(tenant,actor,action,'institution',tenant,at_date)
    OR (action=ANY(ARRAY['attendance.view','attendance.record','photo.use','timetable.view','followups.manage','messages.view','messages.send','groups.create'])
      AND NOT EXISTS(SELECT 1 FROM staff_role_bindings b WHERE b.school_id=tenant AND b.user_id=actor AND b.context_kind='class' AND b.scope_id=resource)
      AND EXISTS(SELECT 1 FROM school_memberships m JOIN users u ON u.id=m.user_id WHERE m.school_id=tenant AND m.user_id=actor AND m.role='staff' AND m.is_active AND u.is_active)
      AND schedule_teacher_assigned(tenant,actor,resource,COALESCE(at_date,campus_permission_date(tenant))))
$$;

-- The retained event/notification wrapper chain is executable compatibility
-- authority, not historical backfill SQL. Patch only these reviewed functions;
-- leave data-migration dates, defaults and unrelated functions untouched.
DO $$
DECLARE routine record; definition text; date_expression text;
BEGIN
  FOR routine IN SELECT p.oid,p.proname,p.proargnames FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f' AND (
      p.proname LIKE 'event_user_is_authorized%' OR p.proname='fee_invoice_event_is_authorized'
      OR p.proname='notification_chat_report_is_current_reviewer'
      OR p.proname LIKE 'notification_attention_is_currently_authorized%'
    ) AND p.prosrc ~* '\mcurrent_date\M'
    ORDER BY p.oid
  LOOP
    definition:=pg_get_functiondef(routine.oid);
    IF routine.proname LIKE 'event_user_is_authorized%' OR routine.proname='fee_invoice_event_is_authorized' THEN
      IF routine.proargnames[1]<>'event_school_id' THEN RAISE EXCEPTION 'Unreviewed permission function signature: %',routine.proname; END IF;
      date_expression:='campus_permission_date(event_school_id)';
    ELSE
      -- Both reviewed notification predicates evaluate dates inside the exact
      -- staff_role_bindings binding subquery, whose school is authoritative.
      IF position('binding.school_id' in definition)=0 THEN RAISE EXCEPTION 'Unreviewed notification date scope: %',routine.proname; END IF;
      date_expression:='campus_permission_date(binding.school_id)';
    END IF;
    definition:=regexp_replace(definition,'\mcurrent_date\M',date_expression,'gi');
    EXECUTE definition;
  END LOOP;
END $$;

-- Finance invalidations/replay use the same institution-only operator scope as
-- HTTP reads and writes. An unrelated resource exception is never a ledger grant.
CREATE FUNCTION institution_fee_actor_can_record(tenant uuid,actor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO public AS $$
  SELECT EXISTS(SELECT 1 FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
    WHERE membership.school_id=tenant AND membership.user_id=actor AND membership.is_active AND (
      membership.role='admin' OR membership.role='staff' AND (
        EXISTS(SELECT 1 FROM staff_role_bindings binding WHERE binding.school_id=tenant AND binding.user_id=actor
          AND binding.context_kind='institution' AND binding.scope_id=tenant AND binding.status='active' AND binding.role_active
          AND 'fees.manage'=ANY(binding.permissions) AND campus_permission_date(tenant) BETWEEN binding.starts_on AND coalesce(binding.ends_on,'infinity'::date))
        OR EXISTS(SELECT 1 FROM school_access_exceptions exception WHERE exception.school_id=tenant AND exception.user_id=actor
          AND exception.permission='fees.manage' AND exception.scope_kind='institution' AND exception.status='active'
          AND campus_permission_date(tenant) BETWEEN exception.valid_from AND exception.valid_until))))
$$;
REVOKE ALL ON FUNCTION institution_fee_actor_can_record(uuid,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION fee_invoice_event_is_authorized(event_school_id uuid,event_payload jsonb,candidate_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO public AS $$
  SELECT EXISTS(SELECT 1 FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
    WHERE membership.school_id=event_school_id AND membership.user_id=candidate_user_id AND membership.is_active AND CASE
      WHEN event_payload ? 'person_id' THEN NOT event_payload ? 'student_id' AND EXISTS(
        SELECT 1 FROM fee_invoices invoice WHERE invoice.school_id=event_school_id
          AND invoice.id::text=event_payload->>'invoice_id' AND invoice.person_id::text=event_payload->>'person_id'
          AND campus_model_account_person_is_active(event_school_id,candidate_user_id,NULL,now()) AND (
            institution_fee_actor_can_record(event_school_id,candidate_user_id)
            OR campus_model_account_person_is_active(event_school_id,candidate_user_id,invoice.person_id,now())
              AND EXISTS(SELECT 1 FROM fee_invoice_self_payer_entitlements entitlement
                WHERE entitlement.school_id=invoice.school_id AND entitlement.invoice_id=invoice.id AND entitlement.person_id=invoice.person_id
                  AND entitlement.user_id=candidate_user_id AND campus_permission_date(event_school_id) BETWEEN entitlement.valid_from AND entitlement.valid_until
                  AND NOT EXISTS(SELECT 1 FROM fee_invoice_self_payer_revocations revocation WHERE revocation.school_id=entitlement.school_id AND revocation.entitlement_id=entitlement.id))))
      WHEN event_payload ? 'student_id' THEN EXISTS(SELECT 1 FROM students student WHERE student.school_id=event_school_id
        AND student.id::text=event_payload->>'student_id'
        AND (NOT event_payload ? 'invoice_id' OR EXISTS(SELECT 1 FROM fee_invoices invoice WHERE invoice.school_id=student.school_id
          AND invoice.student_id=student.id AND invoice.id::text=event_payload->>'invoice_id')) AND (
          institution_fee_actor_can_record(event_school_id,candidate_user_id)
          OR membership.role='student' AND student.user_id=candidate_user_id
          OR membership.role='guardian' AND EXISTS(SELECT 1 FROM parents guardian JOIN guardian_relationships relationship ON relationship.guardian_id=guardian.id
            WHERE guardian.user_id=candidate_user_id AND relationship.school_id=student.school_id AND relationship.student_id=student.id)))
      ELSE institution_fee_actor_can_record(event_school_id,candidate_user_id)
    END)
$$;

-- Preserve the public dispatch function OID and its existing non-financial body.
-- Existing parsed callers therefore cannot retain a pre-fix Finance entrypoint.
DO $$ DECLARE previous_body text; BEGIN
  SELECT prosrc INTO STRICT previous_body FROM pg_proc WHERE oid='event_user_is_authorized(uuid,text,jsonb,uuid)'::regprocedure;
  previous_body:=regexp_replace(btrim(previous_body),';\s*$','');
  EXECUTE format($definition$
    CREATE OR REPLACE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
    RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO public AS $finance_scope_205$
      SELECT CASE WHEN event_name='fees.updated' OR event_name LIKE 'finance.%%'
        THEN fee_invoice_event_is_authorized(event_school_id,event_payload,candidate_user_id)
        ELSE (%s) END
    $finance_scope_205$
  $definition$,previous_body);
END $$;

DO $$ DECLARE owner_name text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='school_memberships'::regclass;
  EXECUTE format('ALTER FUNCTION campus_permission_date(uuid,timestamptz) OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION institution_fee_actor_can_record(uuid,uuid) OWNER TO %I',owner_name);
END $$;
