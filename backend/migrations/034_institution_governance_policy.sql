-- Institution-scoped regulatory profile and bounded policy lifecycle.
-- `schools` remains the tenancy anchor; the profile carries the configurable institution kind.

CREATE TABLE institution_regulatory_profiles (
  school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  institution_kind varchar(24) NOT NULL DEFAULT 'school' CHECK (institution_kind IN ('school','college','coaching','hybrid')),
  country_code char(2) NOT NULL DEFAULT 'IN',
  state_code varchar(12) NOT NULL DEFAULT '',
  district varchar(120) NOT NULL DEFAULT '',
  management_kind varchar(32) NOT NULL DEFAULT 'private_unaided' CHECK (management_kind IN ('government','government_aided','private_unaided','trust_society','corporate','other')),
  delivery_mode varchar(20) NOT NULL DEFAULT 'in_person' CHECK (delivery_mode IN ('in_person','online','hybrid')),
  education_levels text[] NOT NULL DEFAULT ARRAY['primary','upper_primary','secondary']::text[],
  regulator_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  capability_packs text[] NOT NULL DEFAULT ARRAY['india_school_core']::text[],
  recognition_reference varchar(180) NOT NULL DEFAULT '',
  affiliation_reference varchar(180) NOT NULL DEFAULT '',
  residential boolean NOT NULL DEFAULT false,
  transport_provided boolean NOT NULL DEFAULT false,
  minors_enrolled boolean NOT NULL DEFAULT true,
  staff_count_band varchar(20) NOT NULL DEFAULT '10_49' CHECK (staff_count_band IN ('0_9','10_49','50_99','100_249','250_plus')),
  reviewed_on date,
  review_note varchar(1000) NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (country_code ~ '^[A-Z]{2}$'),
  CHECK (cardinality(education_levels) > 0),
  CHECK (cardinality(capability_packs) > 0)
);

CREATE TABLE institution_policy_families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  code varchar(64) NOT NULL,
  title varchar(180) NOT NULL,
  category varchar(32) NOT NULL CHECK (category IN ('safeguarding','student_operations','privacy','staff','inclusion','health_safety','communications','events_transport','finance','custom')),
  capability_pack varchar(64) NOT NULL,
  applicable_institution_kinds text[] NOT NULL,
  source_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_audiences text[] NOT NULL DEFAULT ARRAY['admin','staff']::text[],
  default_requires_acknowledgement boolean NOT NULL DEFAULT false,
  risk_level varchar(12) NOT NULL DEFAULT 'standard' CHECK (risk_level IN ('standard','high')),
  guidance varchar(1000) NOT NULL DEFAULT '',
  is_custom boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, code),
  UNIQUE (school_id, id),
  CHECK (code ~ '^[a-z][a-z0-9_]{2,63}$'),
  CHECK (cardinality(applicable_institution_kinds) > 0),
  CHECK (default_audiences <@ ARRAY['admin','staff','guardian','student']::text[])
);

CREATE TABLE institution_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  family_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status varchar(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','published','retired')),
  title varchar(180) NOT NULL,
  summary varchar(600) NOT NULL DEFAULT '',
  body_markdown text NOT NULL DEFAULT '',
  audience_roles text[] NOT NULL DEFAULT ARRAY['admin','staff']::text[],
  requires_acknowledgement boolean NOT NULL DEFAULT false,
  effective_on date,
  review_due_on date,
  source_note varchar(1000) NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  submitted_by uuid REFERENCES users(id),
  submitted_at timestamptz,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  review_note varchar(1000) NOT NULL DEFAULT '',
  review_separation_met boolean,
  review_override_reason varchar(1000) NOT NULL DEFAULT '',
  published_at timestamptz,
  retired_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT policy_version_family_tenant_fk FOREIGN KEY (school_id,family_id) REFERENCES institution_policy_families(school_id,id),
  UNIQUE (family_id, version),
  UNIQUE (school_id, id),
  CHECK (audience_roles <@ ARRAY['admin','staff','guardian','student']::text[]),
  CHECK (cardinality(audience_roles) > 0),
  CHECK (review_due_on IS NULL OR effective_on IS NULL OR review_due_on >= effective_on),
  CHECK ((status='draft') OR body_markdown <> ''),
  CHECK ((status<>'in_review') OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL)),
  CHECK ((status NOT IN ('published','retired')) OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND published_at IS NOT NULL))
);
CREATE UNIQUE INDEX institution_policy_one_published_idx ON institution_policy_versions(family_id) WHERE status='published';
CREATE INDEX institution_policy_versions_school_status_idx ON institution_policy_versions(school_id,status,updated_at DESC);

