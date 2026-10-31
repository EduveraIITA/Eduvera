import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import type { ImportValues } from '../../packages/contracts/src/wire/features/people/import-api';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const contracts = path.join(repository, 'packages/contracts/src');
const frontend = path.join(repository, 'frontend');
function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(item => item.isDirectory() ? files(path.join(root, item.name)) : /\.[cm]?[tj]sx?$/.test(item.name) ? [path.join(root, item.name)] : []);
}
function inside(file: string, directory: string) { const relative = path.relative(directory, file); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); }
function moduleReferences(source: ts.SourceFile) {
  const result: string[] = [];
  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) result.push(node.moduleSpecifier.text);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) result.push(node.argument.literal.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) result.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(source); return result;
}
const options: ts.CompilerOptions = { noEmit: true, strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, forceConsistentCasingInFileNames: true, types: [], lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'] };

// Compile-time witnesses keep the sole value-backed declaration's exact key set.
// Required CSV columns must not silently become string keys or optional values.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type RequiredKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? never : K }[keyof T];
type CsvColumn = 'admission_number' | 'first_name' | 'last_name' | 'date_of_birth' | 'class' | 'roll_number' | 'enrolled_on' | 'guardian_key' | 'guardian_first_name' | 'guardian_last_name' | 'guardian_phone' | 'guardian_email' | 'relationship';
const exactColumns: Equal<RequiredKeys<ImportValues>, CsvColumn> = true;
const exactKeys: Equal<keyof ImportValues, CsvColumn | 'person_id' | 'person_revision' | 'guardian_person_id' | 'guardian_person_revision'> = true;

test('shared wire declarations emit no runtime API, UI or phantom importColumns value', () => {
  const wireFiles = files(path.join(contracts, 'wire')); assert.ok(wireFiles.length > 0);
  for (const file of wireFiles) {
    const text = readFileSync(file, 'utf8'), source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement)) { assert.equal(statement.importClause?.isTypeOnly, true, file); continue; }
      if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) continue;
      assert.ok(ts.isVariableStatement(statement), `Executable declaration in ${file}`);
      assert.equal(statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword), true, file);
      assert.equal(statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false, false, 'Ambient helper must never promise a runtime export');
      assert.equal(statement.declarationList.declarations.length, 1);
      assert.equal(statement.declarationList.declarations[0]!.name.getText(source), 'importColumns');
      assert.equal(statement.declarationList.declarations[0]!.initializer, undefined);
    }
    const emitted = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.trim();
    assert.ok(emitted === '' || emitted === 'export {};', `Unexpected runtime output from ${file}`);
    for (const specifier of moduleReferences(source)) {
      const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule?.resolvedFileName;
      assert.ok(resolved && inside(resolved, contracts), `${file}: ${specifier} leaves the shared contract owner`);
    }
  }
  assert.equal(exactColumns && exactKeys, true);
});

test('the complete shared wire closure typechecks without old frontend source or installed frontend dependencies', () => {
  const program = ts.createProgram(files(path.join(contracts, 'wire')), options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')), []);
  assert.equal(program.getSourceFiles().some(source => inside(source.fileName, frontend)), false);
  assert.equal(program.getSourceFiles().some(source => source.fileName.includes(`${path.sep}frontend${path.sep}node_modules${path.sep}`)), false);
});

test('all universal app import forms use neutral owners rather than old frontend runtime or type modules', () => {
  for (const file of [...files(path.join(repository, 'mobile/src')), ...files(path.join(repository, 'mobile/app'))]) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    for (const specifier of moduleReferences(source)) {
      const resolved = specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier) : specifier;
      assert.equal(inside(resolved, frontend), false, `${file} imports ${specifier}`);
      assert.equal(/(?:^|\/)frontend\//.test(specifier), false, `${file} imports ${specifier}`);
    }
  }
});
