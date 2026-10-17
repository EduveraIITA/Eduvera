import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrationDiagnostics } from './migration-diagnostics.mjs';
test('reports bounded schema diagnostics without leaking log payloads',()=>{
 const result=migrationDiagnostics([{textPayload:'Applied 101_institution_campus_replica.sql'},
 {textPayload:'error: must be owner of table "class_sections"'},
 {textPayload:'error: password authentication failed for user "private@example.test" postgres://secret:pass@host/db'},
 {textPayload:'DETAIL: Key (email)=(private@example.test) already exists.'},
 {textPayload:'SECRET=value'}]);
 assert(result.includes('Migration error: ownership required (table class_sections)'));
 assert(result.includes('Migration error: authentication failure'));
 assert(!JSON.stringify(result).match(/private|secret|pass@|SECRET|value/));
 assert.equal(migrationDiagnostics([{textPayload:'unrecognised private data'}]).length,0);
});
