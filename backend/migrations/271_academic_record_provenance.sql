-- Provenance is captured by the owning academic transition, not reconstructed
-- from today's placement. Empty objects identify pre-migration unknown history.
ALTER TABLE assessment_results ADD COLUMN academic_roster_source jsonb NOT NULL DEFAULT '{}'
  CHECK (jsonb_typeof(academic_roster_source)='object');
ALTER TABLE assessment_publications ADD COLUMN academic_context jsonb NOT NULL DEFAULT '{}'
  CHECK (jsonb_typeof(academic_context)='object');
ALTER TABLE assessment_publication_results ADD COLUMN academic_roster_source jsonb NOT NULL DEFAULT '{}'
  CHECK (jsonb_typeof(academic_roster_source)='object');
ALTER TABLE grading_report_batches ADD COLUMN academic_context jsonb NOT NULL DEFAULT '{}'
  CHECK (jsonb_typeof(academic_context)='object');
ALTER TABLE grading_report_students ADD COLUMN academic_roster_source jsonb NOT NULL DEFAULT '{}'
  CHECK (jsonb_typeof(academic_roster_source)='object');

-- Existing bytes are not assumed to be present or verified. An authorized
-- submission may verify actual legacy bytes and retain their real digest.
ALTER TABLE assessment_evidence ADD COLUMN sha256 text
  CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$');
