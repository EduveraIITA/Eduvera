-- Controlled departure, physical handover and school-transport trip coordination.
-- Precise phone location is an assigned-staff observation, never proof of learner location.

-- Tenant-scoped foreign keys below require the learner's tenant and identity to be
-- addressable as one key. The primary key remains the canonical global identity.
ALTER TABLE students ADD CONSTRAINT students_school_identity_unique UNIQUE(school_id,id);

CREATE TABLE departure_policies (
  school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT true,
  enabled_modes text[] NOT NULL DEFAULT ARRAY['guardian_pickup','authorized_collector','school_transport','external_transport']::text[],
  change_cutoff time NOT NULL DEFAULT '13:00',
  location_retention_hours integer NOT NULL DEFAULT 24 CHECK(location_retention_hours BETWEEN 1 AND 168),
  location_stale_seconds integer NOT NULL DEFAULT 90 CHECK(location_stale_seconds BETWEEN 30 AND 600),
  minimum_location_interval_seconds integer NOT NULL DEFAULT 10 CHECK(minimum_location_interval_seconds BETWEEN 5 AND 120),
  maximum_location_accuracy_metres integer NOT NULL DEFAULT 250 CHECK(maximum_location_accuracy_metres BETWEEN 25 AND 2000),
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  updated_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(enabled_modes <@ ARRAY['guardian_pickup','authorized_collector','independent_departure','school_transport','external_transport']::text[])
);

CREATE TABLE departure_collection_authorities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL,
  guardian_relationship_id uuid,
  collector_person_id uuid,
  valid_from date NOT NULL,
  valid_until date,
  status varchar(12) NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  verification_method varchar(32) NOT NULL CHECK(verification_method IN ('school_record','in_person','document','guardian_confirmed')),
  verification_note varchar(500) NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  granted_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  revocation_reason varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,guardian_relationship_id) REFERENCES guardian_relationships(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,collector_person_id) REFERENCES school_people(school_id,id) ON DELETE RESTRICT,
  CHECK((guardian_relationship_id IS NOT NULL)::integer + (collector_person_id IS NOT NULL)::integer = 1),
  CHECK(valid_until IS NULL OR valid_until >= valid_from),
  CHECK((status='active' AND revoked_at IS NULL AND revoked_by IS NULL) OR (status='revoked' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);
CREATE INDEX departure_authority_student_idx ON departure_collection_authorities(school_id,student_id,status,valid_from,valid_until);

CREATE TABLE transport_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  code varchar(32) NOT NULL,
  name varchar(120) NOT NULL,
  service_kind varchar(24) NOT NULL DEFAULT 'institution_managed' CHECK(service_kind IN ('institution_managed','contracted')),
  vehicle_label varchar(80) NOT NULL DEFAULT '',
  provider_name varchar(120) NOT NULL DEFAULT '',
  status varchar(12) NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  UNIQUE(school_id,code)
);

CREATE TABLE transport_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  route_id uuid NOT NULL,
  direction varchar(16) NOT NULL CHECK(direction IN ('to_institution','from_institution')),
  sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 500),
  name varchar(120) NOT NULL,
  planned_time time,
  latitude numeric(9,6),
  longitude numeric(9,6),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  UNIQUE(route_id,direction,sequence),
  UNIQUE(route_id,id),
  FOREIGN KEY(school_id,route_id) REFERENCES transport_routes(school_id,id) ON DELETE CASCADE,
  CHECK((latitude IS NULL)=(longitude IS NULL)),
  CHECK(latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK(longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

CREATE TABLE transport_student_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  student_id uuid NOT NULL,
  route_id uuid NOT NULL,
  stop_id uuid NOT NULL,
  direction varchar(16) NOT NULL CHECK(direction IN ('to_institution','from_institution')),
  valid_from date NOT NULL,
  valid_until date,
  status varchar(12) NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended')),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,route_id) REFERENCES transport_routes(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,stop_id) REFERENCES transport_stops(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(route_id,stop_id) REFERENCES transport_stops(route_id,id) ON DELETE RESTRICT,
  CHECK(valid_until IS NULL OR valid_until >= valid_from)
);
CREATE UNIQUE INDEX transport_assignment_current_idx ON transport_student_assignments(student_id,direction)
  WHERE status='active' AND valid_until IS NULL;

CREATE TABLE transport_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  route_id uuid NOT NULL,
  service_date date NOT NULL,
  direction varchar(16) NOT NULL CHECK(direction IN ('to_institution','from_institution')),
  assigned_collector_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  state varchar(16) NOT NULL DEFAULT 'planned' CHECK(state IN ('planned','boarding','in_progress','completed','cancelled')),
  roster_frozen_at timestamptz,
  departed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason varchar(500) NOT NULL DEFAULT '',
  location_started_at timestamptz,
  location_ended_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  UNIQUE(route_id,service_date,direction),
  FOREIGN KEY(school_id,route_id) REFERENCES transport_routes(school_id,id) ON DELETE RESTRICT,
  CHECK(state<>'in_progress' OR departed_at IS NOT NULL),
  CHECK(state<>'completed' OR completed_at IS NOT NULL),
  CHECK(state<>'cancelled' OR cancelled_at IS NOT NULL)
);
CREATE INDEX transport_trips_collector_idx ON transport_trips(assigned_collector_user_id,service_date,state);

