-- Host-free arrivals are recorded by an authorized gate operator, not approved by
-- an invented host. Hosted visits retain the existing decision state machine.
ALTER TABLE gate_visitors ALTER COLUMN host_user_id DROP NOT NULL;
ALTER TABLE gate_visitors ADD COLUMN photo_key uuid;
ALTER TABLE gate_visitors ADD COLUMN photo_type text CHECK (photo_type IN ('image/jpeg','image/png'));
ALTER TABLE gate_visitors ADD COLUMN photo_hash text;
ALTER TABLE gate_visitors ADD COLUMN category text NOT NULL DEFAULT 'guest'
 CHECK (category IN ('parent','vendor','delivery','guest'));
ALTER TABLE gate_visitors ADD CONSTRAINT gate_visitor_photo_complete CHECK (
 (photo_key IS NULL AND photo_type IS NULL AND photo_hash IS NULL) OR
 (photo_key IS NOT NULL AND photo_type IS NOT NULL AND photo_hash IS NOT NULL));
ALTER TABLE gate_visitors ADD CONSTRAINT gate_direct_visit_state CHECK (
 host_user_id IS NOT NULL OR (state IN ('inside','out') AND checked_in_at IS NOT NULL AND decided_by IS NULL));
