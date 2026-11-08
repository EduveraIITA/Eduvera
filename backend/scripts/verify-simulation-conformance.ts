import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import ts from "typescript";
import { EXECUTION_EFFECT_KINDS } from "../src/campus-model-core/execution-effects.contracts.js";
import { SIMULATION_CONFORMANCE_BUILD } from "../src/simulation-conformance/simulation-conformance.generated.js";
import {
  SIMULATION_CLOCK_BOUNDARY_FILES,
  SIMULATION_BOUNDARY_REGISTRY,
  SIMULATION_CONFORMANCE_EVIDENCE,
  SIMULATION_CONFORMANCE_REVISION,
  SIMULATION_EFFECT_FAMILY_REGISTRY,
  SIMULATION_FRONTEND_ENVIRONMENT_FILES,
  SIMULATION_MODULE_REGISTRY,
  SIMULATION_SAFETY_EVIDENCE,
  SIMULATION_SHARED_MATERIAL_FILES,
  SIMULATION_STANDALONE_WORKER_REGISTRY,
  SIMULATION_WORKER_REGISTRY,
  evaluateRegisteredModuleEvidence,
  type SimulationBoundaryRegistration,
  type SimulationWorkerRegistration,
} from "../src/simulation-conformance/simulation-conformance.registry.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const generatedPath = join(
  repositoryRoot,
  "backend/src/simulation-conformance/simulation-conformance.generated.ts",
);

interface TimerInventory {
  readonly file: string;
  readonly interval_calls: number;
  readonly timeout_calls: number;
}

interface StandaloneWorkerInventory {
  readonly file: string;
  readonly mechanism: "timers_promises_loop";
}

export interface SimulationConformanceAudit {
  readonly revision: number;
  readonly fingerprint: string;
  readonly components: Readonly<Record<string, string>>;
  readonly app_modules: readonly string[];
  readonly timers: readonly TimerInventory[];
  readonly standalone_workers: readonly StandaloneWorkerInventory[];
  readonly wall_clock_calls: readonly string[];
  readonly external_effect_calls: readonly string[];
  readonly evidence_blockers: readonly string[];
  readonly errors: readonly string[];
}

function posixPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function repoPath(value: string): string {
  return posixPath(relative(repositoryRoot, value));
}

function absolute(value: string): string {
  return join(repositoryRoot, value);
}

function sha(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sameComponents(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.every((key) => left[key] === right[key]);
}

async function filesBelow(path: string, extension?: string): Promise<string[]> {
  const metadata = await stat(path);
  if (metadata.isFile()) return !extension || path.endsWith(extension) ? [path] : [];
  const entries = await readdir(path, { withFileTypes: true });
  const files = await Promise.all(entries
    .filter((entry) => entry.name !== "node_modules" && entry.name !== "dist")
    .map((entry) => filesBelow(join(path, entry.name), extension)));
  return files.flat().sort();
}

function sourceFile(path: string, text: string): ts.SourceFile {
  const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
}

function semanticTypeScript(parsed: ts.SourceFile): string {
  return ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
    .printFile(parsed)
    .replaceAll("\r\n", "\n");
}

/** One audit sees one read/parse per path. This cache never survives an audit or
 * standalone digest call, so edits between verifications cannot reuse old facts.
 * Visitors only read the parsed tree; the existing parser/printer options stay
 * identical. Failed reads are not cached; ordinary ordered consumers retain
 * their existing read failure handling. */
class AuditInputs {
  private readonly files = new Map<string, Promise<{ text: string; parsed?: ts.SourceFile; semantic?: string }>>();

  private file(path: string) {
    let value = this.files.get(path);
    if (!value) {
      value = readFile(path, "utf8").then(text => ({ text })).catch((cause: unknown) => { this.files.delete(path); throw cause; });
      this.files.set(path, value);
    }
    return value;
  }

  async text(path: string): Promise<string> { return (await this.file(path)).text; }
  async parsed(path: string): Promise<ts.SourceFile> {
    const file = await this.file(path);
    return file.parsed ??= sourceFile(path, file.text);
  }
  async semantic(path: string): Promise<string> {
    const file = await this.file(path);
    if (file.semantic === undefined) {
      file.semantic = semanticTypeScript(await this.parsed(path));
      // Every AST inspection precedes component hashing. Keep its canonical
      // output, not thousands of frontend/test trees until the audit returns.
      delete file.parsed;
    }
    return file.semantic;
  }
  async prefetch(paths: readonly string[]): Promise<void> {
    const unique = [...new Set(paths)]; let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, unique.length) }, async () => {
      while (next < unique.length) {
        const path = unique[next++]!;
        try { await this.file(path); } catch { /* Ordered validation/digest still throws or reports this exact failure. */ }
      }
    }));
  }
}

