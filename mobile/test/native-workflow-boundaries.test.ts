import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

/** Exercise actual exported pure guards without loading React Native's native
 * entry point in Node. Rendering and device behavior require Simulator QA. */
function pureExports(file: string, names: string[], support: string[] = []): Record<string, (...args: any[]) => any> {
  const path = new URL(`../src/features/${file}`, import.meta.url), source = fs.readFileSync(path, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? '') || ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && support.includes(declaration.name.text))).map(node => node.getText(ast)).join('\n');
  for (const name of names) assert.ok(declarations.includes(`function ${name}(`), `Expected source guard ${name}`);
  const compiled = ts.transpileModule(declarations, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, URLSearchParams }; vm.runInNewContext(compiled, context); return context.exports;
}
const { nativeJourneyCoordinates } = pureExports('DepartureScreen.tsx', ['nativeJourneyCoordinates']);
const { nativeEventWindow } = pureExports('EventsScreen.tsx', ['nativeEventWindow']);
const { nativeTeachingSelection, nativeLearningFile, nativeLearningObsolete } = pureExports('LearningScreen.tsx', ['nativeTeachingSelection', 'nativeLearningFile', 'nativeLearningObsolete'], ['object']);

test('last shared map coordinates preserve zero and reject unknown or out-of-range inputs', () => {
  assert.equal(JSON.stringify(nativeJourneyCoordinates('0', 0)), JSON.stringify({ latitude: 0, longitude: 0 }));
  assert.equal(JSON.stringify(nativeJourneyCoordinates('-90', '180')), JSON.stringify({ latitude: -90, longitude: 180 }));
  for (const [latitude, longitude] of [[null, 0], ['', 0], [' ', 0], [0, '\t'], [91, 0], [0, -181], [NaN, 0], [Infinity, 0], [{}, 0]]) assert.equal(nativeJourneyCoordinates(latitude, longitude), null);
});
test('event preparation closes at the actual start and never opens for draft or invalid clocks', () => {
  assert.equal(nativeEventWindow('published', '2026-10-27T09:00:00Z', '2026-10-27T08:59:59Z'), true);
  for (const status of ['draft', 'cancelled', 'completed']) assert.equal(nativeEventWindow(status, '2026-10-27T09:00:00Z', '2026-10-27T08:00:00Z'), false);
  assert.equal(nativeEventWindow('published', '2026-10-27T09:00:00Z', '2026-10-27T09:00:00Z'), false);
  assert.equal(nativeEventWindow('published', 'unknown', Date.now()), false);
  assert.equal(nativeEventWindow('published', '2026-10-27T09:00:00Z', 'unknown'), false);
});
test('teaching links select exactly one source and refuse incomplete or mixed identity', () => {
  assert.equal(nativeTeachingSelection(new URLSearchParams()), null);
  assert.equal(JSON.stringify(nativeTeachingSelection(new URLSearchParams({ session_id: 'session' }))), JSON.stringify({ session_id: 'session' }));
  assert.equal(JSON.stringify(nativeTeachingSelection(new URLSearchParams({ class_section_id: 'class', period_number: '2' }))), JSON.stringify({ class_section_id: 'class', period_number: '2' }));
  const invalid: Record<string, string>[] = [{ session_id: '' }, { session_id: 'session', occurrence_id: 'occurrence' }, { period_number: '2' }, { class_section_id: 'class' }, { class_section_id: 'class', period_number: '0' }, { class_section_id: 'class', period_number: '1.5' }];
  for (const query of invalid) assert.equal(nativeTeachingSelection(new URLSearchParams(query)), false);
});
test('native upload guard enforces actual file-size and supported type boundaries', () => {
  for (const name of ['work.pdf', 'photo.JPG', 'script.py', 'notes.md']) assert.equal(nativeLearningFile(name, 5 * 1024 * 1024), true);
  for (const [name, size] of [['work.pdf', 0], ['work.pdf', 5 * 1024 * 1024 + 1], ['work.pdf', NaN], ['work.pdf', 1.5], ['program.exe', 100], ['file.pdf.exe', 100]]) assert.equal(nativeLearningFile(name, size), false);
});
test('only exact source-bound receipt-absent evidence releases an obsolete assignment', () => {
  const identity = { kind: 'assignment', sourceId: 'assignment', revision: 3 };
  const proof = { handler: 'learning.assignments', confirmation: 'permanently_inapplicable', receipt_state: 'absent', command_id: 'command', source_id: 'assignment', expected_revision: 3, current_revision: 4, code: 'assignment_revision_obsolete' };
  const envelope = (value: object) => ({ status: 409, details: { error: { fields: { assignment_obsolete: value } } } });
  assert.equal(nativeLearningObsolete(envelope(proof), 'command', identity), true);
  for (const patch of [{ receipt_state: 'accepted' }, { command_id: 'other' }, { source_id: 'other' }, { handler: 'other' }, { expected_revision: 2 }, { current_revision: 3 }]) assert.equal(nativeLearningObsolete(envelope({ ...proof, ...patch }), 'command', identity), false);
  assert.equal(nativeLearningObsolete({ status: 409 }, 'command', identity), false);
});
test('changed teaching source proof matches the exact reviewed fingerprint', () => {
  const identity = { kind: 'session', sourceId: 'session', revision: 2, fingerprint: 'before' };
  const proof = { handler: 'learning.sessions', confirmation: 'permanently_inapplicable', receipt_state: 'conflicted', command_id: 'command', source_id: 'session', expected_revision: 2, code: 'learning.session_source_changed', reviewed_source_fingerprint: 'before', current_source_fingerprint: 'after' };
  const envelope = (value: object) => ({ status: 409, details: { error: { fields: { lesson_obsolete: value } } } });
  assert.equal(nativeLearningObsolete(envelope(proof), 'command', identity), true);
  assert.equal(nativeLearningObsolete(envelope({ ...proof, reviewed_source_fingerprint: 'unrelated' }), 'command', identity), false);
  assert.equal(nativeLearningObsolete(envelope({ ...proof, current_source_fingerprint: 'before' }), 'command', identity), false);
});
