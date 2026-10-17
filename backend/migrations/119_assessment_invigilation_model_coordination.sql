-- Exact Model Core binding for each physical-assessment invigilation Offer.
-- Assessments remains authoritative for the assignment and its response; these
-- append-only records retain which approved behaviour, human recipient and
-- operational message carried each assignment revision.

CREATE TABLE public.assessment_invigilation_offer_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL,
  sitting_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  route_round integer NOT NULL CHECK(route_round>0),
  status varchar(24) NOT NULL CHECK(status IN (
    'offered','accepted','declined','expired','cancelled'
  )),
  source_assignment_revision integer NOT NULL CHECK(source_assignment_revision>0),
  source_outbox_event_id uuid NOT NULL,
  response_outbox_event_id uuid,
  routed_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  selected_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  behaviour_version_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  model_event_id uuid NOT NULL,
  reaction_id uuid NOT NULL,
  message_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  selector_key varchar(64) NOT NULL CHECK(selector_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  required_capability varchar(120) NOT NULL,
  response_due_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  behaviour_snapshot jsonb NOT NULL CHECK(jsonb_typeof(behaviour_snapshot)='object'),
  selector_snapshot jsonb NOT NULL CHECK(jsonb_typeof(selector_snapshot)='object'),
  explanation varchar(500) NOT NULL CHECK(length(btrim(explanation))>=3),
  routed_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  UNIQUE(id,school_id),
  UNIQUE(school_id,assignment_id,route_round),
  UNIQUE(school_id,assignment_id,source_assignment_revision),
  UNIQUE(school_id,message_id),
  FOREIGN KEY(school_id,assignment_id)
    REFERENCES public.assessment_sitting_invigilators(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,sitting_id)
    REFERENCES public.assessment_sittings(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(school_id,assessment_id)
    REFERENCES public.assessments(school_id,id) ON DELETE RESTRICT,
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
  CHECK(response_due_at<=expires_at),
  CHECK(
    (status='offered' AND responded_at IS NULL AND response_outbox_event_id IS NULL)
    OR
    (status IN ('accepted','declined') AND responded_at IS NOT NULL AND response_outbox_event_id IS NOT NULL)
    OR
    (status IN ('expired','cancelled') AND responded_at IS NOT NULL AND response_outbox_event_id IS NULL)
  )
);

CREATE INDEX assessment_invigilation_offer_bindings_assignment_idx
  ON public.assessment_invigilation_offer_bindings(school_id,assignment_id,route_round DESC);
CREATE UNIQUE INDEX assessment_invigilation_offer_bindings_current_idx
  ON public.assessment_invigilation_offer_bindings(school_id,assignment_id)
  WHERE status='offered';

CREATE TABLE public.assessment_invigilation_commands (
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  command_type varchar(24) NOT NULL CHECK(command_type='respond'),
  decision varchar(16) NOT NULL CHECK(decision IN ('accepted','declined')),
  request_hash varchar(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  source_assignment_revision integer NOT NULL CHECK(source_assignment_revision>0),
  resulting_assignment_revision integer NOT NULL CHECK(resulting_assignment_revision=source_assignment_revision+1),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
  response_outbox_event_id uuid NOT NULL,
  message_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(school_id,actor_id,command_id),
  UNIQUE(school_id,assignment_id,resulting_assignment_revision),
  FOREIGN KEY(school_id,assignment_id)
    REFERENCES public.assessment_sitting_invigilators(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(response_outbox_event_id,school_id)
    REFERENCES public.event_outbox(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(message_id,school_id)
    REFERENCES public.campus_model_operational_messages(id,school_id) ON DELETE RESTRICT
);

CREATE FUNCTION public.guard_assessment_invigilation_offer_binding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=public
AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY['status','response_outbox_event_id','responded_at']::text[])
      IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','response_outbox_event_id','responded_at']::text[]) THEN
    RAISE EXCEPTION 'Invigilation Offer binding evidence is immutable'
      USING ERRCODE='23514';
  END IF;
  IF OLD.status<>'offered'
    OR NEW.status NOT IN ('accepted','declined','expired','cancelled') THEN
    RAISE EXCEPTION 'Only a current invigilation Offer can receive one terminal outcome'
      USING ERRCODE='23514';
  END IF;
  IF NEW.responded_at IS NULL THEN
    RAISE EXCEPTION 'A terminal invigilation Offer binding requires its outcome time'
      USING ERRCODE='23514';
  END IF;
  IF NEW.status IN ('accepted','declined') AND NEW.response_outbox_event_id IS NULL THEN
    RAISE EXCEPTION 'An invigilation response requires its authoritative domain event'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER assessment_invigilation_offer_binding_guard
  BEFORE UPDATE ON public.assessment_invigilation_offer_bindings
  FOR EACH ROW EXECUTE FUNCTION public.guard_assessment_invigilation_offer_binding();

CREATE FUNCTION public.reject_assessment_invigilation_offer_binding_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=public
AS $$
BEGIN
  RAISE EXCEPTION 'Invigilation Offer binding history is append-only'
    USING ERRCODE='23514';
END $$;

CREATE TRIGGER assessment_invigilation_offer_binding_delete_guard
  BEFORE DELETE ON public.assessment_invigilation_offer_bindings
  FOR EACH ROW EXECUTE FUNCTION public.reject_assessment_invigilation_offer_binding_delete();

ALTER TABLE public.assessment_invigilation_offer_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_invigilation_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.assessment_invigilation_offer_bindings FROM PUBLIC;
REVOKE ALL ON TABLE public.assessment_invigilation_commands FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_assessment_invigilation_offer_binding() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_assessment_invigilation_offer_binding_delete() FROM PUBLIC;

DO $$
DECLARE application_owner text; role_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner
  FROM pg_class WHERE oid='public.assessment_sitting_invigilators'::regclass;
  EXECUTE format('ALTER TABLE public.assessment_invigilation_offer_bindings OWNER TO %I',application_owner);
  EXECUTE format('ALTER TABLE public.assessment_invigilation_commands OWNER TO %I',application_owner);
  EXECUTE format('ALTER FUNCTION public.guard_assessment_invigilation_offer_binding() OWNER TO %I',application_owner);
  EXECUTE format('ALTER FUNCTION public.reject_assessment_invigilation_offer_binding_delete() OWNER TO %I',application_owner);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.assessment_invigilation_offer_bindings FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON TABLE public.assessment_invigilation_commands FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON FUNCTION public.guard_assessment_invigilation_offer_binding() FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON FUNCTION public.reject_assessment_invigilation_offer_binding_delete() FROM %I',role_name);
    END IF;
  END LOOP;
END $$;
