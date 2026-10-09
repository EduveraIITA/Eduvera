-- An opt-in preview switch, not a paid entitlement. Future billing must be
-- checked separately before this preference can enable paid capabilities.
ALTER TABLE users ADD COLUMN IF NOT EXISTS pro_features_enabled boolean NOT NULL DEFAULT false;
