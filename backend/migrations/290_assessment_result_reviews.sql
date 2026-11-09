CREATE TABLE assessment_result_reviews (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  learner_id uuid NOT NULL,
  person_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_note varchar(1000) NOT NULL CHECK(length(btrim(request_note)) >= 3),
  response_note varchar(1000),
  state text NOT NULL CHECK(state IN ('submitted','resolved','correction_requested')),
  revision integer NOT NULL CHECK(revision > 0),
  requested_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(school_id,id),
  UNIQUE(school_id,publication_id,person_id),
  FOREIGN KEY(school_id,publication_id,assessment_id,learner_id,person_id)
    REFERENCES assessment_publication_results(school_id,publication_id,assessment_id,learner_id,person_id) ON DELETE RESTRICT,
  CHECK(requested_by <> reviewer_user_id),
  CHECK((state='submitted' AND response_note IS NULL) OR
    (state<>'submitted' AND response_note IS NOT NULL AND length(btrim(response_note)) >= 3)),
  CHECK(updated_at >= requested_at)
);
CREATE INDEX assessment_result_review_learner_idx ON assessment_result_reviews(school_id,assessment_id,person_id,requested_at DESC);
CREATE INDEX assessment_result_review_queue_idx ON assessment_result_reviews(school_id,reviewer_user_id,requested_at,id) WHERE state='submitted';
CREATE INDEX assessment_result_review_admin_idx ON assessment_result_reviews(school_id,requested_at,id) WHERE state<>'resolved';

CREATE TABLE assessment_result_review_actions (
  school_id uuid NOT NULL,
  review_id uuid NOT NULL,
  revision integer NOT NULL CHECK(revision > 0),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_key uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  command_id uuid NOT NULL UNIQUE,
  action text NOT NULL CHECK(action IN ('submit','reassign','resolve','refer_correction')),
  accepted_at timestamptz NOT NULL,
  PRIMARY KEY(school_id,review_id,revision),
  UNIQUE(school_id,actor_user_id,client_key),
  FOREIGN KEY(school_id,review_id) REFERENCES assessment_result_reviews(school_id,id) ON DELETE RESTRICT
);

CREATE FUNCTION assessment_result_review_history_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='DELETE' OR TG_TABLE_NAME='assessment_result_review_actions' THEN
    RAISE EXCEPTION 'Result review history is retained';
  END IF;
  IF (NEW.id,NEW.school_id,NEW.assessment_id,NEW.publication_id,NEW.learner_id,NEW.person_id,
      NEW.requested_by,NEW.request_note,NEW.requested_at)
    IS DISTINCT FROM (OLD.id,OLD.school_id,OLD.assessment_id,OLD.publication_id,OLD.learner_id,OLD.person_id,
      OLD.requested_by,OLD.request_note,OLD.requested_at)
    OR OLD.state<>'submitted' OR NEW.revision<>OLD.revision+1 OR NEW.updated_at<OLD.updated_at
    OR (NEW.state='submitted')<>(NEW.reviewer_user_id<>OLD.reviewer_user_id)
  THEN RAISE EXCEPTION 'Result review must retain its publication and follow the next valid transition'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assessment_result_review_scope BEFORE UPDATE OR DELETE ON assessment_result_reviews
  FOR EACH ROW EXECUTE FUNCTION assessment_result_review_history_guard();
CREATE TRIGGER assessment_result_review_actions_retained BEFORE UPDATE OR DELETE ON assessment_result_review_actions
  FOR EACH ROW EXECUTE FUNCTION assessment_result_review_history_guard();

DO $$
DECLARE application_owner text; relation_name text; restricted_role text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner FROM pg_class WHERE oid='public.assessments'::regclass;
  FOREACH relation_name IN ARRAY ARRAY['assessment_result_reviews','assessment_result_review_actions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',relation_name);
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I',relation_name,application_owner);
    FOREACH restricted_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=restricted_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',relation_name,restricted_role);
      END IF;
    END LOOP;
  END LOOP;
  EXECUTE format('ALTER FUNCTION assessment_result_review_history_guard() OWNER TO %I',application_owner);
  REVOKE ALL ON FUNCTION assessment_result_review_history_guard() FROM PUBLIC;
END $$;
