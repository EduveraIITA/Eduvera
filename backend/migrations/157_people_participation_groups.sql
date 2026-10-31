-- Reusable People-domain groups; they grant neither accounts nor authority.
ALTER TABLE school_people ADD COLUMN retired_at timestamptz;
CREATE TABLE person_affiliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  person_id uuid NOT NULL,
  affiliation varchar(24) NOT NULL CHECK(affiliation IN ('learner','worker','contractor','visitor','other')),
  starts_on date NOT NULL,
  ends_on date,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(school_id,person_id) REFERENCES school_people(school_id,id),
  CHECK(ends_on IS NULL OR ends_on>=starts_on),
  UNIQUE(school_id,person_id,affiliation,starts_on)
);
CREATE TABLE participation_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  name varchar(150) NOT NULL CHECK(length(btrim(name))>0),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id)
);
CREATE INDEX participation_groups_name_idx ON participation_groups(school_id,lower(name),id);
CREATE TABLE participation_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  group_id uuid NOT NULL,
  person_id uuid NOT NULL,
  starts_on date NOT NULL,
  ends_on date,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by uuid REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(school_id,group_id) REFERENCES participation_groups(school_id,id),
  FOREIGN KEY(school_id,person_id) REFERENCES school_people(school_id,id),
  CHECK(ends_on IS NULL OR ends_on>=starts_on),
  UNIQUE(group_id,person_id,starts_on)
);
CREATE INDEX participation_group_members_effective_idx ON participation_group_members(school_id,group_id,starts_on,ends_on,person_id);
CREATE TABLE people_participation_commands (
  school_id uuid NOT NULL REFERENCES schools(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  idempotency_key uuid NOT NULL,
  request_hash char(64) NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(school_id,actor_id,idempotency_key)
);
ALTER TABLE person_affiliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE participation_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE participation_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE people_participation_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON person_affiliations,participation_groups,participation_group_members,people_participation_commands FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON person_affiliations,participation_groups,participation_group_members,people_participation_commands FROM %I',role_name);
    END IF;
  END LOOP;
END $$;
