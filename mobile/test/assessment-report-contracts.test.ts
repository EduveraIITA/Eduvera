import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import type { ResultPolicySnapshot } from '../../packages/contracts/src/academic-reports';
import * as results from '../../packages/contracts/src/result-presentation';


const repository = fileURLToPath(new URL('../../', import.meta.url));
const contracts = path.join(repository, 'packages/contracts/src');
const policy: ResultPolicySnapshot = {
  policy_id: 'frozen-policy', name: 'Published points', code: 'POINTS', version: 3,
  semantic_fingerprint: 'published-snapshot',
  configuration: {
    schema_version: 1, result_format: 'gpa', grade_point_scale: 10, decimal_places: 2,
    aggregation: 'credit_weighted', absence_treatment: 'incomplete', exemption_treatment: 'exclude',
    gpa_failure_treatment: 'withhold',
    bands: [
      { code: 'B', label: 'Good', minimum_percentage: 0, maximum_percentage: 79.99, grade_points: 8, passed: true },
      { code: 'A', label: 'Excellent', minimum_percentage: 80, maximum_percentage: 100, grade_points: 10, passed: true },
    ],
  },
};

const source = (file: string) => ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? sourceFiles(path.join(directory, entry.name))
    : /\.tsx?$/.test(entry.name) ? [path.join(directory, entry.name)] : []);
}
const target = (owner: string, specifier: string) => path.resolve(path.dirname(owner), specifier).replace(/\.(?:ts|tsx)$/, '');


test('mobile assessment/report consumers resolve the shared owner directly', () => {
  const retired = new Set([
    'frontend/src/features/assessments/api',
    'frontend/src/features/academic-reports/api',
    'frontend/src/features/academic-reports/resultPresentation',
  ].map(file => path.join(repository, file)));
  for (const file of sourceFiles(path.join(repository, 'mobile/src'))) {
    for (const statement of source(file).statements) {
      if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      assert.equal(retired.has(target(file, statement.moduleSpecifier.text)), false, `${path.relative(repository, file)} still depends on a retiring frontend owner`);
    }
  }
});

test('neutral assessment and report DTO modules have no runtime dependencies outside shared contracts', () => {
  for (const module of ['assessments', 'academic-reports']) {
    const shared = path.join(contracts, `${module}.ts`), sharedSource = source(shared);
    const names = new Set<string>();
    for (const statement of sharedSource.statements) {
      if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) names.add(statement.name.text);
      else if (ts.isImportDeclaration(statement)) {
        assert.equal(statement.importClause?.isTypeOnly, true, `${module} has a runtime import`);
        assert.ok(ts.isStringLiteral(statement.moduleSpecifier));
        assert.ok(target(shared, statement.moduleSpecifier.text).startsWith(`${contracts}${path.sep}`), `${module} imports outside the neutral contracts package`);
      } else assert.fail(`${module} contains runtime code`);
    }
    assert.ok(names.size > 0, `${module} must retain its active DTO declarations`);
  }
});

test('the extracted assessment closure contains only types reachable from active universal consumers', () => {
  const shared = path.join(contracts, 'assessments.ts');
  const declarations = new Map(source(shared).statements.filter(statement => ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)).map(statement => [statement.name.text, statement]));
  const pending: string[] = [];
  for (const file of sourceFiles(path.join(repository, 'mobile/src'))) {
    for (const statement of source(file).statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || target(file, statement.moduleSpecifier.text) !== shared.replace(/\.ts$/, '')) continue;
      assert.equal(statement.importClause?.isTypeOnly, true);
      const bindings = statement.importClause.namedBindings;
      assert.ok(bindings && ts.isNamedImports(bindings));
      pending.push(...bindings.elements.map(item => (item.propertyName ?? item.name).text));
    }
  }
  assert.ok(pending.length > 0);
  const reached = new Set<string>();
  while (pending.length) {
    const name = pending.pop()!;
    if (reached.has(name)) continue;
    const declaration = declarations.get(name);
    assert.ok(declaration, `Missing shared assessment type ${name}`);
    reached.add(name);
    const visit = (node: ts.Node) => {
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && declarations.has(node.typeName.text)) pending.push(node.typeName.text);
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(declaration, visit);
    if (ts.isInterfaceDeclaration(declaration)) for (const heritage of declaration.heritageClauses ?? []) for (const type of heritage.types) if (ts.isIdentifier(type.expression) && declarations.has(type.expression.text)) pending.push(type.expression.text);
  }
  assert.deepEqual([...declarations.keys()].filter(name => !reached.has(name)), [], 'Unused legacy DTOs must stay out of the universal contracts closure');
});