async function digestFiles(paths: readonly string[], typeScript: boolean, inputs: AuditInputs): Promise<string> {
  const unique = [...new Set(paths)].sort();
  await inputs.prefetch(unique);
  const values: string[] = [];
  for (const path of unique) {
    const text = await inputs.text(path);
    values.push(`${repoPath(path)}\0${typeScript && /\.tsx?$/u.test(path) ? await inputs.semantic(path) : text.replaceAll("\r\n", "\n")}`);
  }
  return sha(values.join("\0"));
}

/** Shared client owners now live outside frontend/src. Changes to their actual
 * implementations must invalidate the receipt just like their former sources. */
export async function digestSharedClientContracts(directory = absolute("packages/contracts/src")): Promise<string> {
  return digestClientContracts(directory, new AuditInputs());
}

async function digestClientContracts(directory: string, inputs: AuditInputs): Promise<string> {
  const files = (await filesBelow(directory))
    .filter((path) => /\.(?:ts|tsx)$/u.test(path))
    .filter((path) => !/(?:^|\/)(?:__tests__|test)(?:\/|$)|\.(?:test|spec)\.[^.]+$/u.test(posixPath(path)));
  return digestFiles(files, true, inputs);
}

function decorators(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
}

function propertyName(node: ts.PropertyName | undefined): string | null {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return null;
}

function moduleMetadata(node: ts.ClassDeclaration): ts.ObjectLiteralExpression | null {
  for (const decorator of decorators(node)) {
    const expression = decorator.expression;
    if (!ts.isCallExpression(expression)
      || !ts.isIdentifier(expression.expression)
      || expression.expression.text !== "Module") continue;
    const argument = expression.arguments[0];
    if (argument && ts.isObjectLiteralExpression(argument)) return argument;
  }
  return null;
}

function arrayProperty(metadata: ts.ObjectLiteralExpression, name: string): readonly ts.Expression[] {
  const property = metadata.properties.find((candidate): candidate is ts.PropertyAssignment => (
    ts.isPropertyAssignment(candidate) && propertyName(candidate.name) === name
  ));
  return property && ts.isArrayLiteralExpression(property.initializer)
    ? property.initializer.elements
    : [];
}

async function appModuleImports(errors: string[], inputs: AuditInputs): Promise<string[]> {
  const path = absolute("backend/src/app.module.ts");
  const parsed = await inputs.parsed(path);
  const app = parsed.statements.find((node): node is ts.ClassDeclaration => (
    ts.isClassDeclaration(node) && node.name?.text === "AppModule"
  ));
  const metadata = app ? moduleMetadata(app) : null;
  if (!metadata) {
    errors.push("AppModule must have statically inspectable @Module metadata.");
    return [];
  }
  const names: string[] = [];
  for (const element of arrayProperty(metadata, "imports")) {
    if (!ts.isIdentifier(element)) {
      errors.push(`AppModule import is not a direct registered module identifier: ${element.getText(parsed)}`);
      continue;
    }
    names.push(element.text);
  }
  return names;
}

