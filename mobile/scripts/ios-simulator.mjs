import { existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function entries(path) { try { return readdirSync(path).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); } catch { return []; } }
function canonical(path) { try { return realpathSync(path); } catch { return resolve(path); } }
function developerPath(path) { const source = resolve(path); return canonical(source.endsWith('.app') ? join(source, 'Contents/Developer') : source); }
function validateXcode(path) {
  const directory = developerPath(path), command = join(directory, 'usr/bin/xcodebuild');
  if (!existsSync(command)) return null;
  const result = spawnSync(command, ['-version'], { env: { ...process.env, DEVELOPER_DIR: directory }, encoding: 'utf8', timeout: 15_000 });
  return result.status === 0 && /^Xcode \d/m.test(result.stdout ?? '') ? { directory, command, version: result.stdout.trim().replaceAll('\n', ' · ') } : null;
}

export function parseListenerPids(output) {
  const lines = output.trim() ? output.trim().split(/\s+/) : [];
  if (lines.some(line => !/^\d+$/.test(line) || !Number.isSafeInteger(Number(line)) || Number(line) < 2)) throw new Error('The port 8081 listener identity could not be read. Nothing was opened.');
  return [...new Set(lines.map(Number))];
}

export function isSameProjectMetro(projectRoot, identity) {
  return identity?.cwd === projectRoot && typeof identity.command === 'string'
    && /(?:^|[\/\s])(?:expo(?:\/bin\/cli(?:\.js)?)?|@expo\/cli\/(?:build\/)?bin\/cli(?:\.js)?)(?:\s|$)/.test(identity.command)
    && /(?:^|\s)start(?:\s|$)/.test(identity.command);
}

export function metroPortDecision(projectRoot, listeners, identities) {
  if (!listeners.length) return { state: 'free' };
  if (listeners.length === 1 && isSameProjectMetro(projectRoot, identities[listeners[0]])) return { state: 'reuse', pid: listeners[0] };
  throw new Error('Port 8081 is occupied by a different or unverified project. Nothing was opened or stopped. Keep that server running and use npm run ios:build; start ThatCampus Metro when 8081 is available. This launcher does not select another port.');
}

function inspectMetroPort(projectRoot) {
  const listener = spawnSync('/usr/sbin/lsof', ['-nP', '-iTCP:8081', '-sTCP:LISTEN', '-t'], { encoding: 'utf8', timeout: 5000 });
  if (listener.error || ![0, 1].includes(listener.status) || listener.status === 1 && (listener.stdout?.trim() || listener.stderr?.trim())) throw new Error('Port 8081 could not be inspected. Nothing was opened or stopped.');
  const listeners = parseListenerPids(listener.stdout ?? ''), identities = {};
  for (const pid of listeners) {
    const cwd = spawnSync('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8', timeout: 5000 });
    const command = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 5000 });
    if (cwd.error || cwd.status !== 0 || command.error || command.status !== 0) throw new Error('The port 8081 process changed during inspection. Nothing was opened or stopped.');
    const paths = (cwd.stdout ?? '').split('\n').filter(line => line.startsWith('n')).map(line => canonical(line.slice(1)));
    if (paths.length !== 1) throw new Error('The port 8081 project directory could not be confirmed. Nothing was opened or stopped.');
    identities[pid] = { cwd: paths[0], command: (command.stdout ?? '').trim() };
  }
  return metroPortDecision(canonical(projectRoot), listeners, identities);
}

