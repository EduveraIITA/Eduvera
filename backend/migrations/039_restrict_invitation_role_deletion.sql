-- Keep applied migration 033 immutable while tightening how custom roles that
-- are referenced by outstanding invitations may be deleted.
ALTER TABLE school_invitations
  DROP CONSTRAINT invitation_role_scope,
  ADD CONSTRAINT invitation_role_scope
    FOREIGN KEY (school_id,custom_role_id)
    REFERENCES school_custom_roles(school_id,id)
    ON DELETE RESTRICT;