async function validateModuleRegistry(errors: string[], inputs: AuditInputs): Promise<string[]> {
  const appModules = await appModuleImports(errors, inputs);
  const registered = SIMULATION_MODULE_REGISTRY.map((module) => module.module_class);
  const registeredSet = new Set<string>(registered);
  const duplicates = registered.filter((name, index) => registered.indexOf(name) !== index);
  if (duplicates.length) errors.push(`Duplicate Simulation module registrations: ${[...new Set(duplicates)].join(", ")}`);
  const missing = appModules.filter((name) => !registeredSet.has(name));
  const removed = registered.filter((name) => !appModules.includes(name));
  if (missing.length) errors.push(`AppModule modules missing Simulation classification: ${missing.join(", ")}`);
  if (removed.length) errors.push(`Simulation registry modules absent from AppModule: ${removed.join(", ")}`);

  for (const registration of SIMULATION_MODULE_REGISTRY) {
    const path = absolute(registration.module_file);
    let parsed: ts.SourceFile;
    try {
      parsed = await inputs.parsed(path);
    } catch {
      errors.push(`${registration.module_class} module file does not exist: ${registration.module_file}`);
      continue;
    }
    const declaration = parsed.statements.find((node): node is ts.ClassDeclaration => (
      ts.isClassDeclaration(node) && node.name?.text === registration.module_class
    ));
    if (!declaration || !moduleMetadata(declaration)) {
      errors.push(`${registration.module_class} is not the @Module class exported by ${registration.module_file}`);
    }
    if (registration.disposition !== "campus_operational" && !registration.exclusion_reason?.trim()) {
      errors.push(`${registration.module_class} exclusion requires a narrow reviewed reason.`);
    }
    for (const root of registration.source_roots) {
      try { await stat(absolute(root)); } catch { errors.push(`${registration.module_class} source root does not exist: ${root}`); }
    }
  }
  return appModules;
}

function containsTestCase(parsed: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && (node.expression.text === "it" || node.expression.text === "test")) found = true;
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

async function validateEvidence(errors: string[], inputs: AuditInputs): Promise<void> {
  await inputs.prefetch([...SIMULATION_CONFORMANCE_EVIDENCE, ...SIMULATION_SAFETY_EVIDENCE].map(evidence => absolute(evidence.test_file)));
  const ids = SIMULATION_CONFORMANCE_EVIDENCE.map((item) => item.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) errors.push(`Duplicate Simulation evidence ids: ${[...new Set(duplicates)].join(", ")}`);
  for (const evidence of SIMULATION_CONFORMANCE_EVIDENCE) {
    const path = absolute(evidence.test_file);
    try {
      const parsed = await inputs.parsed(path);
      if (!containsTestCase(parsed)) errors.push(`${evidence.id} points to a file with no executable test case.`);
    } catch {
      errors.push(`${evidence.id} test file does not exist: ${evidence.test_file}`);
    }
    if ((evidence.module_classes as readonly string[]).length === 0) {
      errors.push(`${evidence.id} must name the modules it actually exercises.`);
    }
  }

  const safetyIds = SIMULATION_SAFETY_EVIDENCE.map((item) => item.id);
  const safetyDuplicates = safetyIds.filter((id, index) => safetyIds.indexOf(id) !== index);
  if (safetyDuplicates.length) errors.push(`Duplicate Simulation safety evidence ids: ${[...new Set(safetyDuplicates)].join(", ")}`);
  for (const evidence of SIMULATION_SAFETY_EVIDENCE) {
    const path = absolute(evidence.test_file);
    try {
      const parsed = await inputs.parsed(path);
      if (!containsTestCase(parsed)) errors.push(`${evidence.id} points to a file with no executable test case.`);
    } catch {
      errors.push(`${evidence.id} test file does not exist: ${evidence.test_file}`);
    }
  }
  const knownSafetyEvidence = new Set<string>(safetyIds);
  for (const worker of SIMULATION_WORKER_REGISTRY as readonly SimulationWorkerRegistration[]) {
    if (worker.conformance === "verified" && !(worker.evidence?.length)) {
      errors.push(`Verified Simulation worker has no executable safety evidence: ${worker.owner}`);
    }
    for (const evidenceId of worker.evidence ?? []) {
      if (!knownSafetyEvidence.has(evidenceId)) errors.push(`Unknown worker safety evidence ${evidenceId}: ${worker.owner}`);
    }
  }
  for (const boundary of SIMULATION_BOUNDARY_REGISTRY as readonly SimulationBoundaryRegistration[]) {
    if (boundary.conformance === "verified" && boundary.evidence.length === 0) {
      errors.push(`Verified Simulation boundary has no executable safety evidence: ${boundary.file}:${boundary.kind}`);
    }
    for (const evidenceId of boundary.evidence) {
      if (!knownSafetyEvidence.has(evidenceId)) errors.push(`Unknown boundary safety evidence ${evidenceId}: ${boundary.file}:${boundary.kind}`);
    }
  }
}

