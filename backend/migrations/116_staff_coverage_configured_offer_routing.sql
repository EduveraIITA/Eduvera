-- Configured, sequential Staff Coverage offers. Staff Operations remains the
-- authoritative owner of the task and substitution; this table is its immutable
-- binding to the exact Model Core behaviour, subscription and Offer message.

ALTER TABLE public.staff_coverage_task_audits
  DROP CONSTRAINT IF EXISTS staff_coverage_task_audits_action_check;
ALTER TABLE public.staff_coverage_task_audits
  ADD CONSTRAINT staff_coverage_task_audits_action_check
  CHECK (action IN (
    'created','offered','accepted','declined','reassigned','completed','cancelled',
    'fallback_applied','expired_unconfirmed','reopened','offer_cancelled'
  ));

CREATE TABLE public.staff_coverage_offer_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  coverage_task_id uuid NOT NULL,
  route_round integer NOT NULL CHECK(route_round>0),
  route_kind varchar(24) NOT NULL CHECK(route_kind IN ('automatic','manual_override')),
  status varchar(32) NOT NULL CHECK(status IN (
    'configuration_missing','configuration_invalid','no_eligible_candidate',
    'offered','accepted','declined','expired','cancelled'
  )),
  source_task_revision integer NOT NULL CHECK(source_task_revision>0),
  offered_task_revision integer CHECK(offered_task_revision IS NULL OR offered_task_revision>source_task_revision),
  source_outbox_event_id uuid NOT NULL,
  response_outbox_event_id uuid,
  routed_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  selected_staff_profile_id uuid,
  selected_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  behaviour_version_id uuid,
  subscription_id uuid,
  model_event_id uuid,
  reaction_id uuid,
  message_id uuid,
  correlation_id uuid NOT NULL,
  selector_key varchar(64) NOT NULL CHECK(selector_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  required_capability varchar(120),
  candidate_strategy varchar(64),
  response_due_at timestamptz,
  expires_at timestamptz,
  behaviour_snapshot jsonb NOT NULL CHECK(jsonb_typeof(behaviour_snapshot)='object'),
  selector_snapshot jsonb NOT NULL CHECK(jsonb_typeof(selector_snapshot)='object'),
  eligibility_snapshot jsonb NOT NULL CHECK(jsonb_typeof(eligibility_snapshot)='object'),
  explanation varchar(500) NOT NULL CHECK(length(btrim(explanation))>=3),
  routed_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  UNIQUE(id,school_id),
  UNIQUE(school_id,coverage_task_id,route_round),
  UNIQUE(school_id,coverage_task_id,source_task_revision),
  UNIQUE(school_id,message_id),
  FOREIGN KEY(coverage_task_id,school_id)
    REFERENCES public.staff_coverage_tasks(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(selected_staff_profile_id,school_id)
    REFERENCES public.staff_profiles(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(source_outbox_event_id,school_id)
    REFERENCES public.event_outbox(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(response_outbox_event_id,school_id)
    REFERENCES public.event_outbox(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(behaviour_version_id,school_id)
    REFERENCES public.campus_model_behaviour_versions(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(subscription_id,behaviour_version_id,school_id)
    REFERENCES public.campus_model_event_subscriptions(id,behaviour_version_id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(model_event_id,school_id)
    REFERENCES public.campus_model_events(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(reaction_id,school_id)
    REFERENCES public.campus_model_reactions(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(message_id,school_id)
    REFERENCES public.campus_model_operational_messages(id,school_id) ON DELETE RESTRICT,
  CHECK(response_due_at IS NULL OR expires_at IS NULL OR response_due_at<=expires_at),
  CHECK(
    (status IN ('configuration_missing','configuration_invalid','no_eligible_candidate')
      AND offered_task_revision IS NULL
      AND selected_staff_profile_id IS NULL
      AND selected_user_id IS NULL
      AND model_event_id IS NULL AND reaction_id IS NULL AND message_id IS NULL
      AND response_due_at IS NULL AND expires_at IS NULL)
    OR
    (status IN ('offered','accepted','declined','expired','cancelled')
      AND offered_task_revision IS NOT NULL
      AND selected_staff_profile_id IS NOT NULL
      AND selected_user_id IS NOT NULL
      AND behaviour_version_id IS NOT NULL AND subscription_id IS NOT NULL
      AND model_event_id IS NOT NULL AND reaction_id IS NOT NULL AND message_id IS NOT NULL
      AND response_due_at IS NOT NULL AND expires_at IS NOT NULL)
  ),
  CHECK(
    (status IN ('accepted','declined','expired','cancelled') AND responded_at IS NOT NULL)
    OR (status NOT IN ('accepted','declined','expired','cancelled') AND responded_at IS NULL)
  ),
  CHECK(
    (status IN ('accepted','declined') AND response_outbox_event_id IS NOT NULL)
    OR (status NOT IN ('accepted','declined') AND response_outbox_event_id IS NULL)
  )
);

CREATE INDEX staff_coverage_offer_routes_task_idx
  ON public.staff_coverage_offer_routes(school_id,coverage_task_id,route_round DESC);
CREATE UNIQUE INDEX staff_coverage_offer_routes_current_offer_idx
  ON public.staff_coverage_offer_routes(school_id,coverage_task_id)
  WHERE status='offered';

CREATE FUNCTION public.guard_staff_coverage_offer_route()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=public
AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY['status','response_outbox_event_id','responded_at']::text[])
      IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','response_outbox_event_id','responded_at']::text[]) THEN
    RAISE EXCEPTION 'Coverage offer route evidence is immutable'
      USING ERRCODE='23514';
  END IF;
  IF OLD.status<>'offered'
    OR NEW.status NOT IN ('accepted','declined','expired','cancelled') THEN
    RAISE EXCEPTION 'Only a current coverage offer can receive one terminal outcome'
      USING ERRCODE='23514';
  END IF;
  IF NEW.responded_at IS NULL THEN
    RAISE EXCEPTION 'A terminal coverage offer route requires its outcome time'
      USING ERRCODE='23514';
  END IF;
  IF NEW.status IN ('accepted','declined') AND NEW.response_outbox_event_id IS NULL THEN
    RAISE EXCEPTION 'A coverage offer response requires its authoritative domain event'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER staff_coverage_offer_route_guard
  BEFORE UPDATE ON public.staff_coverage_offer_routes
  FOR EACH ROW EXECUTE FUNCTION public.guard_staff_coverage_offer_route();

CREATE FUNCTION public.reject_staff_coverage_offer_route_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=public
AS $$
BEGIN
  RAISE EXCEPTION 'Coverage offer route history is append-only'
    USING ERRCODE='23514';
END $$;

CREATE TRIGGER staff_coverage_offer_route_delete_guard
  BEFORE DELETE ON public.staff_coverage_offer_routes
  FOR EACH ROW EXECUTE FUNCTION public.reject_staff_coverage_offer_route_delete();

ALTER TABLE public.staff_coverage_offer_routes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.staff_coverage_offer_routes FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_staff_coverage_offer_route() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_staff_coverage_offer_route_delete() FROM PUBLIC;

DO $$
DECLARE application_owner text; role_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner
  FROM pg_class WHERE oid='public.staff_coverage_tasks'::regclass;
  EXECUTE format('ALTER TABLE public.staff_coverage_offer_routes OWNER TO %I',application_owner);
  EXECUTE format('ALTER FUNCTION public.guard_staff_coverage_offer_route() OWNER TO %I',application_owner);
  EXECUTE format('ALTER FUNCTION public.reject_staff_coverage_offer_route_delete() OWNER TO %I',application_owner);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.staff_coverage_offer_routes FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON FUNCTION public.guard_staff_coverage_offer_route() FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON FUNCTION public.reject_staff_coverage_offer_route_delete() FROM %I',role_name);
    END IF;
  END LOOP;
END $$;
