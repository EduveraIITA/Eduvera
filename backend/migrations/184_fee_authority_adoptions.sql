-- Confirmation registers existing, bounded Finance authority. It creates no
-- person, office, appointment, source, mandate or application permission.
CREATE TABLE fee_authority_adoptions (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id),
  rule_id uuid NOT NULL,
  rule_revision integer NOT NULL CHECK(rule_revision > 0),
  mandate_id uuid NOT NULL,
  mandate_revision integer NOT NULL CHECK(mandate_revision > 0),
  office_id uuid NOT NULL,
  office_revision integer NOT NULL CHECK(office_revision > 0),
  appointment_id uuid NOT NULL,
  appointment_revision integer NOT NULL CHECK(appointment_revision > 0),
  source_revisions jsonb NOT NULL CHECK(jsonb_typeof(source_revisions)='array' AND jsonb_array_length(source_revisions)>0),
  max_amount_paise bigint CHECK(max_amount_paise > 0),
  confirmed_by uuid NOT NULL REFERENCES users(id),
  person_id uuid NOT NULL,
  command_id uuid NOT NULL,
  attestation boolean NOT NULL CHECK(attestation),
  created_at timestamptz NOT NULL,
  UNIQUE(school_id,id), UNIQUE(school_id,rule_id,rule_revision), UNIQUE(school_id,command_id),
  FOREIGN KEY(school_id,rule_id) REFERENCES institution_decision_matter_rules(school_id,id),
  FOREIGN KEY(school_id,mandate_id) REFERENCES institution_authority_mandates(school_id,id),
  FOREIGN KEY(school_id,office_id) REFERENCES institution_governance_offices(school_id,id),
  FOREIGN KEY(school_id,appointment_id) REFERENCES institution_governance_appointments(school_id,id),
  FOREIGN KEY(school_id,person_id) REFERENCES school_people(school_id,id)
);
CREATE INDEX fee_authority_adoption_mandate ON fee_authority_adoptions(school_id,mandate_id);
CREATE INDEX fee_authority_adoption_office ON fee_authority_adoptions(school_id,office_id);
CREATE INDEX fee_authority_adoption_appointment ON fee_authority_adoptions(school_id,appointment_id);
CREATE INDEX fee_authority_adoption_person ON fee_authority_adoptions(school_id,person_id);
CREATE TABLE fee_authority_route_approvals (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id),
  adoption_id uuid NOT NULL,
  revision integer NOT NULL CHECK(revision > 0),
  configuration_hash char(64) NOT NULL,
  confirmed_by uuid NOT NULL REFERENCES users(id),
  command_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(school_id,id), UNIQUE(school_id,adoption_id,revision), UNIQUE(school_id,command_id),
  FOREIGN KEY(school_id,adoption_id) REFERENCES fee_authority_adoptions(school_id,id)
);
CREATE TRIGGER fee_authority_route_approval_immutable BEFORE UPDATE OR DELETE ON fee_authority_route_approvals
  FOR EACH ROW EXECUTE FUNCTION protect_fee_record();
CREATE TRIGGER fee_authority_adoption_immutable BEFORE UPDATE OR DELETE ON fee_authority_adoptions
  FOR EACH ROW EXECUTE FUNCTION protect_fee_record();
ALTER TABLE fee_authority_adoptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_authority_route_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE fee_authority_adoptions FROM PUBLIC;
REVOKE ALL ON TABLE fee_authority_route_approvals FROM PUBLIC;
DO $$ DECLARE owner_name text; BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE fee_authority_adoptions,fee_authority_route_approvals FROM anon; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE fee_authority_adoptions,fee_authority_route_approvals FROM authenticated; END IF;
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='institution_decision_matter_rules'::regclass;
  EXECUTE format('ALTER TABLE fee_authority_adoptions OWNER TO %I',owner_name);
  EXECUTE format('ALTER TABLE fee_authority_route_approvals OWNER TO %I',owner_name);
END $$;
