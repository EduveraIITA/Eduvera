-- Effective-dated transport duty planning, staff acceptance and controlled duty swaps.
-- A requested swap never changes operational responsibility until the colleague accepts
-- and school operations approves it.

CREATE TABLE transport_service_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  route_id uuid NOT NULL,
  label varchar(120) NOT NULL,
  direction varchar(16) NOT NULL CHECK(direction IN ('to_institution','from_institution')),
  weekdays smallint[] NOT NULL CHECK(cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  departure_time time NOT NULL,
  primary_collector_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  backup_collector_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  valid_from date NOT NULL,
  valid_until date,
  status varchar(12) NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  UNIQUE(school_id,route_id,direction,departure_time,valid_from),
  FOREIGN KEY(school_id,route_id) REFERENCES transport_routes(school_id,id) ON DELETE RESTRICT,
  CHECK(valid_until IS NULL OR valid_until >= valid_from),
  CHECK(backup_collector_user_id IS NULL OR backup_collector_user_id <> primary_collector_user_id)
);
CREATE INDEX transport_service_pattern_active_idx ON transport_service_patterns(school_id,status,valid_from,valid_until);

ALTER TABLE transport_trips DROP CONSTRAINT transport_trips_route_id_service_date_direction_key;
ALTER TABLE transport_trips
  ADD COLUMN service_pattern_id uuid,
  ADD COLUMN scheduled_departure_time time,
  ADD COLUMN backup_collector_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN collector_assignment_status varchar(12) NOT NULL DEFAULT 'accepted' CHECK(collector_assignment_status IN ('pending','accepted','declined')),
  ADD COLUMN assignment_accepted_at timestamptz,
  ADD COLUMN assignment_declined_at timestamptz,
  ADD COLUMN assignment_note varchar(500) NOT NULL DEFAULT '';

UPDATE transport_trips trip
SET scheduled_departure_time=COALESCE(
  (SELECT min(stop.planned_time) FROM transport_stops stop WHERE stop.route_id=trip.route_id AND stop.direction=trip.direction),
  CASE WHEN trip.direction='to_institution' THEN '07:30'::time ELSE '15:30'::time END
), assignment_accepted_at=COALESCE(trip.created_at,now());

ALTER TABLE transport_trips ALTER COLUMN scheduled_departure_time SET NOT NULL;
ALTER TABLE transport_trips
  ADD FOREIGN KEY(school_id,service_pattern_id) REFERENCES transport_service_patterns(school_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT transport_trip_collector_distinct CHECK(backup_collector_user_id IS NULL OR backup_collector_user_id <> assigned_collector_user_id),
  ADD CONSTRAINT transport_trip_assignment_state_check CHECK(
    (collector_assignment_status='pending' AND assignment_accepted_at IS NULL AND assignment_declined_at IS NULL)
    OR (collector_assignment_status='accepted' AND assignment_accepted_at IS NOT NULL AND assignment_declined_at IS NULL)
    OR (collector_assignment_status='declined' AND assignment_declined_at IS NOT NULL)
  ),
  ADD CONSTRAINT transport_trip_scheduled_run_unique UNIQUE(route_id,service_date,direction,scheduled_departure_time);
CREATE INDEX transport_trip_duty_calendar_idx ON transport_trips(school_id,service_date,scheduled_departure_time,state);
CREATE INDEX transport_trip_backup_idx ON transport_trips(backup_collector_user_id,service_date,state);

CREATE TABLE transport_duty_swap_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  request_type varchar(12) NOT NULL CHECK(request_type IN ('cover','exchange')),
  requester_trip_id uuid NOT NULL,
  target_trip_id uuid,
  requester_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requester_trip_revision integer NOT NULL CHECK(requester_trip_revision > 0),
  target_trip_revision integer,
  reason varchar(500) NOT NULL CHECK(length(trim(reason)) >= 3),
  status varchar(24) NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','accepted','rejected','approved','declined_by_school','cancelled')),
  response_note varchar(500) NOT NULL DEFAULT '',
  target_responded_at timestamptz,
  decided_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  decided_at timestamptz,
  decision_note varchar(500) NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  FOREIGN KEY(school_id,requester_trip_id) REFERENCES transport_trips(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,target_trip_id) REFERENCES transport_trips(school_id,id) ON DELETE RESTRICT,
  CHECK(requester_user_id <> target_user_id),
  CHECK((request_type='exchange' AND target_trip_id IS NOT NULL AND target_trip_revision IS NOT NULL) OR (request_type='cover' AND target_trip_id IS NULL AND target_trip_revision IS NULL)),
  CHECK((status='submitted' AND target_responded_at IS NULL AND decided_at IS NULL)
    OR (status IN ('accepted','rejected') AND target_responded_at IS NOT NULL AND decided_at IS NULL)
    OR (status IN ('approved','declined_by_school') AND target_responded_at IS NOT NULL AND decided_at IS NOT NULL)
    OR status='cancelled')
);
CREATE UNIQUE INDEX transport_duty_swap_open_request_idx ON transport_duty_swap_requests(requester_trip_id)
  WHERE status IN ('submitted','accepted');
CREATE INDEX transport_duty_swap_target_idx ON transport_duty_swap_requests(target_user_id,status,created_at);
CREATE INDEX transport_duty_swap_school_idx ON transport_duty_swap_requests(school_id,status,created_at);

DO $$
DECLARE application_owner text; table_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner FROM pg_class WHERE oid='public.students'::regclass;
  FOREACH table_name IN ARRAY ARRAY['transport_service_patterns','transport_duty_swap_requests'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',table_name);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon',table_name); END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated',table_name); END IF;
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I',table_name,application_owner);
  END LOOP;
END $$;
