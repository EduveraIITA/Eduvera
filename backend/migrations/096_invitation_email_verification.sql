-- Repair accounts whose email-bound invitation was accepted before verification
-- was included in the acceptance transaction. Do not verify unrelated accounts.
UPDATE users u
SET email_verified_at = proof.accepted_at, updated_at = now()
FROM (
  SELECT lower(email) AS email, min(accepted_at) AS accepted_at
  FROM school_invitations WHERE accepted_at IS NOT NULL
  GROUP BY lower(email)
) proof
WHERE lower(u.email) = proof.email AND u.email_verified_at IS NULL
  AND u.created_at <= proof.accepted_at;