async function main() {
let xcode;
if (process.env.DEVELOPER_DIR) {
  xcode = validateXcode(process.env.DEVELOPER_DIR);
  if (!xcode) throw new Error('DEVELOPER_DIR does not identify a working Xcode installation. Set it to Xcode.app/Contents/Developer; this explicit override was not replaced.');
} else {
  const selected = spawnSync('/usr/bin/xcode-select', ['-p'], { encoding: 'utf8' }).stdout?.trim();
  // Downloads may be a link to an unindexed external volume on this Mac.
  const applications = ['/Applications', join(homedir(), 'Applications'), join(homedir(), 'Downloads')]
    .flatMap(base => entries(base).filter(name => /^Xcode.*\.app$/i.test(name)).map(name => join(base, name)));
  const indexed = spawnSync('/usr/bin/mdfind', ['kMDItemCFBundleIdentifier == "com.apple.dt.Xcode"'], { encoding: 'utf8', timeout: 5000 }).stdout?.trim().split('\n').filter(Boolean) ?? [];
  for (const candidate of new Set([selected, ...applications, ...indexed].filter(Boolean).map(developerPath))) {
    xcode = validateXcode(candidate); if (xcode) break;
  }
}
if (!xcode) throw new Error('Install Xcode in Applications or Downloads, or set DEVELOPER_DIR to its Contents/Developer folder. A working xcodebuild is required.');
const env = { ...process.env, DEVELOPER_DIR: xcode.directory, EXPO_NO_GIT_STATUS: '1' };
function resolvePods() {
  const versions = [join(homedir(), '.rbenv/versions'), join(homedir(), '.rvm/rubies'), join(homedir(), '.asdf/installs/ruby'), join(homedir(), '.local/share/mise/installs/ruby'), join(homedir(), '.gem/ruby')];
  const bins = [...(process.env.PATH ?? '').split(delimiter), '/opt/homebrew/bin', '/usr/local/bin', ...[process.env.GEM_HOME, ...(process.env.GEM_PATH ?? '').split(delimiter)].filter(Boolean).map(path => join(path, 'bin')), ...versions.flatMap(base => entries(base).map(version => join(base, version, 'bin')))];
  for (const command of new Set(bins.filter(Boolean).map(bin => canonical(join(bin, 'pod'))))) {
    if (!existsSync(command)) continue;
    // RubyGems wrappers may need their matching Ruby as well as the pod executable.
    const path = [dirname(command), process.env.PATH ?? ''].join(delimiter);
    const result = spawnSync(command, ['--version'], { cwd: root, env: { ...env, PATH: path }, encoding: 'utf8', timeout: 15_000 });
    if (result.status === 0 && /^\d+\.\d+/m.test(result.stdout ?? '')) return { command, path, version: result.stdout.trim() };
  }
  throw new Error('A working CocoaPods executable was not found in PATH, Homebrew or installed user Ruby versions. Add its bin folder to PATH before preparing iOS.');
}
const prepare = process.argv.includes('--prepare') || !existsSync(join(root, 'ios/ThatCampus.xcworkspace'));
const checkOnly = process.argv.includes('--check');
const pods = prepare || checkOnly ? resolvePods() : null;
if (pods) env.PATH = pods.path;
if (checkOnly) {
  console.log(`Xcode: ${xcode.directory}\n${xcode.version}\nCocoaPods: ${pods.command} (${pods.version})\nToolchain check passed. No preparation, pod install, cache changes, build or simulator launch was run.`);
  process.exit(0);
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.signal ? `signal ${result.signal}` : `status ${result.status}`}.`);
  return result;
}
if (prepare) {
  run('npx', ['expo', 'prebuild', '--platform', 'ios', '--no-install']);
  run(pods.command, ['install', '--project-directory=ios']);
}
run(process.execPath, ['scripts/prepare-ios-cache.mjs']);
if (process.argv.includes('--prepare-only')) process.exit(0);
const buildOnly = process.argv.includes('--build-only');
// Refuse a foreign server before starting the simulator workflow. Recheck after
// the build too: another project can claim a previously free port meanwhile.
if (!buildOnly) inspectMetroPort(root);
const listing = spawnSync('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], { env, encoding: 'utf8' });
if (listing.error || listing.status !== 0) throw new Error('The available simulator devices could not be read.');
const devices = Object.entries(JSON.parse(listing.stdout).devices).filter(([key]) => key.includes('iOS')).reverse().flatMap(([, values]) => values);
const requested = process.argv.find(arg => arg.startsWith('--device='))?.slice('--device='.length);
const device = requested ? devices.find(item => item.udid === requested || item.name === requested) : devices.find(item => item.state === 'Booted') ?? devices.find(item => item.name.startsWith('iPhone'));
if (!device) throw new Error('No matching simulator is available. Use --device=<UUID or device name>.');
const build = join(homedir(), 'Library/Caches/ThatCampus/iOSBuild');
mkdirSync(build, { recursive: true });
run(xcode.command, ['-workspace', 'ios/ThatCampus.xcworkspace', '-scheme', 'ThatCampus', '-configuration', 'Debug', '-sdk', 'iphonesimulator', '-destination', `id=${device.udid}`, '-derivedDataPath', build, '-jobs', '2', 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-']);
if (device.state !== 'Booted') run('xcrun', ['simctl', 'boot', device.udid]);
run('xcrun', ['simctl', 'bootstatus', device.udid, '-b']);
run('xcrun', ['simctl', 'install', device.udid, join(build, 'Build/Products/Debug-iphonesimulator/ThatCampus.app')]);
if (buildOnly) process.exit(0);
const available = inspectMetroPort(root);
// Launch the installed CLI directly so the owned child is the Expo process.
// CI makes the explicit port a hard requirement; it cannot prompt for 8082.
const metro = available.state === 'free' ? spawn(process.execPath, [join(root, 'node_modules/expo/bin/cli'), 'start', '--dev-client', '--host', 'localhost', '--port', '8081', '--max-workers', '2'], { cwd: root, env: { ...env, CI: '1' }, stdio: 'inherit' }) : null;
let metroExit = null, metroError = null;
if (metro) {
  metro.on('exit', (code, signal) => { metroExit = { code, signal }; });
  metro.on('error', error => { metroError = error; });
  process.on('SIGINT', () => metro.kill('SIGINT'));
}
console.log(`\nThatCampus is installed on ${device.name}. ${metro ? 'Waiting for' : `Reusing verified project Metro (pid ${available.pid}) at`} http://localhost:8081.\nXcode 27 displays simulator devices in Device Hub.`);
let opened = false;
try {
for (let attempt = 0; attempt < 90; attempt++) {
  if (metroError || metroExit) throw new Error('The owned Metro process did not stay running. Nothing was opened; no other server was stopped.');
  const before = inspectMetroPort(root);
  let ready = false;
  try {
    const response = await fetch('http://localhost:8081/status', { signal: AbortSignal.timeout(1000) });
    ready = response.ok && (await response.text()).includes('packager-status:running');
  } catch { /* Connection and timeout failures are normal while our server starts. */ }
  if (ready) {
    const after = inspectMetroPort(root);
    if (before.state === 'reuse') {
      if (after.state !== 'reuse' || before.pid !== after.pid || metroExit || metroError) throw new Error('The verified Metro process changed before launch. Nothing was opened.');
      run('xcrun', ['simctl', 'openurl', device.udid, 'thatcampus://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081']);
      opened = true;
      break;
    }
    // A previously free port may have become ready during the fetch. Verify a
    // stable PID on the next attempt rather than opening on that first sighting.
  }
  if (attempt === 89) throw new Error('Verified ThatCampus Metro did not become ready within 90 attempts. Nothing was opened.');
  await new Promise(resolve => setTimeout(resolve, 1000));
}
} finally { if (!opened && metro && !metroExit) metro.kill('SIGINT'); }
if (metro) {
  // Keep a newly started server attached to this launcher. An existing verified
  // server is reused without taking ownership of its lifecycle.
  if (metroExit) process.exitCode = metroExit.code ?? 1;
  else metro.on('exit', code => { process.exitCode = code ?? 0; });
}
}

if (process.argv[1] && canonical(process.argv[1]) === canonical(fileURLToPath(import.meta.url))) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'The iOS launcher could not complete.'); process.exitCode = 1; });
}
