import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import previewPolicy from './android-preview-policy.cjs';

const { androidApplicationBoolean } = previewPolicy;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = value => createHash('sha256').update(value).digest('hex');
function command(file, args, options = {}) {
  const result = spawnSync(file, args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(file)} verification/build failed (${result.signal ?? result.status}). ${result.stderr?.slice(0, 600) ?? ''}`);
  return result.stdout ?? '';
}
function sourceFingerprint() {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files.push(file);
    }
  }
  for (const directory of ['src', 'app', 'assets', 'scripts', 'plugins', 'modules']) {
    if (existsSync(path.join(root, directory))) visit(path.join(root, directory));
  }
  for (const directory of ['../packages/contracts/src']) visit(path.resolve(root, directory));
  for (const file of ['app.config.ts', 'package.json', 'package-lock.json', 'babel.config.js', 'metro.config.js']) if (existsSync(path.join(root, file))) files.push(path.join(root, file));
  const hash = createHash('sha256');
  for (const file of files.sort()) hash.update(`${path.relative(root, file)}\0`).update(sha256(readFileSync(file)));
  return hash.digest('hex');
}

try {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--prepare')) throw new Error('Only --prepare is supported. Set EXPO_PUBLIC_API_URL to the temporary HTTPS review origin.');
  const origin = new URL(process.env.EXPO_PUBLIC_API_URL ?? '');
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' || origin.hostname.endsWith('.invalid')) throw new Error('The temporary review backend must be an HTTPS origin without credentials or extra URL components.');
  const before = sourceFingerprint();
  const started = new Date().toISOString();
  const env = { ...process.env, EXPO_PUBLIC_API_URL: origin.origin, EAS_BUILD_PROFILE: 'preview', NODE_ENV: 'production' };
  command(process.execPath, ['scripts/android-build.mjs', '--preview', ...args], { env, stdio: 'inherit' });
  const sdk = path.resolve(env.ANDROID_HOME || env.ANDROID_SDK_ROOT || '/Volumes/MacSSD/Developer/Android/sdk');
  const tools = path.join(sdk, 'build-tools', '37.0.0');
  const apk = path.join(root, 'android/app/build/outputs/apk/release/app-release.apk');
  const badging = command(path.join(tools, 'aapt2'), ['dump', 'badging', apk]);
  const manifest = command(path.join(tools, 'aapt2'), ['dump', 'xmltree', apk, '--file', 'AndroidManifest.xml']);
  if (androidApplicationBoolean(manifest, 'usesCleartextTraffic') !== false) throw new Error('Packaged preview does not explicitly deny cleartext traffic.');
  if (/SYSTEM_ALERT_WINDOW|devlauncher|devmenu|DevSettingsActivity/i.test(manifest)) throw new Error('Packaged preview exposes development activities or the overlay permission.');
  if (/application-debuggable/.test(badging) || androidApplicationBoolean(manifest, 'debuggable') === true) throw new Error('Packaged preview is debuggable.');
  if (!badging.includes("package: name='app.thatcampus.mobile'") || !badging.includes("native-code: 'arm64-v8a'") || /native-code:.*(?:x86|armeabi)/.test(badging)) throw new Error('Unexpected package identity or ABI in preview.');
  const signing = command(path.join(tools, 'apksigner'), ['verify', '--verbose', '--print-certs', apk]);
  if (!/Android Debug/.test(signing)) throw new Error('Preview certificate is not the expected local development certificate. Review signing before creating this local preview.');
  command(path.join(tools, 'zipalign'), ['-c', '-P', '16', '4', apk]);
  const generatedBundle = path.join(root, 'android/app/build/generated/assets/react/release/index.android.bundle');
  const temporary = mkdtempSync(path.join(root, 'android/app/build/preview-verify-'));
  let bundleBytes;
  try {
    bundleBytes = spawnSync('/usr/bin/unzip', ['-p', apk, 'assets/index.android.bundle'], { maxBuffer: 32 * 1024 * 1024 });
    if (bundleBytes.status !== 0 || !bundleBytes.stdout?.length) throw new Error('Application JavaScript is missing from the packaged preview.');
    const payload = bundleBytes.stdout;
    if (payload.subarray(0, 8).toString('hex') !== 'c61fbc03c103191f' || !payload.includes(Buffer.from(origin.origin))) throw new Error('Embedded Hermes bytecode does not contain the selected review origin.');
    if (sha256(payload) !== sha256(readFileSync(generatedBundle))) throw new Error('Packaged and generated Hermes bundles differ.');
    const hermes = path.join(root, 'node_modules/hermes-compiler/hermesc', process.platform === 'darwin' ? 'osx-bin' : 'linux64-bin', 'hermesc');
    const input = path.join(temporary, 'index.android.bundle');
    writeFileSync(input, payload);
    command(hermes, ['-b', '-dump-bytecode', '-out', path.join(temporary, 'validated-bytecode.txt'), input], { stdio: ['ignore', 'ignore', 'pipe'] });
  } finally { rmSync(temporary, { recursive: true, force: true }); }
  const after = sourceFingerprint();
  if (before !== after) throw new Error('Application source changed during the preview build. Rebuild from a frozen source before sharing.');
  const destination = existsSync('/Volumes/MacSSD/Downloads') ? '/Volumes/MacSSD/Downloads' : path.join(homedir(), 'Downloads');
  mkdirSync(destination, { recursive: true });
  const artifact = path.join(destination, 'ThatCampus-preview-arm64-v8a.apk');
  copyFileSync(apk, `${artifact}.tmp`);
  renameSync(`${artifact}.tmp`, artifact);
  const receipt = {
    started_utc: started, completed_utc: new Date().toISOString(), artifact,
    bytes: readFileSync(artifact).length, sha256: sha256(readFileSync(artifact)), temporary_review_api_origin: origin.origin,
    profile: 'preview', node_env: 'production', abi: 'arm64-v8a', production_deployment: false, store_upload: false,
    signing_limit: 'Local CNG development certificate only. Unsuitable for production/store distribution.',
    embedded_hermes_bytes: bundleBytes.stdout.length, embedded_hermes_sha256: sha256(bundleBytes.stdout), metro_required: false,
    cleartext_explicitly_denied: true, overlay_permission_absent: true, development_activities_absent: true, debuggable: false,
    signature_verified: true, zipalign_16k_verified: true, emulator_started: false, runtime_tested: false,
    source_sha256: after, source_unchanged_during_build: true,
    package_metadata: badging.split(/\r?\n/).filter(line => /^(package:|minSdkVersion:|targetSdkVersion:|native-code:|application-label:)/.test(line)),
  };
  const receiptPath = path.join(destination, 'thatcampus-android-preview-receipt.json');
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`\nVerified local preview: ${artifact}\nReceipt: ${receiptPath}\nEmbedded Hermes JavaScript; Metro is not required. Temporary review backend and development signing only.`);
} catch (error) {
  console.error(`Android preview: ${error instanceof Error ? error.message : 'Unable to verify the local preview.'}`);
  process.exitCode = 1;
}
