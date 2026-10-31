-- Extend the existing immutable ledger. Legacy rows and their commitments are not rewritten.
ALTER TABLE fee_invoices ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE fee_invoices ADD COLUMN person_id uuid,ADD COLUMN selected_person_revision integer;
ALTER TABLE fee_invoices ADD CONSTRAINT fee_invoice_beneficiary_context CHECK(
  student_id IS NOT NULL AND person_id IS NULL AND selected_person_revision IS NULL
  OR student_id IS NULL AND person_id IS NOT NULL AND selected_person_revision IS NOT NULL AND selected_person_revision>0);
ALTER TABLE fee_invoices ADD FOREIGN KEY(school_id,person_id) REFERENCES school_people(school_id,id),
  ADD UNIQUE(school_id,id,person_id);
CREATE INDEX fee_invoices_person ON fee_invoices(school_id,person_id,due_on,id) WHERE person_id IS NOT NULL;

-- A separate nullable discriminator leaves old immutable entitlement/request records untouched.
ALTER TABLE fee_invoice_self_payer_entitlements ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE fee_invoice_self_payer_entitlements ADD COLUMN invoice_person_id uuid;
ALTER TABLE fee_invoice_self_payer_entitlements ADD CONSTRAINT fee_self_payer_beneficiary_context CHECK(
  student_id IS NOT NULL AND invoice_person_id IS NULL OR student_id IS NULL AND invoice_person_id IS NOT NULL AND invoice_person_id=person_id);
ALTER TABLE fee_invoice_self_payer_entitlements ADD FOREIGN KEY(school_id,invoice_id,invoice_person_id) REFERENCES fee_invoices(school_id,id,person_id),
  ADD UNIQUE(school_id,id,invoice_id,invoice_person_id);
CREATE INDEX fee_self_payer_invoice_person ON fee_invoice_self_payer_entitlements(school_id,invoice_id,invoice_person_id) WHERE invoice_person_id IS NOT NULL;
ALTER TABLE fee_instalment_requests ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE fee_instalment_requests ADD COLUMN beneficiary_person_id uuid;
ALTER TABLE fee_instalment_requests ADD CONSTRAINT fee_request_beneficiary_context CHECK(
  student_id IS NOT NULL AND beneficiary_person_id IS NULL OR student_id IS NULL AND beneficiary_person_id IS NOT NULL);
ALTER TABLE fee_instalment_requests ADD FOREIGN KEY(school_id,invoice_id,beneficiary_person_id) REFERENCES fee_invoices(school_id,id,person_id),
  ADD FOREIGN KEY(school_id,entitlement_id,invoice_id,beneficiary_person_id) REFERENCES fee_invoice_self_payer_entitlements(school_id,id,invoice_id,invoice_person_id);
CREATE INDEX fee_instalment_invoice_person ON fee_instalment_requests(school_id,invoice_id,beneficiary_person_id) WHERE beneficiary_person_id IS NOT NULL;

-- New person events name their exact invoice; existing student event semantics are preserved.
ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) RENAME TO event_user_is_authorized_before_person_fees;
CREATE FUNCTION fee_invoice_event_is_authorized(event_school_id uuid,event_payload jsonb,candidate_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE WHEN event_payload ? 'person_id' THEN
    EXISTS(SELECT 1 FROM fee_invoices invoice JOIN school_memberships membership ON membership.school_id=invoice.school_id
      AND membership.user_id=candidate_user_id AND membership.is_active JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE invoice.school_id=event_school_id AND invoice.id::text=event_payload->>'invoice_id' AND invoice.person_id::text=event_payload->>'person_id'
        AND NOT event_payload ? 'student_id' AND campus_model_account_person_is_active(invoice.school_id,candidate_user_id,NULL,now()) AND (
          membership.role='admin' OR membership.role='staff' AND (
            EXISTS(SELECT 1 FROM staff_role_bindings b WHERE b.school_id=invoice.school_id AND b.user_id=candidate_user_id AND b.status='active'
              AND b.role_active AND b.starts_on<=current_date AND(b.ends_on IS NULL OR b.ends_on>=current_date) AND 'fees.manage'=ANY(b.permissions))
            OR EXISTS(SELECT 1 FROM school_access_exceptions x WHERE x.school_id=invoice.school_id AND x.user_id=candidate_user_id
              AND x.permission='fees.manage' AND x.status='active' AND current_date BETWEEN x.valid_from AND x.valid_until))
          OR campus_model_account_person_is_active(invoice.school_id,candidate_user_id,invoice.person_id,now())
            AND EXISTS(SELECT 1 FROM fee_invoice_self_payer_entitlements entitlement JOIN schools school ON school.id=entitlement.school_id
              WHERE entitlement.school_id=invoice.school_id AND entitlement.invoice_id=invoice.id AND entitlement.person_id=invoice.person_id
                AND entitlement.user_id=candidate_user_id AND (now() AT TIME ZONE school.timezone)::date BETWEEN entitlement.valid_from AND entitlement.valid_until
                AND NOT EXISTS(SELECT 1 FROM fee_invoice_self_payer_revocations revocation WHERE revocation.school_id=entitlement.school_id AND revocation.entitlement_id=entitlement.id))))
    ELSE event_user_is_authorized_before_person_fees(event_school_id,'fees.updated',event_payload,candidate_user_id) END
$$;
CREATE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE WHEN event_name IN ('fees.updated','finance.charge.issued','finance.instalment.requested','finance.instalment.decided',
    'finance.instalment.withdrawn','finance.self_payer.enabled','finance.self_payer.revoked') AND event_payload ? 'person_id'
    THEN fee_invoice_event_is_authorized(event_school_id,event_payload,candidate_user_id)
    ELSE event_user_is_authorized_before_person_fees(event_school_id,event_name,event_payload,candidate_user_id) END
$$;
REVOKE ALL ON FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION fee_invoice_event_is_authorized(uuid,jsonb,uuid) FROM PUBLIC;
DO $$ DECLARE owner_name text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='fee_invoices'::regclass;
  EXECUTE format('ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION fee_invoice_event_is_authorized(uuid,jsonb,uuid) OWNER TO %I',owner_name);
END $$;
