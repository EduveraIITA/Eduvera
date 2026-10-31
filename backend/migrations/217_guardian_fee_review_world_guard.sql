-- Strengthen the unified guardian adapter's accepted-command evidence with its
-- exact selected realm/world. A copied Live receipt is not a fresh COW effect.
CREATE OR REPLACE FUNCTION fee_guardian_review_completion_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE signer uuid; review_identity uuid; action_name text; BEGIN
  IF NEW.import_provenance IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='fee_native_review_requests' THEN
    IF NEW.route_kind<>'guardian_queue' THEN RETURN NEW; END IF;
    signer:=NEW.submitted_by; review_identity:=NEW.id; action_name:='report';
  ELSE
    IF NOT EXISTS(SELECT 1 FROM fee_native_review_requests WHERE id=NEW.review_id AND school_id=NEW.school_id AND route_kind='guardian_queue') THEN RETURN NEW; END IF;
    signer:=NEW.reviewed_by; review_identity:=NEW.review_id; action_name:='decide';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM campus_model_commands c
    JOIN campus_model_command_outcomes o ON o.command_id=c.id AND o.status='accepted'
      AND o.realm_id=c.realm_id AND o.environment_namespace_id=c.environment_namespace_id
    JOIN campus_model_entities e ON e.id=c.target_entity_id AND e.realm_id=c.realm_id AND e.environment_namespace_id=c.environment_namespace_id
    JOIN campus_model_agents a ON a.id=c.actor_agent_id AND a.school_id=c.school_id
    JOIN operational_realms realm ON realm.id=c.realm_id AND realm.legacy_school_id=c.school_id AND realm.status='active'
    JOIN execution_environment_namespaces address ON address.realm_id=c.realm_id AND address.namespace_id=c.environment_namespace_id
      AND address.status='active' AND address.environment_kind=CASE WHEN current_schema()='public' THEN 'live' ELSE 'simulation' END
    WHERE c.school_id=NEW.school_id AND c.source_domain='finance' AND c.handler_key='finance.payment_review' AND c.handler_version=1
      AND c.environment_namespace_id=COALESCE(NULLIF(current_setting('thatcampus.namespace_id',true),''),
        CASE WHEN current_schema()='public' THEN 'live:'||NEW.school_id::text END)
      AND c.command_type='finance.payment_review.'||action_name AND c.state='accepted'
      AND c.idempotency_key='native-fee-review:'||signer::text||':'||NEW.command_id::text
      AND c.safe_context->>'review_id'=review_identity::text AND e.kind='fee_invoice' AND e.domain='finance' AND e.domain_id=NEW.invoice_id::text
      AND o.metadata->>'id'=review_identity::text AND o.metadata->>'invoice_id'=NEW.invoice_id::text
      AND a.person_id=CASE WHEN TG_TABLE_NAME='fee_native_review_requests' THEN to_jsonb(NEW)->>'submitter_person_id' ELSE to_jsonb(NEW)->>'reviewer_person_id' END::uuid
      AND EXISTS(SELECT 1 FROM campus_model_agent_endpoints ep WHERE ep.school_id=c.school_id AND ep.agent_id=a.id AND ep.user_id=signer
        AND ep.endpoint_kind='account' AND ep.status='active' AND ep.effective_from<=c.requested_at AND(ep.effective_until IS NULL OR ep.effective_until>c.requested_at)))
  THEN RAISE EXCEPTION 'Guardian Finance review requires its exact accepted current-actor Core command in the selected world'; END IF;
  RETURN NEW;
END $$;