test('frozen result policy takes precedence over current fallback and never invents missing published points', () => {
  const gradePolicy = { ...policy, configuration: { ...policy.configuration, result_format: 'grade' as const, grade_point_scale: null } };
  const report = { outcome: 'complete', overall_percentage: '91.25', overall_grade: 'A', result_policy: policy };
  assert.deepEqual(results.reportPrimaryResult(report, gradePolicy), { label: 'SGPA', value: '—', secondary: '' });
  assert.equal(results.reportPrimaryResult({ ...report, gpa: '0' }, gradePolicy).value, '0.00 / 10');
  assert.equal(results.reportPrimaryResult({ ...report, result_policy: null }, gradePolicy).value, 'A');
  assert.equal(results.assessmentPrimaryResult({ outcome: 'scored', marks: '91.25', maximum_marks: '100', grade: 'A', result_policy: policy }).value, '—');
  assert.equal(results.assessmentPrimaryResult({ outcome: 'absent', marks: null, maximum_marks: '100', grade: '', result_policy: policy }).value, 'Absent');
});

test('percentage and legacy displays retain real zero and explicit missing values', () => {
  const percentage = { ...policy, configuration: { ...policy.configuration, result_format: 'percentage' as const, grade_point_scale: null } };
  for (const value of [null, undefined, '', 'NaN', Infinity]) assert.equal(results.resultNumber(value, policy), '—');
  assert.equal(results.resultNumber('0', policy), '0.00');
  assert.equal(results.resultNumber('80.500'), '80.500');
  const assessment = { outcome: 'scored', marks: '0', maximum_marks: '100', grade: '' };
  assert.deepEqual(results.assessmentPrimaryResult(assessment), { label: 'Marks', value: '0/100', secondary: '' });
  assert.equal(results.assessmentPrimaryResult({ ...assessment, result_policy: percentage }).value, '—');
  assert.equal(results.assessmentPrimaryResult({ ...assessment, result_policy: percentage, percentage: '0' }).value, '0.00%');
  assert.equal(results.reportPrimaryResult({ outcome: 'incomplete', overall_percentage: null, overall_grade: '' }).value, '—');
});

test('grade entry preview retains the owning rounded boundary without changing frozen configuration', () => {
  const before = JSON.stringify(policy);
  assert.deepEqual(results.previewConfiguredGrade('15999', '20000', policy.configuration), { percentage: 80, grade: 'A', grade_points: 10, passed: true });
  assert.equal(results.previewConfiguredGrade('79.99', '100', policy.configuration)?.grade, 'B');
  for (const [marks, maximum] of [['', '100'], [' ', '100'], ['-1', '100'], ['101', '100'], ['NaN', '100'], ['1', '0'], ['1', 'Infinity']]) assert.equal(results.previewConfiguredGrade(marks!, maximum!, policy.configuration), null);
  assert.equal(JSON.stringify(policy), before);
});

test('unavailable cumulative evidence retains distinct correction and policy explanations', () => {
  assert.match(results.cumulativeUnavailableReason('missing_prior_terms'), /not all published/);
  assert.match(results.cumulativeUnavailableReason('incompatible_policy'), /incompatible grading policy/);
  assert.match(results.cumulativeUnavailableReason('ambiguous_prior_terms'), /resolve which report applies/);
  assert.match(results.cumulativeUnavailableReason('ambiguous_course_attempts'), /resolve the source records/);
  assert.match(results.cumulativeUnavailableReason('failed_courses'), /withheld/);
  assert.match(results.cumulativeUnavailableReason('incomplete_courses'), /incomplete/);
  assert.equal(results.cumulativeUnavailableReason(null), 'Cumulative result unavailable.');
  assert.equal(results.policyDescription(policy), '10-point scale · Credit weighted');
  assert.equal(results.policyDescription(null), 'Percentage and grade');
});
