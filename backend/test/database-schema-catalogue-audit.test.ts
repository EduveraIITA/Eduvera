import { expect,it } from 'vitest';
import { SCHEMA_CATALOGUE_AUDIT_SQL,schemaCatalogueProblems,type SchemaCatalogueAudit } from '../src/database/schema-catalogue-audit.js';

const valid:SchemaCatalogueAudit={database:'thatcampus_test',postgres_version:'17',table_count:1,view_count:0,
  database_bytes:1024,tables:['example'],tables_without_primary_key:[],invalid_indexes:[],unvalidated_constraints:[],duplicate_index_groups:[]};

it('does not confuse a high table count with a failed catalogue or an ownership verdict',()=>{
  expect(schemaCatalogueProblems({...valid,table_count:380})).toEqual([]);
});

it('reports exact catalogue defects without hiding invalid or unvalidated structures',()=>{
  expect(schemaCatalogueProblems({...valid,tables_without_primary_key:['example'],invalid_indexes:['bad_index'],
    unvalidated_constraints:['pending_fk'],duplicate_index_groups:[{table_name:'example',indexes:['a','b']}]}))
    .toEqual(['tables_without_primary_key','invalid_indexes','unvalidated_constraints','duplicate_index_groups']);
});

it('uses metadata only and compares full index semantics rather than an index-name heuristic',()=>{
  expect(SCHEMA_CATALOGUE_AUDIT_SQL).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE)\b/i);
  expect(SCHEMA_CATALOGUE_AUDIT_SQL).toContain('i.indnullsnotdistinct');
  expect(SCHEMA_CATALOGUE_AUDIT_SQL).toContain('i.indnkeyatts');
  expect(SCHEMA_CATALOGUE_AUDIT_SQL).toContain('ic.relam');
  expect(SCHEMA_CATALOGUE_AUDIT_SQL).toContain("n.nspname='public'");
});
