import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const allowed = new Set(['--prepare', '--check', '--preview']);
const fail = message => { throw new Error(message); };

function samePath(left, right) {
  const resolved = value => existsSync(value) ? realpathSync(value) : path.resolve(value);
  return resolved(left) === resolved(right);
}

function properties(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*([^#!\s=:]+)\s*(?:[=:]\s*|\s+)(.*?)\s*$/);
    return match ? [[match[1], match[2]]] : [];
  }));
}

function javaMajor(home) {
  if (!home || !existsSync(path.join(home, 'bin', 'java'))) return null;
  const result = spawnSync(path.join(home, 'bin', 'java'), ['-version'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const version = `${result.stderr ?? ''}${result.stdout ?? ''}`.match(/version\s+"(\d+)/);
  return version ? Number(version[1]) : null;
}

function javaHomes(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => {
    const base = path.join(directory, entry.name);
    const nested = readdirSync(base, { withFileTypes: true }).filter(child => child.isDirectory()).map(child => path.join(base, child.name));
    return [base, path.join(base, 'Contents', 'Home'), ...nested.flatMap(home => [home, path.join(home, 'Contents', 'Home')])];
  });
}

function run(command, commandArgs, env, cwd = root) {
  const result = spawnSync(command, commandArgs, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`${path.basename(command)} did not complete (${result.signal ?? result.status}).`);
}

try {
  for (const arg of args) if (!allowed.has(arg)) fail(`Unknown option: ${arg}. Use --check, --prepare or --preview.`);
  const preview = args.has('--preview');
  let previewOrigin;
  if (preview) {
    try {
      const url = new URL(process.env.EXPO_PUBLIC_API_URL ?? '');
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.hostname.endsWith('.invalid')) throw new Error();
      previewOrigin = url.origin;
    } catch { fail('Set EXPO_PUBLIC_API_URL to the HTTPS origin of the temporary review backend before building a local preview.'); }
  }
  if (process.platform === 'win32') fail('This bounded build recipe currently supports macOS and Linux.');
  const sdk = path.resolve(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '/Volumes/MacSSD/Developer/Android/sdk');
  if (process.env.ANDROID_HOME && process.env.ANDROID_SDK_ROOT && !samePath(process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT)) {
    fail('ANDROID_HOME and ANDROID_SDK_ROOT select different SDKs. Set them to the same installed SDK.');
  }
  const gradleHome = path.resolve(process.env.GRADLE_USER_HOME || (existsSync('/Volumes/MacSSD')
    ? '/Volumes/MacSSD/Caches/ThatCampus/Gradle'
    : path.join(homedir(), '.cache', 'thatcampus', 'gradle')));
  const installedJava = [...javaHomes('/Library/Java/JavaVirtualMachines'), ...javaHomes('/usr/lib/jvm')];
  const launcher = [process.env.JAVA_HOME, '/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home', ...installedJava]
    .filter(Boolean).map(home => path.resolve(home)).find(home => javaMajor(home) === 21 && existsSync(path.join(home, 'bin', 'javac')));
  if (!launcher) fail('Install Java21 or set JAVA_HOME to an installed Java21 JDK.');
  const compiler = [process.env.JAVA17_HOME, process.env.JAVA_HOME, ...installedJava, ...javaHomes(path.join(gradleHome, 'jdks'))]
    .filter(Boolean).map(home => path.resolve(home)).find(home => javaMajor(home) === 17 && existsSync(path.join(home, 'bin', 'javac')));
  if (!compiler) fail('React Native requires a Java17 compiler in addition to the Java21 Gradle launcher. Install it or set JAVA17_HOME; this script does not download JDKs.');

  const needed = [
    ['platforms/android-37.0', 'android.jar'],
    ['build-tools/37.0.0', 'aapt2'],
    ['build-tools/36.0.0', 'aapt2'],
    ['ndk/27.1.12297006', 'build/cmake/android.toolchain.cmake'],
    ['cmake/3.30.5', 'bin/cmake'],
    ['cmake/3.22.1', 'bin/cmake'],
  ];
  const missing = needed.filter(([directory, executable]) => !existsSync(path.join(sdk, directory, 'source.properties')) || !existsSync(path.join(sdk, directory, executable)));
  if (missing.length) fail(`Missing Android SDK prerequisites in ${sdk}: ${missing.map(([directory]) => directory).join(', ')}. Install these through the official Google SDK tools after reviewing their terms. This script does not install SDK packages or accept licenses.`);
  for (const [directory] of needed.slice(1)) {
    const revision = properties(path.join(sdk, directory, 'source.properties'))['Pkg.Revision'];
    if (revision !== directory.split('/').at(-1)) fail(`Unexpected SDK revision in ${directory}: ${revision ?? 'unavailable'}.`);
  }
  const platform = properties(path.join(sdk, 'platforms/android-37.0/source.properties'));
  if (!['37', '37.0'].includes(platform['AndroidVersion.ApiLevel'])) fail('The installed Android37 platform metadata is incompatible with this build.');
  const localSdk = properties(path.join(root, 'android', 'local.properties'))['sdk.dir'];
  if (localSdk) {
    const unescaped = localSdk.replace(/\\u([\da-fA-F]{4})|\\(.)/g, (_whole, unicode, character) => unicode ? String.fromCharCode(parseInt(unicode, 16)) : ({ t: '\t', n: '\n', r: '\r', f: '\f' }[character] ?? character));
    if (!samePath(unescaped, sdk)) fail('android/local.properties selects another sdk.dir. Align it with the selected ANDROID_HOME before building.');
  }
  const criteria = properties(path.join(root, 'android/gradle/gradle-daemon-jvm.properties'));
  if (existsSync(path.join(root, 'android/gradle/gradle-daemon-jvm.properties')) && criteria.toolchainVersion !== '21') fail('Android Gradle daemon JVM criteria selects another Java version. Review it before building with Java21.');
  if (!existsSync(path.join(root, 'node_modules', 'expo', 'bin', 'cli'))) fail('Install the dependencies from mobile/package-lock.json before building.');
  console.log(`SDK: ${sdk}\nGradle Java21: ${launcher}\nReact Native compiler Java17: ${compiler}\nGradle cache: ${gradleHome}`);
  console.log(preview ? 'Output: local ARM64 preview APK with embedded JavaScript and CNG development signing; not a production/store release.' : 'Output: ARM64 debug APK; Gradle workers2, native compile/link pool2. Metro is required for application JavaScript.');
  if (args.has('--check')) process.exit(0);

  mkdirSync(gradleHome, { recursive: true });
  const androidUser = path.resolve(process.env.ANDROID_USER_HOME || path.join(path.dirname(sdk), 'user'));
  mkdirSync(androidUser, { recursive: true });
  const env = { ...process.env, JAVA_HOME: launcher, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk,
    ANDROID_USER_HOME: androidUser, GRADLE_USER_HOME: gradleHome, CMAKE_BUILD_PARALLEL_LEVEL: '2',
    EXPO_NO_GIT_STATUS: '1', EXPO_NO_TELEMETRY: '1', CI: '1', PATH: `${path.join(launcher, 'bin')}${path.delimiter}${process.env.PATH ?? ''}` };
  if (preview) Object.assign(env, { EXPO_PUBLIC_API_URL: previewOrigin, EAS_BUILD_PROFILE: 'preview', NODE_ENV: 'production', THATCAMPUS_ANDROID_PREVIEW_ORIGIN: previewOrigin });
  if (args.has('--prepare') || !existsSync(path.join(root, 'android', 'gradlew')) || (preview && !existsSync(path.join(root, 'android/app/src/release/AndroidManifest.xml')))) {
    run(process.execPath, ['node_modules/expo/bin/cli', 'prebuild', '--platform', 'android', '--no-install'], env);
  }
  run('./gradlew', [preview ? ':app:assembleRelease' : ':app:assembleDebug', '--init-script', path.join(root, 'scripts/android-gradle-bounded.init.gradle'),
    '--no-daemon', '--no-configuration-cache', '--max-workers=2', '--console=plain', '-Dorg.gradle.parallel=false',
    `-Dorg.gradle.java.home=${launcher}`, '-Dorg.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m', '-Dkotlin.daemon.jvm.options=-Xmx768m',
    '-PreactNativeArchitectures=arm64-v8a', '-Pandroid.builder.sdkDownload=false',
    '-Porg.gradle.java.installations.auto-download=false', `-Porg.gradle.java.installations.paths=${launcher},${compiler}`], env, path.join(root, 'android'));
  const apk = path.join(root, preview ? 'android/app/build/outputs/apk/release/app-release.apk' : 'android/app/build/outputs/apk/debug/app-debug.apk');
  if (!existsSync(apk) || statSync(apk).size === 0) fail('Gradle completed but the ARM64 APK was not found.');
  console.log(`\nAPK: ${apk}\n${preview ? 'Local preview only. Uses development signing and a temporary review backend; verification is required before sharing.' : 'ARM64 debug only. Requires Metro; no emulator has been started.'}`);
} catch (error) {
  console.error(`Android build: ${error instanceof Error ? error.message : 'Unable to complete the build.'}`);
  process.exitCode = 1;
}
