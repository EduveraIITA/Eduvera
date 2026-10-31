-- People owns current campus names and contacts; employment owns work facts.
-- Preserve retired copies as migration-time evidence, not fabricated correction
-- history or another current write authority.
INSERT INTO audit_events(action,school_id,target_type,target_id,request_id,metadata)
SELECT 'database.staff_identity_copies_retired',profile.school_id,'staff_profile',profile.id,gen_random_uuid(),
  jsonb_build_object('migration',216,'person_id',profile.person_id,'staff_revision',profile.revision,
    'retired_copy',jsonb_build_object('first_name',profile.first_name,'last_name',profile.last_name,
      'email',profile.email,'phone',profile.phone),
    'current_owner','school_people','knowledge_boundary','recorded_at_migration_not_original_effective_time')
FROM staff_profiles profile;

-- New work invitations bind an exact intended person. Legacy unaccepted staff
-- invitations without a target require explicit reissue, never an email join.
ALTER TABLE school_invitations DROP CONSTRAINT person_invitation_member_target;
ALTER TABLE school_invitations ADD CONSTRAINT person_invitation_member_target CHECK(
  (person_id IS NULL AND role<>'member' AND admin_person_confirmed_at IS NULL) OR
  (person_id IS NOT NULL AND role IN ('member','staff') AND source='school'
    AND student_id IS NULL AND guardian_id IS NULL AND custom_role_id IS NULL AND admin_person_confirmed_at IS NULL) OR
  (person_id IS NOT NULL AND role='admin' AND source='company'
    AND student_id IS NULL AND guardian_id IS NULL AND custom_role_id IS NULL
    AND accepted_at IS NOT NULL AND accepted_by_user_id IS NOT NULL
    AND admin_person_confirmed_at IS NOT NULL AND admin_person_confirmed_at=accepted_at));

-- Explicit identity is mandatory at each writer. Employment insertion can no
-- longer manufacture a People row from copied names or account email.
DROP TRIGGER staff_profile_person_identity ON staff_profiles;
DROP FUNCTION ensure_staff_profile_person_identity();
DROP INDEX staff_profiles_school_email_key;
DROP INDEX staff_profiles_school_status_idx;
ALTER TABLE staff_profiles DROP COLUMN first_name,DROP COLUMN last_name,DROP COLUMN email,DROP COLUMN phone;
CREATE INDEX staff_profiles_school_status_idx ON staff_profiles(school_id,status,id);
COMMENT ON TABLE staff_profiles IS 'Employment/work record for one exact canonical campus person; current name and contact details are owned by school_people.';
