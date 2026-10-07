-- School catalog records are long-lived configuration. Protect edits from
-- silent last-write-wins replacement and retain an accountable editor/time.

ALTER TABLE academic_terms
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE class_sections
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE school_operations_audit
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION bump_school_catalog_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=public
AS $$
BEGIN
  NEW.revision=OLD.revision + 1;
  NEW.updated_at=now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS academic_terms_revision_guard ON academic_terms;
CREATE TRIGGER academic_terms_revision_guard
  BEFORE UPDATE ON academic_terms
  FOR EACH ROW EXECUTE FUNCTION bump_school_catalog_revision();

DROP TRIGGER IF EXISTS class_sections_revision_guard ON class_sections;
CREATE TRIGGER class_sections_revision_guard
  BEFORE UPDATE ON class_sections
  FOR EACH ROW EXECUTE FUNCTION bump_school_catalog_revision();

DROP TRIGGER IF EXISTS subjects_revision_guard ON subjects;
CREATE TRIGGER subjects_revision_guard
  BEFORE UPDATE ON subjects
  FOR EACH ROW EXECUTE FUNCTION bump_school_catalog_revision();