function timerCounts(path: string, parsed: ts.SourceFile): TimerInventory | null {
  let interval = 0;
  let timeout = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === "setInterval") interval += 1;
      if (node.expression.text === "setTimeout") timeout += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return interval || timeout
    ? { file: repoPath(path), interval_calls: interval, timeout_calls: timeout }
    : null;
}

async function timerInventory(allBackendFiles: readonly string[], errors: string[], inputs: AuditInputs): Promise<TimerInventory[]> {
  await inputs.prefetch(allBackendFiles);
  const actual: TimerInventory[] = [];
  for (const path of allBackendFiles) {
    const item = timerCounts(path, await inputs.parsed(path));
    if (item) actual.push(item);
  }
  const expected = SIMULATION_WORKER_REGISTRY.map(({ file, interval_calls, timeout_calls }) => ({
    file, interval_calls, timeout_calls,
  }));
  const key = (item: TimerInventory) => `${item.file}:${item.interval_calls}:${item.timeout_calls}`;
  const expectedKeys = new Set(expected.map(key));
  const actualKeys = new Set(actual.map(key));
  const unexpected = actual.filter((item) => !expectedKeys.has(key(item)));
  const absent = expected.filter((item) => !actualKeys.has(key(item)));
  if (unexpected.length) errors.push(`Unreviewed native timers: ${unexpected.map(key).join(", ")}`);
  if (absent.length) errors.push(`Stale native-timer registrations: ${absent.map(key).join(", ")}`);
  return actual.sort((left, right) => left.file.localeCompare(right.file));
}

async function standaloneWorkerInventory(
  allBackendFiles: readonly string[],
  errors: string[],
  inputs: AuditInputs,
): Promise<StandaloneWorkerInventory[]> {
  const actual: StandaloneWorkerInventory[] = [];
  for (const path of allBackendFiles) {
    const parsed = await inputs.parsed(path);
    const importsPromiseTimer = parsed.statements.some((node) => (
      ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text === "node:timers/promises"
      && node.importClause?.namedBindings
      && ts.isNamedImports(node.importClause.namedBindings)
      && node.importClause.namedBindings.elements.some((element) => (
        (element.propertyName?.text ?? element.name.text) === "setTimeout"
      ))
    ));
    if (!importsPromiseTimer) continue;
    let hasLoop = false;
    let drainsTransport = false;
    const visit = (node: ts.Node): void => {
      if (ts.isWhileStatement(node)) hasLoop = true;
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === "drainPending") drainsTransport = true;
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    if (!hasLoop || !drainsTransport) {
      errors.push(`Standalone timer worker is not a statically reviewed delivery loop: ${repoPath(path)}`);
    }
    actual.push({ file: repoPath(path), mechanism: "timers_promises_loop" });
  }
  const expected = SIMULATION_STANDALONE_WORKER_REGISTRY.map(({ file, mechanism }) => ({ file, mechanism }));
  const key = (item: StandaloneWorkerInventory) => `${item.file}:${item.mechanism}`;
  const actualKeys = new Set(actual.map(key));
  const expectedKeys = new Set(expected.map(key));
  const unexpected = actual.filter((item) => !expectedKeys.has(key(item)));
  const absent = expected.filter((item) => !actualKeys.has(key(item)));
  if (unexpected.length) errors.push(`Unreviewed standalone workers: ${unexpected.map(key).join(", ")}`);
  if (absent.length) errors.push(`Stale standalone-worker registrations: ${absent.map(key).join(", ")}`);
  return actual.sort((left, right) => left.file.localeCompare(right.file));
}