CREATE TABLE institution_policy_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  policy_version_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  membership_role varchar(16) NOT NULL CHECK (membership_role IN ('admin','staff','guardian','student')),
  acknowledgement_text varchar(240) NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT policy_ack_version_tenant_fk FOREIGN KEY (school_id,policy_version_id) REFERENCES institution_policy_versions(school_id,id),
  UNIQUE (policy_version_id,user_id)
);
CREATE INDEX institution_policy_ack_school_user_idx ON institution_policy_acknowledgements(school_id,user_id,acknowledged_at DESC);

CREATE TABLE institution_governance_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  action varchar(48) NOT NULL,
  target_type varchar(32) NOT NULL CHECK (target_type IN ('regulatory_profile','policy_version','policy_acknowledgement')),
  target_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX institution_governance_audit_school_idx ON institution_governance_audits(school_id,created_at DESC);

CREATE OR REPLACE FUNCTION bump_institution_governance_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER institution_profile_revision_guard BEFORE UPDATE ON institution_regulatory_profiles
  FOR EACH ROW EXECUTE FUNCTION bump_institution_governance_revision();
CREATE TRIGGER institution_policy_revision_guard BEFORE UPDATE ON institution_policy_versions
  FOR EACH ROW EXECUTE FUNCTION bump_institution_governance_revision();
REVOKE ALL ON FUNCTION bump_institution_governance_revision() FROM PUBLIC;

CREATE OR REPLACE FUNCTION preserve_published_policy_version()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF OLD.status IN ('published','retired') AND (
    NEW.title IS DISTINCT FROM OLD.title OR NEW.summary IS DISTINCT FROM OLD.summary OR
    NEW.body_markdown IS DISTINCT FROM OLD.body_markdown OR NEW.audience_roles IS DISTINCT FROM OLD.audience_roles OR
    NEW.requires_acknowledgement IS DISTINCT FROM OLD.requires_acknowledgement OR
    NEW.effective_on IS DISTINCT FROM OLD.effective_on OR NEW.review_due_on IS DISTINCT FROM OLD.review_due_on OR
    NEW.source_note IS DISTINCT FROM OLD.source_note OR NEW.family_id IS DISTINCT FROM OLD.family_id OR
    NEW.version IS DISTINCT FROM OLD.version
  ) THEN
    RAISE EXCEPTION 'Published policy versions are immutable; create a new draft' USING ERRCODE='23514';
  END IF;
  IF OLD.status='retired' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Retired policy versions cannot be reactivated' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER institution_policy_immutable_guard BEFORE UPDATE ON institution_policy_versions
  FOR EACH ROW EXECUTE FUNCTION preserve_published_policy_version();
REVOKE ALL ON FUNCTION preserve_published_policy_version() FROM PUBLIC;

CREATE OR REPLACE FUNCTION validate_policy_acknowledgement()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE version_status varchar; audiences text[]; active_member boolean;
BEGIN
  SELECT status,audience_roles INTO version_status,audiences FROM institution_policy_versions
    WHERE id=NEW.policy_version_id AND school_id=NEW.school_id;
  SELECT EXISTS(SELECT 1 FROM school_memberships WHERE school_id=NEW.school_id AND user_id=NEW.user_id
    AND role=NEW.membership_role AND is_active) INTO active_member;
  IF version_status IS DISTINCT FROM 'published' OR NOT (NEW.membership_role=ANY(audiences)) OR NOT active_member THEN
    RAISE EXCEPTION 'Acknowledgement requires an active audience membership and published version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER institution_policy_ack_guard AFTER INSERT ON institution_policy_acknowledgements
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION validate_policy_acknowledgement();
REVOKE ALL ON FUNCTION validate_policy_acknowledgement() FROM PUBLIC;

