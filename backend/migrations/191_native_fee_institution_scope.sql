-- Native person Finance is institution-scoped. A resource-limited exception
-- cannot become a campus-wide ledger grant. No historical financial row changes.
CREATE OR REPLACE FUNCTION fee_invoice_event_is_authorized(event_school_id uuid,event_payload jsonb,candidate_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE WHEN event_payload ? 'person_id' THEN
    EXISTS(SELECT 1 FROM fee_invoices invoice JOIN schools school ON school.id=invoice.school_id
      JOIN school_memberships membership ON membership.school_id=invoice.school_id AND membership.user_id=candidate_user_id AND membership.is_active
      JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE invoice.school_id=event_school_id AND invoice.id::text=event_payload->>'invoice_id' AND invoice.person_id::text=event_payload->>'person_id'
        AND NOT event_payload ? 'student_id' AND campus_model_account_person_is_active(invoice.school_id,candidate_user_id,NULL,now()) AND (
          membership.role='admin' OR membership.role='staff' AND (
            EXISTS(SELECT 1 FROM staff_role_bindings binding WHERE binding.school_id=invoice.school_id AND binding.user_id=candidate_user_id
              AND binding.context_kind='institution' AND binding.scope_id=invoice.school_id AND binding.status='active' AND binding.role_active
              AND (now() AT TIME ZONE school.timezone)::date BETWEEN binding.starts_on AND coalesce(binding.ends_on,'infinity'::date)
              AND 'fees.manage'=ANY(binding.permissions))
            OR EXISTS(SELECT 1 FROM school_access_exceptions exception WHERE exception.school_id=invoice.school_id AND exception.user_id=candidate_user_id
              AND exception.permission='fees.manage' AND exception.scope_kind='institution' AND exception.status='active'
              AND (now() AT TIME ZONE school.timezone)::date BETWEEN exception.valid_from AND exception.valid_until))
          OR campus_model_account_person_is_active(invoice.school_id,candidate_user_id,invoice.person_id,now())
            AND EXISTS(SELECT 1 FROM fee_invoice_self_payer_entitlements entitlement WHERE entitlement.school_id=invoice.school_id AND entitlement.invoice_id=invoice.id
              AND entitlement.person_id=invoice.person_id AND entitlement.user_id=candidate_user_id
              AND (now() AT TIME ZONE school.timezone)::date BETWEEN entitlement.valid_from AND entitlement.valid_until
              AND NOT EXISTS(SELECT 1 FROM fee_invoice_self_payer_revocations revocation WHERE revocation.school_id=entitlement.school_id AND revocation.entitlement_id=entitlement.id))))
    ELSE event_user_is_authorized_before_person_fees(event_school_id,'fees.updated',event_payload,candidate_user_id) END
$$;
REVOKE ALL ON FUNCTION fee_invoice_event_is_authorized(uuid,jsonb,uuid) FROM PUBLIC;
DO $$ DECLARE owner_name text; restricted_role text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='fee_invoices'::regclass;
  EXECUTE format('ALTER FUNCTION fee_invoice_event_is_authorized(uuid,jsonb,uuid) OWNER TO %I',owner_name);
  FOREACH restricted_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=restricted_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION fee_invoice_event_is_authorized(uuid,jsonb,uuid) FROM %I',restricted_role);
    END IF;
  END LOOP;
END $$;
