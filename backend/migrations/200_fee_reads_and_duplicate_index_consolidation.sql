-- Bound ledger/detail queries aggregate payments by the owning school/invoice.
CREATE INDEX fee_payments_school_invoice_created_idx ON fee_payments(school_id,invoice_id,created_at DESC,id);

-- Preserve the surviving UNIQUE identity and every dependent FK. Never CASCADE.
-- Rebind only FKs whose catalog dependency points to the exact duplicate index.
DO $$
DECLARE target record; old_index oid; kept_index oid; dependency jsonb; dependencies jsonb; constraint_name text;
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('public.students','public.students_school_identity_idx','public.students_school_identity_unique'),
    ('public.staff_responsibility_types','public.staff_role_school_id','public.staff_responsibility_types_school_id_id_key')
  ) AS targets(table_name,old_name,kept_name) LOOP
    old_index := to_regclass(target.old_name); kept_index := to_regclass(target.kept_name);
    IF old_index IS NULL THEN CONTINUE; END IF;
    IF kept_index IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_index old JOIN pg_index kept ON kept.indexrelid=kept_index
      WHERE old.indexrelid=old_index AND old.indrelid=target.table_name::regclass
        AND kept.indrelid=old.indrelid AND old.indisunique AND kept.indisunique AND old.indisvalid AND kept.indisvalid
        AND old.indnkeyatts=kept.indnkeyatts AND old.indnatts=kept.indnatts AND old.indimmediate=kept.indimmediate
        AND (to_jsonb(old)->'indnullsnotdistinct') IS NOT DISTINCT FROM (to_jsonb(kept)->'indnullsnotdistinct')
        AND NOT old.indisprimary AND NOT old.indisreplident
        AND old.indkey=kept.indkey AND old.indclass=kept.indclass AND old.indcollation=kept.indcollation
        AND old.indoption=kept.indoption AND old.indpred IS NULL AND kept.indpred IS NULL
        AND old.indexprs IS NULL AND kept.indexprs IS NULL
    ) THEN RAISE EXCEPTION 'Identity indexes differ: % / %',target.old_name,target.kept_name; END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid))), '[]'::jsonb)
      INTO dependencies FROM pg_constraint WHERE contype='f' AND conindid=old_index;
    FOR dependency IN SELECT value FROM jsonb_array_elements(dependencies) LOOP
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',dependency->>'table',dependency->>'name');
    END LOOP;
    SELECT conname INTO constraint_name FROM pg_constraint WHERE conindid=old_index AND contype='u';
    IF constraint_name IS NULL THEN EXECUTE format('DROP INDEX %s',old_index::regclass);
    ELSE EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',target.table_name,constraint_name); END IF;
    FOR dependency IN SELECT value FROM jsonb_array_elements(dependencies) LOOP
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s',dependency->>'table',dependency->>'name',dependency->>'definition');
    END LOOP;
  END LOOP;
END $$;