function nodeLocation(parsed: ts.SourceFile, node: ts.Node): string {
  const point = parsed.getLineAndCharacterOfPosition(node.getStart(parsed));
  return `${repoPath(parsed.fileName)}:${point.line + 1}`;
}

async function scanOperationalBoundaries(operationalFiles: readonly string[], inputs: AuditInputs): Promise<{
  wallClockCalls: string[];
  externalEffectCalls: string[];
}> {
  const wallClockCalls: string[] = [];
  const externalEffectCalls: string[] = [];
  for (const path of operationalFiles) {
    const parsed = await inputs.parsed(path);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        if (ts.isPropertyAccessExpression(node.expression)
          && ts.isIdentifier(node.expression.expression)
          && node.expression.expression.text === "Date"
          && node.expression.name.text === "now") {
          wallClockCalls.push(`${nodeLocation(parsed, node)}:Date.now`);
        }
        if ((ts.isIdentifier(node.expression) && node.expression.text === "fetch")
          || (ts.isPropertyAccessExpression(node.expression)
            && node.expression.name.text === "fetcher")) {
          externalEffectCalls.push(`${nodeLocation(parsed, node)}:fetch`);
        }
      }
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)
        && node.expression.text === "Date" && (node.arguments?.length ?? 0) === 0) {
        wallClockCalls.push(`${nodeLocation(parsed, node)}:new Date`);
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
        && ["node:fs", "node:fs/promises", "fs", "fs/promises"].includes(node.moduleSpecifier.text)) {
        externalEffectCalls.push(`${nodeLocation(parsed, node)}:${node.moduleSpecifier.text}`);
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
        && node.moduleSpecifier.text === "nodemailer") {
        externalEffectCalls.push(`${nodeLocation(parsed, node)}:nodemailer`);
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
  }
  return { wallClockCalls: wallClockCalls.sort(), externalEffectCalls: externalEffectCalls.sort() };
}

function generatedSource(audit: SimulationConformanceAudit): string {
  const entries = Object.entries(audit.components).sort(([left], [right]) => left.localeCompare(right));
  return `/**\n * Generated conformance receipt. Update only with\n * \`npm run simulation:conformance:update\` after increasing the manual revision\n * in simulation-conformance.registry.ts and reviewing the reported drift.\n */\nexport const SIMULATION_CONFORMANCE_BUILD = Object.freeze({\n  revision: ${audit.revision},\n  fingerprint: ${JSON.stringify(audit.fingerprint)},\n  components: Object.freeze({\n${entries.map(([name, value]) => `    ${name}: ${JSON.stringify(value)},`).join("\n")}\n  }),\n} as const);\n`;
}

