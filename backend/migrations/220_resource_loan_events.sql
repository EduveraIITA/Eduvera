-- Resources refreshes carry source addresses, never private questions or a grant.
-- The owning domain completes its internal source event before enqueueing the
-- public refresh, in the same transaction. Earlier event guards remain intact.
CREATE FUNCTION institution_resource_actor_can_manage(tenant uuid,actor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO public AS $$
  SELECT EXISTS(SELECT 1 FROM school_memberships membership
    JOIN users account ON account.id=membership.user_id AND account.is_active
    WHERE membership.school_id=tenant AND membership.user_id=actor AND membership.is_active AND (
      membership.role='admin' OR membership.role='staff' AND (
        EXISTS(SELECT 1 FROM staff_role_bindings binding
          WHERE binding.school_id=tenant AND binding.user_id=actor AND binding.context_kind='institution'
            AND binding.scope_id=tenant AND binding.status='active' AND binding.role_active
            AND 'resources.manage'=ANY(binding.permissions)
            AND campus_permission_date(tenant) BETWEEN binding.starts_on AND coalesce(binding.ends_on,'infinity'::date))
        OR EXISTS(SELECT 1 FROM school_access_exceptions exception
          WHERE exception.school_id=tenant AND exception.user_id=actor AND exception.permission='resources.manage'
            AND exception.scope_kind='institution' AND exception.status='active'
            AND campus_permission_date(tenant) BETWEEN exception.valid_from AND exception.valid_until))))
$$;

CREATE FUNCTION resource_loan_event_source_is_valid(institution uuid,event_name text,aggregate_kind text,aggregate uuid,event_payload jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO public AS $$
DECLARE v_revision integer;v_action text;v_command_type text;v_public boolean;
BEGIN
  v_public:=event_name IS NOT DISTINCT FROM 'resources.updated';
  IF jsonb_typeof(event_payload) IS DISTINCT FROM 'object'
    OR NOT(event_payload ?& ARRAY['loan_id','revision','action','command_id'])
    OR (event_payload-CASE WHEN v_public THEN ARRAY['loan_id','revision','action','command_id','refresh']
        ELSE ARRAY['loan_id','revision','action','command_id'] END)<>'{}'::jsonb
    OR jsonb_typeof(event_payload->'loan_id') IS DISTINCT FROM 'string'
    OR aggregate::text IS DISTINCT FROM event_payload->>'loan_id'
    OR jsonb_typeof(event_payload->'revision') IS DISTINCT FROM 'number'
    OR coalesce(event_payload->>'revision','') !~ '^[1-9][0-9]{0,8}$'
    OR jsonb_typeof(event_payload->'action') IS DISTINCT FROM 'string'
    OR jsonb_typeof(event_payload->'command_id') IS DISTINCT FROM 'string'
    OR aggregate_kind IS DISTINCT FROM (CASE WHEN v_public THEN 'resource_loan' ELSE 'resource_loan_event' END)
    OR v_public AND event_payload->'refresh' IS DISTINCT FROM '["resources","workspace","attention"]'::jsonb
  THEN RETURN false; END IF;
  v_revision:=(event_payload->>'revision')::integer;v_action:=event_payload->>'action';
  v_command_type:=CASE v_action
    WHEN 'issued' THEN 'resource_loans.issue'
    WHEN 'return_recorded' THEN 'resource_loans.return.record'
    WHEN 'return_corrected' THEN 'resource_loans.return.correct'
    WHEN 'due_changed' THEN 'resource_loans.due.change'
    WHEN 'question_asked' THEN 'resource_loans.question.ask'
    WHEN 'replied' THEN 'resource_loans.question.reply'
    WHEN 'resolved' THEN 'resource_loans.question.resolve' ELSE NULL END;
  IF v_command_type IS NULL OR NOT v_public AND event_name IS DISTINCT FROM 'resource_loans.'||v_action
  THEN RETURN false; END IF;
  RETURN EXISTS(SELECT 1 FROM resource_loans loan
    JOIN resource_loan_receipts receipt ON receipt.school_id=loan.school_id AND receipt.loan_id=loan.id
      AND receipt.revision=v_revision AND receipt.action=v_action AND receipt.command_id::text=event_payload->>'command_id'
    JOIN campus_model_commands command ON command.id=receipt.command_id AND command.school_id=loan.school_id
      AND command.source_domain='resource_loans' AND command.handler_key='resource_loans.commands' AND command.handler_version=1
      AND command.command_type=v_command_type AND command.state='accepted' AND command.expected_revision=v_revision-1
      AND command.safe_context->>'loan_id'=loan.id::text
    JOIN campus_model_entities entity ON entity.id=command.target_entity_id AND entity.school_id=loan.school_id
      AND entity.realm_id=command.realm_id AND entity.environment_namespace_id=command.environment_namespace_id
      AND entity.domain='resource_loans' AND entity.kind='resource_loan' AND entity.domain_id=loan.id::text
    JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
      AND outcome.realm_id=command.realm_id AND outcome.environment_namespace_id=command.environment_namespace_id
      AND outcome.status='accepted' AND outcome.resulting_revision=v_revision
      AND outcome.metadata->>'id'=loan.id::text AND outcome.metadata->>'revision'=v_revision::text
    JOIN event_outbox source_event ON source_event.id=outcome.domain_event_id AND source_event.school_id=loan.school_id
      AND source_event.event_type='resource_loans.'||v_action AND source_event.aggregate_type='resource_loan_event'
      AND source_event.aggregate_id=loan.id AND source_event.payload=jsonb_build_object(
        'loan_id',loan.id::text,'revision',v_revision,'action',v_action,'command_id',command.id::text)
    JOIN campus_model_events accepted_event ON accepted_event.source_outbox_event_id=source_event.id
      AND accepted_event.school_id=loan.school_id AND accepted_event.realm_id=command.realm_id
      AND accepted_event.environment_namespace_id=command.environment_namespace_id
      AND accepted_event.actor_agent_id=command.actor_agent_id AND accepted_event.source_domain='resource_loans'
      AND accepted_event.source_record_id=loan.id::text AND accepted_event.source_revision=v_revision
      AND accepted_event.event_type=source_event.event_type AND accepted_event.payload=source_event.payload
    JOIN campus_model_agents signer ON signer.id=command.actor_agent_id AND signer.school_id=loan.school_id
      AND signer.person_id=receipt.actor_person_id
    JOIN operational_realms realm ON realm.id=command.realm_id AND realm.legacy_school_id=loan.school_id AND realm.status='active'
    JOIN execution_environment_namespaces address ON address.realm_id=command.realm_id
      AND address.namespace_id=command.environment_namespace_id AND address.status='active'
      AND address.environment_kind=CASE WHEN current_schema()='public' THEN 'live' ELSE 'simulation' END
    WHERE loan.school_id=institution AND loan.id=aggregate AND loan.revision>=v_revision
      AND command.environment_namespace_id=coalesce(nullif(current_setting('thatcampus.namespace_id',true),''),
        CASE WHEN current_schema()='public' THEN 'live:'||institution::text END)
      AND EXISTS(SELECT 1 FROM campus_model_agent_endpoints endpoint
        WHERE endpoint.school_id=loan.school_id AND endpoint.agent_id=signer.id AND endpoint.user_id=receipt.actor_user_id
          AND endpoint.endpoint_kind='account' AND endpoint.effective_from<=command.requested_at
          AND(endpoint.effective_until IS NULL OR endpoint.effective_until>command.requested_at)));
END $$;

CREATE FUNCTION resource_loan_event_is_authorized(institution uuid,event_payload jsonb,candidate uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO public AS $$
  SELECT EXISTS(SELECT 1 FROM resource_loans loan
    JOIN school_memberships membership ON membership.school_id=loan.school_id AND membership.user_id=candidate AND membership.is_active
    JOIN users account ON account.id=membership.user_id AND account.is_active
    WHERE loan.school_id=institution AND loan.id::text=event_payload->>'loan_id' AND (
      campus_model_account_person_is_active(institution,candidate,loan.borrower_person_id,now())
      OR campus_model_account_person_is_active(institution,candidate,loan.custodian_person_id,now())
        AND institution_resource_actor_can_manage(institution,candidate)))
$$;

-- Preserve OIDs and every previous Finance/Teaching/Attendance dispatch branch.
-- Internal journal envelopes are never client updates, even if an audience is
-- maliciously supplied. They precede Core completion and remain commit-guarded.
DO $$ DECLARE previous_body text; BEGIN
  SELECT prosrc INTO STRICT previous_body FROM pg_proc WHERE oid='event_user_is_authorized(uuid,text,jsonb,uuid)'::regprocedure;
  previous_body:=regexp_replace(btrim(previous_body),';\s*$','');
  EXECUTE format($definition$
    CREATE OR REPLACE FUNCTION event_user_is_authorized(event_school_id uuid,event_name text,event_payload jsonb,candidate_user_id uuid)
    RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO public AS $resource_audience_220$
      SELECT CASE WHEN event_name LIKE 'resource_loans.%%' THEN false
        WHEN event_name LIKE 'resources.%%' THEN event_name='resources.updated'
          AND resource_loan_event_is_authorized(event_school_id,event_payload,candidate_user_id)
        ELSE (%s) END
    $resource_audience_220$
  $definition$,previous_body);
  SELECT prosrc INTO STRICT previous_body FROM pg_proc WHERE oid='event_source_is_valid(uuid,text,text,uuid,jsonb)'::regprocedure;
  previous_body:=regexp_replace(btrim(previous_body),';\s*$','');
  EXECUTE format($definition$
    CREATE OR REPLACE FUNCTION event_source_is_valid(institution uuid,event_name text,aggregate_kind text,aggregate uuid,event_payload jsonb)
    RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO public AS $resource_source_220$
      SELECT CASE WHEN event_name LIKE 'resources.%%' OR aggregate_kind='resource_loan'
        THEN event_name='resources.updated' AND resource_loan_event_source_is_valid(institution,event_name,aggregate_kind,aggregate,event_payload)
        ELSE (%s) END
    $resource_source_220$
  $definition$,previous_body);
END $$;

CREATE FUNCTION validate_resource_loan_refresh() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO public AS $$
BEGIN
  IF TG_OP='UPDATE' AND(OLD.event_type LIKE 'resources.%' OR OLD.event_type LIKE 'resource_loans.%'
    OR OLD.aggregate_type IN('resource_loan','resource_loan_event') OR NEW.event_type LIKE 'resources.%'
    OR NEW.event_type LIKE 'resource_loans.%' OR NEW.aggregate_type IN('resource_loan','resource_loan_event')) THEN
    IF ROW(NEW.id,NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload,NEW.audience_user_ids,
        NEW.notification_user_ids,NEW.notification_payload,NEW.idempotency_key,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.school_id,OLD.event_type,OLD.aggregate_type,OLD.aggregate_id,OLD.payload,OLD.audience_user_ids,
        OLD.notification_user_ids,OLD.notification_payload,OLD.idempotency_key,OLD.created_at)
    THEN RAISE EXCEPTION 'Resource loan envelopes are immutable; publish a new source event' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.event_type LIKE 'resources.%' OR NEW.event_type LIKE 'resource_loans.%'
    OR NEW.aggregate_type IN('resource_loan','resource_loan_event') THEN
    IF cardinality(NEW.notification_user_ids)>0 OR NEW.notification_payload IS NOT NULL
      OR NEW.event_type LIKE 'resource_loans.%' AND(cardinality(NEW.audience_user_ids)>0 OR NEW.aggregate_type<>'resource_loan_event')
      OR NEW.event_type LIKE 'resources.%' AND NOT coalesce(resource_loan_event_source_is_valid(
        NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload),false)
      OR EXISTS(SELECT 1 FROM unnest(NEW.audience_user_ids) recipient WHERE NOT coalesce(
        resource_loan_event_is_authorized(NEW.school_id,NEW.payload,recipient),false))
    THEN RAISE EXCEPTION 'Resources refresh must match neutral accepted source evidence and current recipients' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_loan_refresh_scope BEFORE INSERT OR UPDATE ON event_outbox
FOR EACH ROW EXECUTE FUNCTION validate_resource_loan_refresh();

CREATE FUNCTION validate_resource_loan_event_completion() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO public AS $$
BEGIN
  IF(NEW.event_type LIKE 'resources.%' OR NEW.event_type LIKE 'resource_loans.%'
    OR NEW.aggregate_type IN('resource_loan','resource_loan_event')) AND NOT coalesce(resource_loan_event_source_is_valid(
      NEW.school_id,NEW.event_type,NEW.aggregate_type,NEW.aggregate_id,NEW.payload),false)
  THEN RAISE EXCEPTION 'Resource loan event requires its exact accepted source command in the selected world' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER resource_loan_event_completion AFTER INSERT ON event_outbox
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_resource_loan_event_completion();

-- Native custody evidence cannot advance a loan on its own. Even an insert
-- without an outbox envelope must own the same accepted command, journal and
-- exact internal source envelope when the transaction commits.
CREATE FUNCTION validate_resource_loan_receipt_completion() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO public AS $$
BEGIN
  IF NOT coalesce(resource_loan_event_source_is_valid(NEW.school_id,'resource_loans.'||NEW.action,
    'resource_loan_event',NEW.loan_id,jsonb_build_object('loan_id',NEW.loan_id::text,
      'revision',NEW.revision,'action',NEW.action,'command_id',NEW.command_id::text)),false)
  THEN RAISE EXCEPTION 'Resource loan receipt requires its exact accepted command and source envelope in the selected world' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER resource_loan_receipt_completion AFTER INSERT ON resource_loan_receipts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_resource_loan_receipt_completion();

-- The kit quantities belong to the still-pending owning action. A later
-- INSERT must not extend a previously accepted immutable receipt silently.
CREATE OR REPLACE FUNCTION guard_resource_loan_return_part() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM resource_loan_receipts receipt
    JOIN campus_model_commands command ON command.id=receipt.command_id
      AND command.school_id=receipt.school_id AND command.state='pending'
    WHERE receipt.id=NEW.receipt_id AND receipt.school_id=NEW.school_id
      AND receipt.loan_id=NEW.loan_id AND receipt.action IN('return_recorded','return_corrected'))
  THEN RAISE EXCEPTION 'Received component quantities require an exact pending return receipt' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION institution_resource_actor_can_manage(uuid,uuid),resource_loan_event_source_is_valid(uuid,text,text,uuid,jsonb),
  resource_loan_event_is_authorized(uuid,jsonb,uuid),validate_resource_loan_refresh(),validate_resource_loan_event_completion(),
  validate_resource_loan_receipt_completion() FROM PUBLIC;
DO $$ DECLARE owner_name text;role_name text;signature text;BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='event_outbox'::regclass;
  FOREACH signature IN ARRAY ARRAY['institution_resource_actor_can_manage(uuid,uuid)','resource_loan_event_source_is_valid(uuid,text,text,uuid,jsonb)',
    'resource_loan_event_is_authorized(uuid,jsonb,uuid)','validate_resource_loan_refresh()','validate_resource_loan_event_completion()',
    'validate_resource_loan_receipt_completion()'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO %I',signature,owner_name);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',signature,role_name); END IF;
    END LOOP;
  END LOOP;
END $$;

-- Exercise the complete predicate without needing a loan fixture. A malformed
-- PL/pgSQL query must fail this migration, not the first real source event.
DO $$ DECLARE absent uuid:='00000000-0000-0000-0000-000000000000';BEGIN
  IF resource_loan_event_source_is_valid(absent,'resources.updated','resource_loan',absent,
    jsonb_build_object('loan_id',absent::text,'revision',1,'action','issued','command_id',absent::text,
      'refresh',jsonb_build_array('resources','workspace','attention'))) IS DISTINCT FROM false
  THEN RAISE EXCEPTION 'An absent resource loan must not validate';END IF;
END $$;
