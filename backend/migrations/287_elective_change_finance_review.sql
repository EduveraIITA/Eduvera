-- Dated elective proposals and explicit Finance classifications. No money is posted here.
CREATE TABLE learning_elective_changes (
  id uuid PRIMARY KEY, school_id uuid NOT NULL REFERENCES schools(id), person_id uuid NOT NULL,
  source_offering_id uuid NOT NULL, destination_offering_id uuid NOT NULL, source_enrollment_id uuid NOT NULL,
  selection jsonb NOT NULL CHECK(jsonb_typeof(selection)='object'), preview jsonb NOT NULL CHECK(jsonb_typeof(preview)='object'),
  preview_fingerprint text NOT NULL CHECK(preview_fingerprint ~ '^[a-f0-9]{64}$'),
  reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
  catch_up jsonb NOT NULL CHECK(catch_up->>'kind' IN ('not_needed','plan')),
  created_by uuid NOT NULL REFERENCES users(id), command_id uuid NOT NULL REFERENCES campus_model_commands(id), created_at timestamptz NOT NULL,
  CHECK(source_offering_id<>destination_offering_id), UNIQUE(school_id,id),
  FOREIGN KEY(school_id,person_id) REFERENCES school_people(school_id,id),
  FOREIGN KEY(school_id,source_offering_id) REFERENCES learning_offerings(school_id,id),
  FOREIGN KEY(school_id,destination_offering_id) REFERENCES learning_offerings(school_id,id),
  FOREIGN KEY(school_id,source_offering_id,source_enrollment_id) REFERENCES learning_offering_enrollments(school_id,offering_id,id)
);
CREATE TABLE learning_elective_change_actions (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, change_id uuid NOT NULL,
  revision integer NOT NULL CHECK(revision>0), kind text NOT NULL CHECK(kind IN ('request','finance.assign','finance.classify','apply','withdraw')),
  actor_id uuid NOT NULL REFERENCES users(id), command_id uuid NOT NULL REFERENCES campus_model_commands(id),
  data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'), created_at timestamptz NOT NULL,
  UNIQUE(school_id,change_id,revision), FOREIGN KEY(school_id,change_id) REFERENCES learning_elective_changes(school_id,id)
);
CREATE TABLE fee_elective_change_reviews (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, change_id uuid NOT NULL, action_id uuid NOT NULL,
  reviewer_id uuid NOT NULL REFERENCES users(id), reviewer_person_id uuid NOT NULL,
  reviewer_eligibility_hash text NOT NULL CHECK(reviewer_eligibility_hash ~ '^[a-f0-9]{64}$'),
  outcome text NOT NULL CHECK(outcome IN ('no_financial_change','requires_financial_review')),
  ledger_basis_hash text NOT NULL CHECK(ledger_basis_hash ~ '^[a-f0-9]{64}$'),
  ledger_basis jsonb NOT NULL CHECK(jsonb_typeof(ledger_basis)='object'),
  reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 1000),
  created_at timestamptz NOT NULL, UNIQUE(school_id,id), UNIQUE(school_id,action_id),
  FOREIGN KEY(school_id,change_id) REFERENCES learning_elective_changes(school_id,id),
  FOREIGN KEY(school_id,reviewer_person_id) REFERENCES school_people(school_id,id),
  FOREIGN KEY(action_id) REFERENCES learning_elective_change_actions(id)
);
CREATE TABLE learning_elective_change_refusals (
  id uuid PRIMARY KEY, school_id uuid NOT NULL REFERENCES schools(id), source_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id), command_id uuid NOT NULL REFERENCES campus_model_commands(id), client_command_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('request','finance.assign','finance.classify','apply','withdraw')),
  expected_revision integer NOT NULL CHECK(expected_revision>=0), payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
  reviewed_request jsonb NOT NULL CHECK(jsonb_typeof(reviewed_request)='object'),
  message text NOT NULL CHECK(length(message) BETWEEN 1 AND 500), created_at timestamptz NOT NULL,
  UNIQUE(school_id,command_id), UNIQUE(school_id,actor_id,client_command_id)
);
CREATE INDEX learning_elective_changes_person ON learning_elective_changes(school_id,person_id,created_at DESC);
CREATE INDEX learning_elective_changes_source ON learning_elective_changes(school_id,source_offering_id,created_at DESC);
CREATE INDEX fee_elective_change_review_current ON fee_elective_change_reviews(school_id,change_id,created_at DESC,id);
CREATE INDEX elective_refusal_source ON learning_elective_change_refusals(school_id,source_id,actor_id,created_at DESC);
CREATE TRIGGER elective_change_immutable BEFORE UPDATE OR DELETE ON learning_elective_changes FOR EACH ROW EXECUTE FUNCTION learning_assignment_immutable_guard();
CREATE TRIGGER elective_action_immutable BEFORE UPDATE OR DELETE ON learning_elective_change_actions FOR EACH ROW EXECUTE FUNCTION learning_assignment_immutable_guard();
CREATE TRIGGER elective_finance_immutable BEFORE UPDATE OR DELETE ON fee_elective_change_reviews FOR EACH ROW EXECUTE FUNCTION learning_assignment_immutable_guard();
CREATE TRIGGER elective_change_no_truncate BEFORE TRUNCATE ON learning_elective_changes FOR EACH STATEMENT EXECUTE FUNCTION learning_assignment_immutable_guard();
CREATE TRIGGER elective_action_no_truncate BEFORE TRUNCATE ON learning_elective_change_actions FOR EACH STATEMENT EXECUTE FUNCTION learning_assignment_immutable_guard();
CREATE TRIGGER elective_finance_no_truncate BEFORE TRUNCATE ON fee_elective_change_reviews FOR EACH STATEMENT EXECUTE FUNCTION learning_assignment_immutable_guard();
CREATE TRIGGER elective_refusal_immutable BEFORE UPDATE OR DELETE ON learning_elective_change_refusals FOR EACH ROW EXECUTE FUNCTION learning_assignment_immutable_guard();
CREATE TRIGGER elective_refusal_no_truncate BEFORE TRUNCATE ON learning_elective_change_refusals FOR EACH STATEMENT EXECUTE FUNCTION learning_assignment_immutable_guard();