CREATE OR REPLACE FUNCTION seed_institution_governance(target_school uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  INSERT INTO institution_regulatory_profiles(school_id) VALUES(target_school) ON CONFLICT DO NOTHING;
  INSERT INTO institution_policy_families(school_id,code,title,category,capability_pack,applicable_institution_kinds,source_references,default_audiences,default_requires_acknowledgement,risk_level,guidance,sort_order)
  SELECT target_school,t.code,t.title,t.category,'india_school_core',ARRAY['school','hybrid']::text[],t.sources::jsonb,t.audiences,t.ack,t.risk,t.guidance,t.sort_order
  FROM (VALUES
    ('child_protection','Child protection and mandatory reporting','safeguarding','[{"label":"POCSO Act, 2012","url":"https://legislative.gov.in/actsofparliamentfromtheyear/protection-children-sexual-offences-act-2012"}]',ARRAY['admin','staff']::text[],true,'high','Define safe reporting, immediate protection, external reporting and restricted records. Do not place allegation details in this policy register.',10),
    ('anti_bullying_cyber_safety','Anti-bullying and cyber safety','safeguarding','[{"label":"Ministry of Education school safety guidance","url":"https://www.education.gov.in/"}]',ARRAY['admin','staff','guardian','student']::text[],true,'high','Set reporting channels, response ownership and age-appropriate communication.',20),
    ('grievance_redressal','Grievance redressal','student_operations','[{"label":"Right to Education Act","url":"https://www.indiacode.nic.in/handle/123456789/2086"}]',ARRAY['admin','staff','guardian','student']::text[],false,'standard','Name intake channels, escalation, response times and records.',30),
    ('admission_withdrawal_transfer','Admission, withdrawal and transfer','student_operations','[{"label":"Right to Education Act","url":"https://www.indiacode.nic.in/handle/123456789/2086"}]',ARRAY['admin','staff','guardian']::text[],false,'standard','Document admission evidence, non-discrimination, withdrawal and transfer-certificate handling.',40),
    ('attendance_register','Attendance and register certification','student_operations','[]',ARRAY['admin','staff','guardian','student']::text[],false,'standard','Define marking, correction, certification, absence follow-up and retention.',50),
    ('privacy_data_rights','Privacy, data rights and retention','privacy','[{"label":"Digital Personal Data Protection Act, 2023","url":"https://www.meity.gov.in/data-protection-framework"}]',ARRAY['admin','staff','guardian','student']::text[],true,'high','Record notices, purposes, retention, rights channels and child-data safeguards; operational dates must follow commencement notifications.',60),
    ('guardian_authority','Guardian authority and student decisions','student_operations','[]',ARRAY['admin','staff','guardian']::text[],true,'high','Keep family relationship, account access, leave signing, consent and collection authority separate.',70),
    ('staff_conduct_posh','Staff conduct and POSH','staff','[{"label":"POSH Act, 2013","url":"https://legislative.gov.in/actsofparliamentfromtheyear/sexual-harassment-women-workplace-prevention-prohibition-and-redressal-act-2013"}]',ARRAY['admin','staff']::text[],true,'high','Define conduct, reporting, committee applicability, confidentiality and training.',80),
    ('inclusion_accommodation','Inclusion and reasonable accommodation','inclusion','[{"label":"Rights of Persons with Disabilities Act, 2016","url":"https://legislative.gov.in/actsofparliamentfromtheyear/rights-persons-disabilities-act-2016"}]',ARRAY['admin','staff','guardian','student']::text[],false,'high','Define accessible participation and a restricted accommodation workflow.',90),
    ('health_emergency','Health, safety and emergency response','health_safety','[{"label":"Ministry of Education school safety guidance","url":"https://www.education.gov.in/"}]',ARRAY['admin','staff','guardian','student']::text[],true,'high','Define emergency roles, contact paths, drills and restricted health information handling.',100),
    ('communications_acceptable_use','Communications and acceptable use','communications','[]',ARRAY['admin','staff','guardian','student']::text[],true,'standard','Set official channels, conduct, delivery limits, account use and escalation.',110),
    ('events_trips_transport','Events, trips and transport','events_transport','[]',ARRAY['admin','staff','guardian','student']::text[],true,'high','Define risk review, guardian decisions, rosters, handover and emergency accountability.',120),
    ('fees_refunds','Fees and refunds','finance','[]',ARRAY['admin','staff','guardian']::text[],false,'standard','Define obligations, receipts, corrections, refunds and grievance channels without linking safety handover to payment.',130)
  ) AS t(code,title,category,sources,audiences,ack,risk,guidance,sort_order)
  ON CONFLICT (school_id,code) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION seed_institution_governance(uuid) FROM PUBLIC;

SELECT seed_institution_governance(id) FROM schools;

CREATE OR REPLACE FUNCTION seed_new_institution_governance()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  PERFORM seed_institution_governance(NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER schools_institution_governance AFTER INSERT ON schools
  FOR EACH ROW EXECUTE FUNCTION seed_new_institution_governance();
REVOKE ALL ON FUNCTION seed_new_institution_governance() FROM PUBLIC;

ALTER TABLE institution_regulatory_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_policy_families ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_policy_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_governance_audits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE institution_regulatory_profiles,institution_policy_families,institution_policy_versions,institution_policy_acknowledgements,institution_governance_audits FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE institution_regulatory_profiles,institution_policy_families,institution_policy_versions,institution_policy_acknowledgements,institution_governance_audits FROM authenticated;
  END IF;
END $$;

DO $$ DECLARE table_name text; owner_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='students'::regclass;
  FOREACH table_name IN ARRAY ARRAY[
    'institution_regulatory_profiles','institution_policy_families','institution_policy_versions',
    'institution_policy_acknowledgements','institution_governance_audits'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',table_name);
    EXECUTE format('ALTER TABLE %I OWNER TO %I',table_name,owner_name);
  END LOOP;
  EXECUTE format('ALTER FUNCTION bump_institution_governance_revision() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION preserve_published_policy_version() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION validate_policy_acknowledgement() OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION seed_institution_governance(uuid) OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION seed_new_institution_governance() OWNER TO %I',owner_name);
END $$;
