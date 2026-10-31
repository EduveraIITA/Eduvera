import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// A FileProvider-backed Documents folder can attach FinderInfo to generated
// frameworks, which Apple's code signer refuses. Keep only these disposable
// Expo compiler products in the user's normal build cache.
const mobile = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apple = join(mobile, 'node_modules/expo-modules-jsi/apple');
const cache = join(homedir(), 'Library/Caches/ThatCampus/ExpoModulesJSI');
mkdirSync(cache, { recursive: true });
// Expo SDK 58's nested SwiftPM build signs its intermediate framework even when
// the parent simulator build disables signing. The final application build owns
// framework signing; the intermediate package does not need a signature.
const script = join(apple, 'scripts/build-xcframework.sh');
const source = readFileSync(script, 'utf8');
const anchor = '    SKIP_INSTALL=NO \\\n';
const replacement = `${anchor}    CODE_SIGNING_ALLOWED=NO \\\n`;
if (!source.includes(replacement)) {
  if (!source.includes(anchor)) throw new Error('The installed ExpoModulesJSI build script changed; review the simulator compatibility patch.');
  writeFileSync(script, source.replace(anchor, replacement));
}
// CocoaPods excludes vendored frameworks beneath a symlinked Products directory.
// Keep that small final package in place; only the compiler's working tree moves.
const products = join(apple, 'Products');
if (existsSync(products) && lstatSync(products).isSymbolicLink() && readlinkSync(products) === join(cache, 'Products')) {
  unlinkSync(products);
  renameSync(join(cache, 'Products'), products);
}
for (const name of ['.DerivedData']) {
  const source = join(apple, name), target = join(cache, name);
  if (existsSync(source) && lstatSync(source).isSymbolicLink()) continue;
  if (existsSync(source)) {
    if (!existsSync(target)) renameSync(source, target);
    else rmSync(source, { recursive: true }); // Generated compiler products only.
  }
  mkdirSync(target, { recursive: true });
  symlinkSync(target, source, 'dir');
}
if (process.platform === 'darwin') {
  // Privacy resource bundles copied from FileProvider-backed dependencies can
  // retain FinderInfo too. Strip only disposable compiler output before signing.
  const buildCache = join(homedir(), 'Library/Caches/ThatCampus/iOSBuild');
  const result = spawnSync('/usr/bin/xattr', ['-cr', cache, ...(existsSync(buildCache) ? [buildCache] : [])], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('Prepared ThatCampus native compiler cache.');
