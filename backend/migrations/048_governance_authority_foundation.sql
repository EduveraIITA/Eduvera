-- Governance authority is distinct from application access. These records describe
-- where institutional powers come from, who currently holds offices/seats, and
-- which route applies to each material decision.

ALTER TABLE institution_governance_audits
  DROP CONSTRAINT institution_governance_audits_target_type_check,
  ADD CONSTRAINT institution_governance_audits_target_type_check CHECK (target_type IN (
    'regulatory_profile','policy_version','policy_acknowledgement','authority_setup',
    'authority_source','office','body','seat','appointment','mandate','decision_rule'
  ));

CREATE TABLE institution_authority_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  code varchar(64) NOT NULL,
  title varchar(180) NOT NULL,
  source_kind varchar(32) NOT NULL CHECK (source_kind IN (
    'law_regulation','affiliation_rule','governing_instrument','resolution',
    'appointment_order','delegation','owner_declaration','other'
  )),
  issuer varchar(180) NOT NULL DEFAULT '',
  jurisdiction varchar(120) NOT NULL DEFAULT '',
  reference varchar(240) NOT NULL DEFAULT '',
  provision varchar(240) NOT NULL DEFAULT '',
  evidence_reference varchar(500) NOT NULL DEFAULT '',
  verification_state varchar(20) NOT NULL DEFAULT 'draft' CHECK (verification_state IN (
    'draft','recorded','self_attested','verified','superseded'
  )),
  effective_from date,
  effective_until date,
  verified_by uuid REFERENCES users(id),
  verified_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id,code),
  UNIQUE (school_id,id),
  CHECK (code ~ '^[a-z][a-z0-9_]{2,63}$'),
  CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until >= effective_from),
  CHECK ((verification_state='verified') = (verified_by IS NOT NULL AND verified_at IS NOT NULL))
);

CREATE TABLE institution_governance_offices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  code varchar(64) NOT NULL,
  title varchar(160) NOT NULL,
  purpose varchar(500) NOT NULL DEFAULT '',
  authority_source_id uuid,
  status varchar(16) NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','active','retired')),
  created_by uuid NOT NULL REFERENCES users(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id,code),
  UNIQUE (school_id,id),
  FOREIGN KEY (school_id,authority_source_id) REFERENCES institution_authority_sources(school_id,id),
  CHECK (code ~ '^[a-z][a-z0-9_]{2,63}$')
);

CREATE TABLE institution_governance_bodies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  code varchar(64) NOT NULL,
  title varchar(180) NOT NULL,
  purpose varchar(500) NOT NULL DEFAULT '',
  authority_source_id uuid,
  collective_authority boolean NOT NULL DEFAULT true,
  status varchar(16) NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','active','retired')),
  created_by uuid NOT NULL REFERENCES users(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id,code),
  UNIQUE (school_id,id),
  FOREIGN KEY (school_id,authority_source_id) REFERENCES institution_authority_sources(school_id,id),
  CHECK (code ~ '^[a-z][a-z0-9_]{2,63}$')
);

CREATE TABLE institution_governance_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  body_id uuid NOT NULL,
  code varchar(64) NOT NULL,
  title varchar(160) NOT NULL,
  seat_kind varchar(20) NOT NULL DEFAULT 'ordinary' CHECK (seat_kind IN (
    'ordinary','chair','secretary','ex_officio','observer'
  )),
  voting_right varchar(20) NOT NULL DEFAULT 'voting' CHECK (voting_right IN (
    'voting','non_voting','conditional'
  )),
  qualifying_office_id uuid,
  required boolean NOT NULL DEFAULT true,
  term_months smallint CHECK (term_months IS NULL OR term_months BETWEEN 1 AND 120),
  status varchar(16) NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','active','retired')),
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id,body_id,code),
  UNIQUE (school_id,id),
  FOREIGN KEY (school_id,body_id) REFERENCES institution_governance_bodies(school_id,id) ON DELETE CASCADE,
  FOREIGN KEY (school_id,qualifying_office_id) REFERENCES institution_governance_offices(school_id,id),
  CHECK ((seat_kind='ex_officio') = (qualifying_office_id IS NOT NULL))
);

CREATE TABLE institution_governance_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  office_id uuid,
  seat_id uuid,
  person_id uuid NOT NULL,
  linked_user_id uuid REFERENCES users(id),
  appointment_kind varchar(20) NOT NULL DEFAULT 'appointed' CHECK (appointment_kind IN (
    'appointed','elected','nominated','ex_officio','acting'
  )),
  starts_on date NOT NULL,
  ends_on date,
  status varchar(16) NOT NULL DEFAULT 'proposed' CHECK (status IN (
    'proposed','active','future','suspended','ended'
  )),
  authority_source_id uuid,
  evidence_reference varchar(500) NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id,id),
  FOREIGN KEY (school_id,office_id) REFERENCES institution_governance_offices(school_id,id),
  FOREIGN KEY (school_id,seat_id) REFERENCES institution_governance_seats(school_id,id),
  FOREIGN KEY (school_id,person_id) REFERENCES school_people(school_id,id),
  FOREIGN KEY (school_id,authority_source_id) REFERENCES institution_authority_sources(school_id,id),
  CHECK ((office_id IS NOT NULL)::integer + (seat_id IS NOT NULL)::integer = 1),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE UNIQUE INDEX institution_active_office_appointment_idx
  ON institution_governance_appointments(office_id)
  WHERE office_id IS NOT NULL AND status IN ('active','future');