CREATE TABLE transport_trip_roster (
  school_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  student_id uuid NOT NULL,
  stop_id uuid NOT NULL,
  state varchar(16) NOT NULL DEFAULT 'expected' CHECK(state IN ('expected','boarded','dropped','not_riding','exception')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  boarded_at timestamptz,
  dropped_at timestamptz,
  recorded_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  outcome_note varchar(500) NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(trip_id,student_id),
  FOREIGN KEY(school_id,trip_id) REFERENCES transport_trips(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,stop_id) REFERENCES transport_stops(school_id,id) ON DELETE RESTRICT,
  CHECK(state<>'boarded' OR boarded_at IS NOT NULL),
  CHECK(state<>'dropped' OR (boarded_at IS NOT NULL AND dropped_at IS NOT NULL))
);
CREATE INDEX transport_trip_roster_student_idx ON transport_trip_roster(school_id,student_id,trip_id);

CREATE TABLE transport_location_samples (
  id bigserial PRIMARY KEY,
  school_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  latitude numeric(9,6) NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  accuracy_metres numeric(8,2) NOT NULL CHECK(accuracy_metres > 0 AND accuracy_metres <= 5000),
  heading_degrees numeric(6,2) CHECK(heading_degrees IS NULL OR heading_degrees BETWEEN 0 AND 360),
  speed_metres_per_second numeric(7,2) CHECK(speed_metres_per_second IS NULL OR speed_metres_per_second BETWEEN 0 AND 100),
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(school_id,trip_id) REFERENCES transport_trips(school_id,id) ON DELETE CASCADE,
  UNIQUE(trip_id,recorded_by,observed_at)
);
CREATE INDEX transport_location_latest_idx ON transport_location_samples(trip_id,observed_at DESC,id DESC);
CREATE INDEX transport_location_retention_idx ON transport_location_samples(received_at);

CREATE TABLE departure_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL,
  service_date date NOT NULL,
  revision integer NOT NULL CHECK(revision > 0),
  is_current boolean NOT NULL DEFAULT true,
  mode varchar(28) NOT NULL CHECK(mode IN ('guardian_pickup','authorized_collector','independent_departure','school_transport','external_transport')),
  state varchar(16) NOT NULL DEFAULT 'planned' CHECK(state IN ('planned','change_pending','ready','completed','exception','cancelled')),
  authority_id uuid,
  trip_id uuid,
  stop_id uuid,
  external_arrangement varchar(300) NOT NULL DEFAULT '',
  source varchar(20) NOT NULL CHECK(source IN ('default','guardian_request','office_assisted','administrator','transport_assignment')),
  source_reference_id uuid,
  supersedes_plan_id uuid,
  approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  UNIQUE(student_id,service_date,revision),
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,authority_id) REFERENCES departure_collection_authorities(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,trip_id) REFERENCES transport_trips(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,stop_id) REFERENCES transport_stops(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,supersedes_plan_id) REFERENCES departure_plans(school_id,id) ON DELETE RESTRICT,
  CHECK((mode IN ('guardian_pickup','authorized_collector'))=(authority_id IS NOT NULL)),
  CHECK((mode='school_transport')=(trip_id IS NOT NULL)),
  CHECK(mode<>'school_transport' OR stop_id IS NOT NULL),
  CHECK(mode<>'external_transport' OR length(trim(external_arrangement)) >= 3)
);
CREATE UNIQUE INDEX departure_plan_current_idx ON departure_plans(student_id,service_date) WHERE is_current;
CREATE INDEX departure_plan_school_date_idx ON departure_plans(school_id,service_date,state);

