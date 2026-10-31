-- Account possession is not a campus person. A company-invited administrator
-- may explicitly confirm one person during acceptance, without creating employment
-- or inferring an existing person from names/contact data. No backfill or grants.
ALTER TABLE school_invitations ADD COLUMN admin_person_confirmed_at timestamptz;
ALTER TABLE school_invitations DROP CONSTRAINT person_invitation_member_target;
ALTER TABLE school_invitations ADD CONSTRAINT person_invitation_member_target CHECK(
  (person_id IS NULL AND role<>'member' AND admin_person_confirmed_at IS NULL)
  OR (person_id IS NOT NULL AND role='member' AND source='school'
    AND student_id IS NULL AND guardian_id IS NULL AND custom_role_id IS NULL AND admin_person_confirmed_at IS NULL)
  OR (person_id IS NOT NULL AND role='admin' AND source='company'
    AND student_id IS NULL AND guardian_id IS NULL AND custom_role_id IS NULL
    AND accepted_at IS NOT NULL AND accepted_by_user_id IS NOT NULL
    AND admin_person_confirmed_at IS NOT NULL AND admin_person_confirmed_at=accepted_at)
);

CREATE OR REPLACE FUNCTION guard_explicit_person_account_binding()
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
      WHERE invitation.school_id=NEW.school_id AND invitation.person_id=NEW.id
        AND invitation.accepted_at IS NOT NULL AND invitation.accepted_by_user_id=NEW.account_user_id
        AND (
          (invitation.role='member' AND invitation.source='school')
          OR (invitation.role='admin' AND invitation.source='company'
            AND invitation.admin_person_confirmed_at=invitation.accepted_at
            AND invitation.revoked_at IS NULL AND invitation.expires_at>invitation.accepted_at
            AND EXISTS(SELECT 1 FROM company_operators operator JOIN users inviter ON inviter.id=operator.user_id
              WHERE operator.user_id=invitation.created_by AND operator.is_active AND inviter.is_active)
            AND EXISTS(SELECT 1 FROM users account JOIN school_memberships membership ON membership.user_id=account.id
              WHERE account.id=NEW.account_user_id AND account.is_active AND account.email_verified_at IS NOT NULL
                AND lower(account.email)=invitation.email AND membership.school_id=NEW.school_id
                AND membership.role='admin' AND membership.is_active))
        )) THEN
    RAISE EXCEPTION 'Person account access requires an accepted exact-person invitation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_explicit_person_account_binding() FROM PUBLIC;
