-- Neutral account access is separate from learner/employment/operating authority.
-- Existing profile/account identities remain untouched; there is no backfill.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('student','parent','staff','admin','member'));
ALTER TABLE school_memberships DROP CONSTRAINT school_memberships_role_check;
ALTER TABLE school_memberships ADD CONSTRAINT school_memberships_role_check CHECK(role IN ('student','guardian','staff','admin','member'));
ALTER TABLE school_invitations DROP CONSTRAINT school_invitations_role_check;
ALTER TABLE school_invitations ADD CONSTRAINT school_invitations_role_check CHECK(role IN ('student','guardian','staff','admin','member'));

ALTER TABLE school_people ADD COLUMN account_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX school_people_account_user_scope ON school_people(school_id,account_user_id) WHERE account_user_id IS NOT NULL;
ALTER TABLE school_invitations ADD COLUMN person_id uuid,
  ADD COLUMN accepted_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT person_invitation_scope FOREIGN KEY(person_id,school_id) REFERENCES school_people(id,school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT person_invitation_member_target CHECK(
    (person_id IS NULL AND role<>'member') OR
    (person_id IS NOT NULL AND role='member' AND source='school' AND student_id IS NULL AND guardian_id IS NULL AND custom_role_id IS NULL)),
  ADD CONSTRAINT member_invitation_acceptance_actor CHECK(role<>'member' OR ((accepted_at IS NULL)=(accepted_by_user_id IS NULL)));
CREATE UNIQUE INDEX school_invitations_open_person ON school_invitations(school_id,person_id)
  WHERE person_id IS NOT NULL AND accepted_at IS NULL AND revoked_at IS NULL;

CREATE FUNCTION guard_explicit_person_account_binding()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF NEW.account_user_id IS NULL THEN
    IF TG_OP='UPDATE' AND OLD.account_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'An accepted person account binding cannot be silently cleared' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND NEW.account_user_id IS NOT DISTINCT FROM OLD.account_user_id THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM school_invitations invitation
      WHERE invitation.school_id=NEW.school_id AND invitation.person_id=NEW.id AND invitation.role='member'
        AND invitation.source='school' AND invitation.accepted_at IS NOT NULL
        AND invitation.accepted_by_user_id=NEW.account_user_id) THEN
    RAISE EXCEPTION 'Person account access requires an accepted exact-person invitation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER explicit_person_account_binding_guard BEFORE INSERT OR UPDATE OF account_user_id ON school_people
  FOR EACH ROW EXECUTE FUNCTION guard_explicit_person_account_binding();
REVOKE ALL ON FUNCTION guard_explicit_person_account_binding() FROM PUBLIC;

-- The reviewed current-identity boolean is reused by event delivery and the
-- bounded People account-state port. New neutral membership has only an explicit
-- accepted People binding; it never implies a student/staff profile or permission.
CREATE OR REPLACE FUNCTION campus_model_account_person_is_active(institution uuid,account_id uuid,expected_person uuid,at_time timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  WITH explicit_person AS (
    SELECT id AS person_id FROM school_people WHERE school_id=institution AND account_user_id=account_id
    UNION SELECT person_id FROM students WHERE school_id=institution AND user_id=account_id
    UNION SELECT profile.person_id FROM parents parent JOIN guardian_school_profiles profile ON profile.guardian_id=parent.id
      WHERE profile.school_id=institution AND parent.user_id=account_id
    UNION SELECT person_id FROM staff_profiles WHERE school_id=institution AND user_id=account_id
    UNION SELECT person_id FROM institution_governance_appointments WHERE school_id=institution AND linked_user_id=account_id
  ), eligible AS (
    SELECT endpoint.id,agent.person_id
    FROM campus_model_agent_endpoints endpoint
    JOIN campus_model_agents agent ON agent.id=endpoint.agent_id AND agent.school_id=endpoint.school_id
    JOIN school_people person ON person.id=agent.person_id AND person.school_id=agent.school_id AND person.retired_at IS NULL
    JOIN users account ON account.id=endpoint.user_id AND account.is_active
    JOIN operational_realms realm ON realm.legacy_school_id=agent.school_id AND realm.status='active'
    JOIN execution_environment_namespaces address ON address.realm_id=realm.id AND address.status='active'
      AND (address.expires_at IS NULL OR address.expires_at>at_time)
      AND address.namespace_id=COALESCE(NULLIF(current_setting('thatcampus.namespace_id',true),''),
        CASE WHEN current_schema()='public' THEN 'live:'||institution::text END)
      AND address.environment_kind=CASE WHEN current_schema()='public' THEN 'live' ELSE 'simulation' END
    WHERE endpoint.school_id=institution AND endpoint.user_id=account_id
      AND endpoint.endpoint_kind='account' AND endpoint.provider='thatcampus'
      AND (endpoint.status='active' OR (endpoint.status='revoked' AND EXISTS(
        SELECT 1 FROM campus_model_agent_endpoint_transitions transition WHERE transition.school_id=endpoint.school_id
          AND transition.endpoint_id=endpoint.id AND transition.transition_kind='revoked' AND transition.effective_at>at_time)))
      AND endpoint.effective_from<=at_time AND (endpoint.effective_until IS NULL OR endpoint.effective_until>at_time)
      AND agent.agent_kind='human' AND agent.status='active'
      AND NOT EXISTS(SELECT 1 FROM explicit_person explicit WHERE explicit.person_id<>agent.person_id)
      AND EXISTS(SELECT 1 FROM school_memberships membership WHERE membership.school_id=institution
        AND membership.user_id=account_id AND membership.is_active AND (
          membership.role='admin'
          OR (membership.role='member' AND person.account_user_id=account_id)
          OR (membership.role='staff' AND EXISTS(SELECT 1 FROM staff_profiles profile WHERE profile.school_id=institution
            AND profile.user_id=account_id AND profile.person_id=agent.person_id AND profile.status='active'))
          OR (membership.role='student' AND EXISTS(SELECT 1 FROM students student WHERE student.school_id=institution
            AND student.user_id=account_id AND student.person_id=agent.person_id))
          OR (membership.role='guardian' AND EXISTS(SELECT 1 FROM parents parent JOIN guardian_school_profiles profile
            ON profile.guardian_id=parent.id WHERE profile.school_id=institution AND parent.user_id=account_id AND profile.person_id=agent.person_id))
        ))
  ) SELECT count(DISTINCT person_id)=1 AND COALESCE(bool_and(expected_person IS NULL OR person_id=expected_person),false) FROM eligible
$$;
