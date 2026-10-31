-- New legacy reports retain a monotonic correction baseline without changing
-- their existing request hash. Historical reports remain NULL and untouched.
-- The existing fee_review_requests_immutable trigger protects this column too.
ALTER TABLE fee_review_requests
  ADD COLUMN correction_watermark jsonb,
  ADD CONSTRAINT fee_review_correction_watermark_shape CHECK (
    correction_watermark IS NULL OR COALESCE(
      jsonb_typeof(correction_watermark)='object'
      AND (correction_watermark-ARRAY['invoice_revision','payment_correction_count'])='{}'::jsonb
      AND jsonb_typeof(correction_watermark->'invoice_revision')='number'
      AND (correction_watermark->>'invoice_revision')::numeric BETWEEN 0 AND 9007199254740991
      AND (correction_watermark->>'invoice_revision')::numeric=trunc((correction_watermark->>'invoice_revision')::numeric)
      AND jsonb_typeof(correction_watermark->'payment_correction_count')='number'
      AND (correction_watermark->>'payment_correction_count')::numeric BETWEEN 0 AND 9007199254740991
      AND (correction_watermark->>'payment_correction_count')::numeric=trunc((correction_watermark->>'payment_correction_count')::numeric),
      false)
  );