CREATE UNIQUE INDEX institution_active_seat_appointment_idx
  ON institution_governance_appointments(seat_id)
  WHERE seat_id IS NOT NULL AND status IN ('active','future');
CREATE INDEX institution_governance_appointment_user_idx
  ON institution_governance_appointments(school_id,linked_user_id,status,starts_on)
  WHERE linked_user_id IS NOT NULL;

CREATE TABLE institution_authority_mandates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  code varchar(64) NOT NULL,
  title varchar(180) NOT NULL,
  authority_source_id uuid NOT NULL,
  holder_office_id uuid,
  holder_body_id uuid,
  responsibility_type_id uuid,
  powers text[] NOT NULL,
  matter_codes text[] NOT NULL,
  limit_summary varchar(500) NOT NULL DEFAULT '',
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_from date NOT NULL,
  effective_until date,
  delegable boolean NOT NULL DEFAULT false,
  status varchar(16) NOT NULL DEFAULT 'suggested' CHECK (status IN (
    'suggested','active','suspended','revoked','expired'
  )),
  created_by uuid NOT NULL REFERENCES users(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id,code),
  UNIQUE (school_id,id),
  FOREIGN KEY (school_id,authority_source_id) REFERENCES institution_authority_sources(school_id,id),
  FOREIGN KEY (school_id,holder_office_id) REFERENCES institution_governance_offices(school_id,id),
  FOREIGN KEY (school_id,holder_body_id) REFERENCES institution_governance_bodies(school_id,id),
  FOREIGN KEY (school_id,responsibility_type_id) REFERENCES staff_responsibility_types(school_id,id),
  CHECK ((holder_office_id IS NOT NULL)::integer + (holder_body_id IS NOT NULL)::integer + (responsibility_type_id IS NOT NULL)::integer = 1),
  CHECK (cardinality(powers) > 0 AND cardinality(matter_codes) > 0),
  CHECK (powers <@ ARRAY['propose','recommend','decide','adopt','publish','execute','appoint','delegate','inspect','verify','appeal']::text[]),
  CHECK (effective_until IS NULL OR effective_until >= effective_from)
);

CREATE TABLE institution_decision_matter_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  code varchar(64) NOT NULL,
  title varchar(180) NOT NULL,
  category varchar(32) NOT NULL CHECK (category IN (
    'academic','finance','people','safety','policy','operations','admission','complaint','other'
  )),
  initiation_summary varchar(300) NOT NULL DEFAULT '',
  review_summary varchar(500) NOT NULL DEFAULT '',
  decision_summary varchar(500) NOT NULL,
  execution_summary varchar(500) NOT NULL,
  decision_mode varchar(20) NOT NULL CHECK (decision_mode IN (
    'standing','delegated','individual','collective','external','combined'
  )),
  decision_office_id uuid,
  decision_body_id uuid,
  standing_mandate_id uuid,
  authority_source_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  conditions_summary varchar(600) NOT NULL DEFAULT '',
  material_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  status varchar(16) NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','confirmed','retired')),
  effective_from date,
  effective_until date,
  created_by uuid NOT NULL REFERENCES users(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id,code),
  UNIQUE (school_id,id),
  FOREIGN KEY (school_id,decision_office_id) REFERENCES institution_governance_offices(school_id,id),
  FOREIGN KEY (school_id,decision_body_id) REFERENCES institution_governance_bodies(school_id,id),
  FOREIGN KEY (school_id,standing_mandate_id) REFERENCES institution_authority_mandates(school_id,id),
  CHECK ((decision_mode='standing') = (standing_mandate_id IS NOT NULL)),
  CHECK (decision_office_id IS NULL OR decision_body_id IS NULL),
  CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until >= effective_from)
);
CREATE INDEX institution_decision_rule_status_idx
  ON institution_decision_matter_rules(school_id,status,category,title);

CREATE OR REPLACE FUNCTION bump_governance_authority_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bump_governance_authority_revision() FROM PUBLIC;

DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'institution_authority_sources','institution_governance_offices','institution_governance_bodies',
    'institution_governance_seats','institution_governance_appointments',
    'institution_authority_mandates','institution_decision_matter_rules'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I_revision_guard BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION bump_governance_authority_revision()',table_name,table_name);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',table_name);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE institution_authority_sources,institution_governance_offices,
      institution_governance_bodies,institution_governance_seats,institution_governance_appointments,
      institution_authority_mandates,institution_decision_matter_rules FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE institution_authority_sources,institution_governance_offices,
      institution_governance_bodies,institution_governance_seats,institution_governance_appointments,
      institution_authority_mandates,institution_decision_matter_rules FROM authenticated;
  END IF;
END $$;

DO $$ DECLARE table_name text; owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='students'::regclass;
  FOREACH table_name IN ARRAY ARRAY[
    'institution_authority_sources','institution_governance_offices','institution_governance_bodies',
    'institution_governance_seats','institution_governance_appointments',
    'institution_authority_mandates','institution_decision_matter_rules'
  ] LOOP
    EXECUTE format('ALTER TABLE %I OWNER TO %I',table_name,owner_name);
  END LOOP;
  EXECUTE format('ALTER FUNCTION bump_governance_authority_revision() OWNER TO %I',owner_name);
END $$;
