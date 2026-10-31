-- A forwarded invitation is discovery, not independent proof of its mailbox.
-- Only a short-lived, domain-separated hash is retained; no deliverable code.
ALTER TABLE school_invitations
  ADD COLUMN recipient_proof_hash text,
  ADD COLUMN recipient_proof_expires_at timestamptz,
  ADD COLUMN recipient_proof_sent_at timestamptz;
ALTER TABLE school_invitations ADD CONSTRAINT invitation_recipient_proof_complete CHECK (
  (recipient_proof_hash IS NULL AND recipient_proof_expires_at IS NULL)
  OR (role='member' AND recipient_proof_hash IS NOT NULL AND recipient_proof_expires_at IS NOT NULL
    AND recipient_proof_hash ~ '^[a-f0-9]{64}$'
    AND recipient_proof_sent_at IS NOT NULL
    AND recipient_proof_expires_at>recipient_proof_sent_at
    AND recipient_proof_expires_at<=recipient_proof_sent_at+interval '10 minutes'
    AND recipient_proof_expires_at<=expires_at)
);