CREATE FUNCTION elective_change_action_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.revision=1 AND NEW.kind<>'request' OR NEW.revision>1 AND (NEW.kind='request' OR NOT EXISTS(
    SELECT 1 FROM learning_elective_change_actions previous WHERE previous.school_id=NEW.school_id AND previous.change_id=NEW.change_id
      AND previous.revision=NEW.revision-1 AND previous.kind NOT IN ('apply','withdraw')))
  THEN RAISE EXCEPTION 'Elective change action does not continue its exact open revision'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER elective_action_order BEFORE INSERT ON learning_elective_change_actions FOR EACH ROW EXECUTE FUNCTION elective_change_action_guard();

CREATE FUNCTION elective_change_command_required() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM campus_model_commands command
    JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.realm_id=command.realm_id
      AND outcome.environment_namespace_id=command.environment_namespace_id
    JOIN campus_model_entities target ON target.id=command.target_entity_id AND target.school_id=command.school_id
      AND target.realm_id=command.realm_id AND target.environment_namespace_id=command.environment_namespace_id
    JOIN campus_model_current_account_endpoints(NEW.school_id,NEW.actor_id,NEW.created_at) actor ON actor.agent_id=command.actor_agent_id AND actor.school_id=command.school_id
    WHERE command.id=NEW.command_id AND command.school_id=NEW.school_id
      AND command.environment_namespace_id=coalesce(nullif(current_setting('thatcampus.namespace_id',true),''),CASE WHEN current_schema()='public' THEN 'live:'||NEW.school_id::text END)
      AND command.source_domain='learning_elective' AND command.handler_key='learning.elective_change' AND command.handler_version=1
      AND command.command_type='learning.elective_change.'||NEW.kind
      AND command.expected_revision=NEW.revision-1 AND target.domain='learning_elective' AND target.kind='elective_change' AND target.domain_id=NEW.change_id::text
      AND command.state='accepted' AND outcome.status='accepted' AND outcome.resulting_revision=NEW.revision AND actor.user_id=NEW.actor_id
      AND outcome.metadata->>'id'=NEW.change_id::text AND outcome.metadata->>'action'=NEW.kind AND outcome.metadata->>'command_id'=command.correlation_id::text)
  THEN RAISE EXCEPTION 'Elective change requires its exact accepted current-world command'; END IF;
  IF NEW.kind='finance.classify' AND NOT EXISTS(SELECT 1 FROM fee_elective_change_reviews review
      WHERE review.school_id=NEW.school_id AND review.change_id=NEW.change_id AND review.action_id=NEW.id AND review.reviewer_id=NEW.actor_id
        AND review.id::text=NEW.data->>'decision_id' AND review.outcome=NEW.data->>'outcome')
  THEN RAISE EXCEPTION 'Elective classification requires its exact native Finance evidence'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER elective_accepted_command AFTER INSERT ON learning_elective_change_actions DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION elective_change_command_required();