export async function auditSimulationConformance(): Promise<SimulationConformanceAudit> {
  const inputs = new AuditInputs();
  const errors: string[] = [];
  const appModules = await validateModuleRegistry(errors, inputs);
  await validateEvidence(errors, inputs);
  if (SIMULATION_EFFECT_FAMILY_REGISTRY.join("\0") !== EXECUTION_EFFECT_KINDS.join("\0")) {
    errors.push("Execution effect families differ from the reviewed Simulation sink registry.");
  }

  const allBackendFiles = await filesBelow(absolute("backend/src"), ".ts");
  const platformRuntimeFiles = allBackendFiles.filter((path) => path !== generatedPath);
  const timers = await timerInventory(allBackendFiles, errors, inputs);
  const standaloneWorkers = await standaloneWorkerInventory(allBackendFiles, errors, inputs);
  const operationalRoots = SIMULATION_MODULE_REGISTRY
    .filter((module) => module.disposition === "campus_operational")
    .flatMap((module) => module.source_roots.map(absolute));
  const operationalFiles = [...new Set((await Promise.all(operationalRoots.map((root) => filesBelow(root, ".ts")))).flat())].sort();
  const sharedMaterialFiles = SIMULATION_SHARED_MATERIAL_FILES.map(absolute);
  const boundaryScanFiles = [...operationalFiles, ...sharedMaterialFiles];
  const boundaries = await scanOperationalBoundaries([...new Set(boundaryScanFiles)].sort(), inputs);
  const actualBoundaries = new Map<string, number>();
  for (const item of boundaries.wallClockCalls) {
    const match = /^(.+\.tsx?):\d+:(.+)$/u.exec(item);
    if (!match) throw new Error(`Invalid wall-clock audit location: ${item}`);
    const key = `${match[1]}:wall_clock`;
    actualBoundaries.set(key, (actualBoundaries.get(key) ?? 0) + 1);
  }
  for (const item of boundaries.externalEffectCalls) {
    const match = /^(.+\.tsx?):\d+:(.+)$/u.exec(item);
    if (!match) throw new Error(`Invalid external-effect audit location: ${item}`);
    const kind = match[2] === "fetch" || match[2] === "nodemailer" ? "network" : "filesystem";
    const key = `${match[1]}:${kind}`;
    actualBoundaries.set(key, (actualBoundaries.get(key) ?? 0) + 1);
  }
  const expectedBoundaries = new Map(SIMULATION_BOUNDARY_REGISTRY.map((boundary) => [
    `${boundary.file}:${boundary.kind}`,
    boundary.occurrences,
  ]));
  const boundaryDrift = [...new Set([...actualBoundaries.keys(), ...expectedBoundaries.keys()])]
    .filter((key) => actualBoundaries.get(key) !== expectedBoundaries.get(key))
    .map((key) => `${key}:actual=${actualBoundaries.get(key) ?? 0}:expected=${expectedBoundaries.get(key) ?? 0}`);
  if (boundaryDrift.length) errors.push(`Unreviewed execution boundary drift: ${boundaryDrift.join(", ")}`);
  const moduleFiles = SIMULATION_MODULE_REGISTRY.map((module) => absolute(module.module_file));
  const evidenceTestFiles = [...new Set([
    ...SIMULATION_CONFORMANCE_EVIDENCE.map((evidence) => absolute(evidence.test_file)),
    ...SIMULATION_SAFETY_EVIDENCE.map((evidence) => absolute(evidence.test_file)),
  ])];
  const schemaFiles = await filesBelow(absolute("backend/migrations"), ".sql");
  const frontendOperationalFiles = (await filesBelow(absolute("frontend/src")))
    .filter((path) => /\.(?:css|ts|tsx)$/u.test(path))
    .filter((path) => !/(?:^|\/)(?:__tests__|test)(?:\/|$)|\.(?:test|spec)\.[^.]+$/u.test(posixPath(path)));
  // The active universal app lives in mobile/. Admit only the explicitly
  // reviewed runtime inputs, alongside the retained frontend source floor.
  // A test, traversal, missing file or symlink cannot stand in for runtime code.
  for (const input of SIMULATION_FRONTEND_ENVIRONMENT_FILES) {
    const path = absolute(input);
    if (/^mobile\/(?:app|src)\//u.test(input)) {
      const normalized = repoPath(path), metadata = await stat(path).catch(() => null);
      if (normalized !== input || !/\.tsx?$/u.test(input)
        || /(?:^|\/)(?:__tests__|test)(?:\/|$)|\.(?:test|spec)\.[^.]+$/u.test(input)
        || !metadata?.isFile() || await realpath(path) !== path) {
        errors.push(`Frontend execution-environment file is not operational source: ${input}`);
        continue;
      }
      if (!frontendOperationalFiles.includes(path)) frontendOperationalFiles.push(path);
    } else if (!frontendOperationalFiles.includes(path)) {
      errors.push(`Frontend execution-environment file is not operational source: ${repoPath(path)}`);
    }
  }
  const workerFiles = [...timers, ...standaloneWorkers].map((item) => absolute(item.file));
  const effectFiles = [
    absolute("backend/src/campus-model-core/execution-effects.contracts.ts"),
    absolute("backend/src/campus-model-core/execution-effects.runtime.ts"),
    absolute("backend/src/common/simulation-effects.ts"),
    ...boundaries.externalEffectCalls.map((item) => absolute(item.split(":", 1)[0]!)),
  ];
  const timeFiles = [
    ...SIMULATION_CLOCK_BOUNDARY_FILES.map(absolute),
    ...boundaries.wallClockCalls.map((item) => absolute(item.split(":", 1)[0]!)),
  ];
  const registryFile = absolute("backend/src/simulation-conformance/simulation-conformance.registry.ts");
  const components = Object.freeze({
    conformance_verifier: await digestFiles([fileURLToPath(import.meta.url)], true, inputs),
    effects: await digestFiles([...new Set(effectFiles)], true, inputs),
    evidence_tests: await digestFiles(evidenceTestFiles, true, inputs),
    frontend_environment: await digestFiles(frontendOperationalFiles, true, inputs),
    shared_contracts: await digestClientContracts(absolute("packages/contracts/src"), inputs),
    module_graph: await digestFiles([absolute("backend/src/app.module.ts"), registryFile, ...moduleFiles], true, inputs),
    operational_sources: await digestFiles(operationalFiles, true, inputs),
    platform_runtime_sources: await digestFiles(platformRuntimeFiles, true, inputs),
    shared_material: await digestFiles(sharedMaterialFiles, true, inputs),
    schema: await digestFiles(schemaFiles, false, inputs),
    time: await digestFiles([...new Set(timeFiles)], true, inputs),
    workers: sha(`${await digestFiles(workerFiles, true, inputs)}\0${JSON.stringify(SIMULATION_WORKER_REGISTRY)}\0${JSON.stringify(SIMULATION_STANDALONE_WORKER_REGISTRY)}`),
  });
  const fingerprint = sha(JSON.stringify({ revision: SIMULATION_CONFORMANCE_REVISION, components }));
  return Object.freeze({
    revision: SIMULATION_CONFORMANCE_REVISION,
    fingerprint,
    components,
    app_modules: Object.freeze(appModules),
    timers: Object.freeze(timers),
    standalone_workers: Object.freeze(standaloneWorkers),
    wall_clock_calls: Object.freeze(boundaries.wallClockCalls),
    external_effect_calls: Object.freeze(boundaries.externalEffectCalls),
    evidence_blockers: evaluateRegisteredModuleEvidence().incomplete,
    errors: Object.freeze(errors),
  });
}

