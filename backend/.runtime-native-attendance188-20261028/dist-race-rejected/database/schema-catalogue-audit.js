/** Run only inside a bounded read-only transaction. This is not a usage/ownership verdict. */
export const SCHEMA_CATALOGUE_AUDIT_SQL = `
WITH tables AS (
  SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition
), duplicate_indexes AS (
  SELECT i.indrelid::regclass::text AS table_name,
    array_agg(i.indexrelid::regclass::text ORDER BY i.indexrelid::regclass::text) AS indexes
  FROM pg_index i JOIN tables t ON t.oid=i.indrelid JOIN pg_class ic ON ic.oid=i.indexrelid
  WHERE i.indisvalid AND NOT i.indisexclusion
  GROUP BY i.indrelid,ic.relam,i.indisunique,i.indnullsnotdistinct,i.indnkeyatts,
    i.indkey::text,i.indclass::text,i.indcollation::text,i.indoption::text,
    coalesce(pg_get_expr(i.indexprs,i.indrelid),''),coalesce(pg_get_expr(i.indpred,i.indrelid),'')
  HAVING count(*)>1
)
SELECT json_build_object(
  'database',current_database(),'postgres_version',current_setting('server_version'),
  'table_count',(SELECT count(*) FROM tables),
  'view_count',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('v','m')),
  'database_bytes',pg_database_size(current_database()),
  'tables',(SELECT coalesce(json_agg(relname ORDER BY relname),'[]') FROM tables),
  'tables_without_primary_key',(SELECT coalesce(json_agg(relname ORDER BY relname),'[]') FROM tables t
    WHERE NOT EXISTS(SELECT 1 FROM pg_constraint p WHERE p.conrelid=t.oid AND p.contype='p')),
  'invalid_indexes',(SELECT coalesce(json_agg(i.indexrelid::regclass::text),'[]') FROM pg_index i
    JOIN tables t ON t.oid=i.indrelid WHERE NOT i.indisvalid),
  'unvalidated_constraints',(SELECT coalesce(json_agg(p.conname),'[]') FROM pg_constraint p
    JOIN tables t ON t.oid=p.conrelid WHERE NOT p.convalidated),
  'duplicate_index_groups',(SELECT coalesce(json_agg(duplicate_indexes),'[]') FROM duplicate_indexes)
) AS audit`;
export function schemaCatalogueProblems(audit) {
    const problems = [];
    if (audit.tables_without_primary_key.length)
        problems.push('tables_without_primary_key');
    if (audit.invalid_indexes.length)
        problems.push('invalid_indexes');
    if (audit.unvalidated_constraints.length)
        problems.push('unvalidated_constraints');
    if (audit.duplicate_index_groups.length)
        problems.push('duplicate_index_groups');
    return problems;
}
//# sourceMappingURL=schema-catalogue-audit.js.map