CREATE FUNCTION elective_change_proposal_required() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM learning_elective_change_actions action WHERE action.school_id=NEW.school_id AND action.change_id=NEW.id
      AND action.kind='request' AND action.revision=1 AND action.actor_id=NEW.created_by AND action.command_id=NEW.command_id)
    OR NEW.person_id::text IS DISTINCT FROM NEW.selection#>>'{person,id}'
    OR NEW.source_offering_id::text IS DISTINCT FROM NEW.selection#>>'{source_offering,id}'
    OR NEW.destination_offering_id::text IS DISTINCT FROM NEW.selection#>>'{destination_offering,id}'
    OR NEW.source_enrollment_id::text IS DISTINCT FROM NEW.selection#>>'{source_enrollment,id}'
    OR NEW.preview_fingerprint IS DISTINCT FROM NEW.preview->>'fingerprint'
    OR NOT EXISTS(SELECT 1 FROM learning_offering_enrollments enrollment WHERE enrollment.school_id=NEW.school_id
      AND enrollment.offering_id=NEW.source_offering_id AND enrollment.id=NEW.source_enrollment_id AND enrollment.person_id=NEW.person_id)
  THEN RAISE EXCEPTION 'Elective proposal requires its exact canonical source and accepted request'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER elective_proposal_command AFTER INSERT ON learning_elective_changes DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION elective_change_proposal_required();
CREATE FUNCTION elective_finance_source_required() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM learning_elective_change_actions action WHERE action.school_id=NEW.school_id AND action.change_id=NEW.change_id
    AND action.id=NEW.action_id AND action.kind='finance.classify' AND action.actor_id=NEW.reviewer_id
    AND action.data->>'decision_id'=NEW.id::text AND action.data->>'outcome'=NEW.outcome)
  THEN RAISE EXCEPTION 'Finance classification does not match its exact owning action'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER elective_finance_source BEFORE INSERT ON fee_elective_change_reviews FOR EACH ROW EXECUTE FUNCTION elective_finance_source_required();

CREATE FUNCTION elective_refusal_command_required() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
      AND outcome.realm_id=command.realm_id AND outcome.environment_namespace_id=command.environment_namespace_id
    JOIN campus_model_entities target ON target.id=command.target_entity_id AND target.school_id=command.school_id AND target.realm_id=command.realm_id
      AND target.environment_namespace_id=command.environment_namespace_id
    JOIN campus_model_current_account_endpoints(NEW.school_id,NEW.actor_id,NEW.created_at) actor ON actor.agent_id=command.actor_agent_id AND actor.school_id=command.school_id
    WHERE command.id=NEW.command_id AND command.school_id=NEW.school_id AND command.source_domain='learning_elective'
      AND command.handler_key='learning.elective_change' AND command.handler_version=1 AND command.command_type='learning.elective_change.'||NEW.action
      AND command.correlation_id=NEW.client_command_id AND command.expected_revision=NEW.expected_revision AND command.state='conflicted' AND outcome.status='conflicted'
      AND target.kind='elective_change' AND target.domain='learning_elective' AND target.domain_id=NEW.source_id::text
      AND command.environment_namespace_id=coalesce(nullif(current_setting('thatcampus.namespace_id',true),''),CASE WHEN current_schema()='public' THEN 'live:'||NEW.school_id::text END)
      AND command.safe_context->>'payload_hash'=NEW.payload_hash AND outcome.metadata->>'refusal_id'=NEW.id::text)
  THEN RAISE EXCEPTION 'Elective refusal requires its exact terminal owning command'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER elective_refusal_command AFTER INSERT ON learning_elective_change_refusals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION elective_refusal_command_required();

DO $$ DECLARE item text; role_name text; owner_name text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='learning_offerings'::regclass;
  FOREACH item IN ARRAY ARRAY['learning_elective_changes','learning_elective_change_actions','fee_elective_change_reviews','learning_elective_change_refusals'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item); EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',item);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',item,role_name); END IF;
    END LOOP;
    EXECUTE format('ALTER TABLE %I OWNER TO %I',item,owner_name);
  END LOOP;
END $$;