async function main(): Promise<void> {
  const audit = await auditSimulationConformance();
  const update = process.argv.includes("--write");
  const print = process.argv.includes("--print");
  const json = process.argv.includes("--json");
  if (json) process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
  if (print) process.stdout.write(generatedSource(audit));
  if (audit.errors.length) {
    throw new Error(`Simulation conformance audit failed:\n- ${audit.errors.join("\n- ")}`);
  }
  if (update) {
    const pending = String(SIMULATION_CONFORMANCE_BUILD.fingerprint) === "sha256:pending";
    if (!pending && Number(SIMULATION_CONFORMANCE_BUILD.revision) >= audit.revision) {
      throw new Error("Increase SIMULATION_CONFORMANCE_REVISION before accepting platform drift.");
    }
    await writeFile(generatedPath, generatedSource(audit), "utf8");
    process.stdout.write(`Updated Simulation conformance lock ${audit.fingerprint}.\n`);
    return;
  }
  if (Number(SIMULATION_CONFORMANCE_BUILD.revision) !== audit.revision
    || String(SIMULATION_CONFORMANCE_BUILD.fingerprint) !== audit.fingerprint
    || !sameComponents(SIMULATION_CONFORMANCE_BUILD.components, audit.components)) {
    throw new Error(
      "Simulation conformance lock is stale. Review the audit, increase "
      + "SIMULATION_CONFORMANCE_REVISION, then run npm run simulation:conformance:update.",
    );
  }
  if (!json && !print) process.stdout.write(`Simulation conformance lock verified (${audit.fingerprint}).\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
