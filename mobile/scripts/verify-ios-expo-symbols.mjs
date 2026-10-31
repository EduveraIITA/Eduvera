import { existsSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Read the actual Mach-O imports/exports. A successful Xcode link does not
// validate the ABI between independently precompiled dynamic frameworks.
const requested = process.argv[2];
if (!requested || process.argv.length !== 3) throw new Error('Usage: node scripts/verify-ios-expo-symbols.mjs /path/to/ThatCampus.app');
const architecture = process.env.THATCAMPUS_IOS_ABI_ARCH || 'arm64';
const app = realpathSync(requested), frameworks = path.join(app, 'Frameworks');
const binaries = readdirSync(app).filter(name => name.endsWith('.dylib')).map(name => path.join(app, name));
const executable = spawnSync('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', path.join(app, 'Info.plist')], { encoding: 'utf8' });
if (executable.error || executable.status !== 0 || !executable.stdout.trim()) throw new Error('The app executable could not be read from Info.plist.');
binaries.push(path.join(app, executable.stdout.trim()));
const embedded = new Map();
for (const entry of readdirSync(frameworks)) {
  if (!entry.endsWith('.framework')) continue;
  const name = entry.slice(0, -'.framework'.length), binary = path.join(frameworks, entry, name);
  if (!existsSync(binary)) throw new Error(`Framework executable is missing: ${binary}`);
  binaries.push(binary);
  if (name.startsWith('Expo')) embedded.set(name, binary);
}
if (!embedded.has('ExpoModulesCore')) throw new Error('The app does not embed ExpoModulesCore.framework.');

function inspect(option, binary) {
  const result = spawnSync('/usr/bin/xcrun', ['dyld_info', '-arch', architecture, option, binary], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${option} failed for ${binary}: ${result.stderr}`);
  return result.stdout.split('\n');
}
const exportsByFramework = new Map([...embedded].map(([name, binary]) => [name, new Set(inspect('-exports', binary).flatMap(line => {
  const match = line.match(/^\s+0x[\dA-Fa-f]+\s+(\S+)/);
  return match ? [match[1]] : [];
}))]));
const missing = [], checkedByFramework = {}, obsoleteClassTypeImports = [];
let checkedImports = 0;
for (const binary of binaries) {
  for (const line of inspect('-imports', binary)) {
    const match = line.match(/^\s+0x[\dA-Fa-f]+\s+(\S+)\s+(\[weak-import\]\s+)?\(from ([^)]+)\)/);
    if (!match) continue;
    const [, symbol, weak, provider] = match;
    if (symbol.includes('_classTypes')) obsoleteClassTypeImports.push({ binary: path.relative(app, binary), provider, symbol });
    if (weak || !provider.startsWith('Expo')) continue;
    if (!exportsByFramework.has(provider)) {
      missing.push({ binary: path.relative(app, binary), provider, symbol, reason: 'Framework is not embedded' });
      continue;
    }
    checkedImports++;
    checkedByFramework[provider] = (checkedByFramework[provider] ?? 0) + 1;
    if (!exportsByFramework.get(provider).has(symbol)) missing.push({ binary: path.relative(app, binary), provider, symbol });
  }
}
if (!checkedImports) throw new Error('No imports from embedded Expo frameworks were checked.');
console.log(JSON.stringify({ app, architecture, checkedBinaries: binaries.length, checkedImports, checkedByFramework, obsoleteClassTypeImports, missing, passed: missing.length === 0 }, null, 2));
if (missing.length) process.exitCode = 1;