CREATE TABLE departure_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  student_id uuid NOT NULL,
  service_date date NOT NULL,
  current_plan_id uuid,
  requested_mode varchar(28) NOT NULL CHECK(requested_mode IN ('guardian_pickup','authorized_collector','independent_departure','school_transport','external_transport')),
  requested_authority_id uuid,
  requested_trip_id uuid,
  requested_stop_id uuid,
  external_arrangement varchar(300) NOT NULL DEFAULT '',
  reason varchar(500) NOT NULL CHECK(length(trim(reason)) >= 3),
  channel varchar(16) NOT NULL CHECK(channel IN ('app','phone','paper','in_person')),
  requester_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  requester_person_id uuid,
  recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status varchar(16) NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','approved','rejected','withdrawn')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  decided_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  decided_at timestamptz,
  decision_note varchar(500) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,current_plan_id) REFERENCES departure_plans(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,requested_authority_id) REFERENCES departure_collection_authorities(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,requested_trip_id) REFERENCES transport_trips(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,requested_stop_id) REFERENCES transport_stops(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,requester_person_id) REFERENCES school_people(school_id,id) ON DELETE RESTRICT,
  CHECK((channel='app' AND requester_user_id IS NOT NULL) OR (channel<>'app' AND requester_person_id IS NOT NULL)),
  CHECK((requested_mode IN ('guardian_pickup','authorized_collector'))=(requested_authority_id IS NOT NULL)),
  CHECK((requested_mode='school_transport')=(requested_trip_id IS NOT NULL)),
  CHECK(requested_mode<>'school_transport' OR requested_stop_id IS NOT NULL),
  CHECK((status='submitted' AND decided_at IS NULL) OR (status IN ('approved','rejected') AND decided_at IS NOT NULL) OR status='withdrawn')
);
CREATE UNIQUE INDEX departure_request_open_idx ON departure_change_requests(student_id,service_date) WHERE status='submitted';

CREATE TABLE departure_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  student_id uuid NOT NULL,
  outcome varchar(24) NOT NULL CHECK(outcome IN ('handed_over','departed_independently','transport_boarded','transport_dropped','refused','no_show','escalated')),
  authority_id uuid,
  authority_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_method varchar(24) NOT NULL CHECK(evidence_method IN ('school_record','in_person_verification','phone_verification','transport_roster','staff_observation')),
  note varchar(500) NOT NULL DEFAULT '',
  occurred_at timestamptz NOT NULL,
  recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plan_id),
  FOREIGN KEY(school_id,plan_id) REFERENCES departure_plans(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,authority_id) REFERENCES departure_collection_authorities(school_id,id) ON DELETE RESTRICT
);

CREATE TABLE departure_audits (
  id bigserial PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action varchar(80) NOT NULL,
  target_type varchar(40) NOT NULL,
  target_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX departure_audits_target_idx ON departure_audits(school_id,target_type,target_id,created_at DESC);

ALTER TABLE school_custom_roles DROP CONSTRAINT IF EXISTS school_custom_roles_permissions_check;
ALTER TABLE school_custom_roles ADD CONSTRAINT school_custom_roles_permissions_check CHECK (
  permissions <@ ARRAY['members.invite','sis.manage','fees.manage','attendance.view','attendance.record','photo.use','timetable.view','dayplans.respond','followups.manage','messages.view','messages.send','groups.create','safeguarding.review','events.view','events.manage','events.attendance','assessments.view','assessments.mark','assessments.moderate','reports.comment','departure.manage','departure.collect','ai.use']::text[]
);

DO $$
DECLARE application_owner text; table_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner FROM pg_class WHERE oid='public.students'::regclass;
  FOREACH table_name IN ARRAY ARRAY[
    'departure_policies','departure_collection_authorities','transport_routes','transport_stops',
    'transport_student_assignments','transport_trips','transport_trip_roster','transport_location_samples',
    'departure_plans','departure_change_requests','departure_handovers','departure_audits'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',table_name);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon',table_name); END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated',table_name); END IF;
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I',table_name,application_owner);
  END LOOP;
  IF to_regclass('public.transport_location_samples_id_seq') IS NOT NULL THEN EXECUTE format('ALTER SEQUENCE public.transport_location_samples_id_seq OWNER TO %I',application_owner); END IF;
  IF to_regclass('public.departure_audits_id_seq') IS NOT NULL THEN EXECUTE format('ALTER SEQUENCE public.departure_audits_id_seq OWNER TO %I',application_owner); END IF;
END $$;
