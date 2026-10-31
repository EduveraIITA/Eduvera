const fs = require('node:fs/promises');
const path = require('node:path');
const { AndroidConfig, withDangerousMod } = require('expo/config-plugins');

function applyReleasePolicy(document) {
  const manifest = document.manifest;
  if (!manifest || typeof manifest !== 'object') throw new Error('Android release manifest is invalid.');
  manifest.$ = { ...manifest.$, 'xmlns:android': 'http://schemas.android.com/apk/res/android', 'xmlns:tools': 'http://schemas.android.com/tools' };
  manifest.application ??= [{ $: {} }];
  if (manifest.application.length !== 1) throw new Error('Android release manifest must contain one application.');
  const application = manifest.application[0];
  application.$ ??= {};
  application.$['android:usesCleartextTraffic'] = 'false';
  const replacements = new Set((application.$['tools:replace'] ?? '').split(',').map(value => value.trim()).filter(Boolean));
  replacements.add('android:usesCleartextTraffic');
  application.$['tools:replace'] = [...replacements].join(',');
  manifest['uses-permission'] ??= [];
  const overlay = manifest['uses-permission'].find(permission => permission.$?.['android:name'] === 'android.permission.SYSTEM_ALERT_WINDOW');
  const removal = { $: { 'android:name': 'android.permission.SYSTEM_ALERT_WINDOW', 'tools:node': 'remove' } };
  if (overlay) overlay.$ = removal.$;
  else manifest['uses-permission'].push(removal);
  return document;
}

function withAndroidReleasePolicy(config) {
  return withDangerousMod(config, ['android', async modified => {
    const file = path.join(modified.modRequest.platformProjectRoot, 'app', 'src', 'release', 'AndroidManifest.xml');
    await fs.mkdir(path.dirname(file), { recursive: true });
    const existing = await fs.access(file).then(() => true, error => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
    const document = existing ? await AndroidConfig.Manifest.readAndroidManifestAsync(file) : { manifest: {} };
    await AndroidConfig.Manifest.writeAndroidManifestAsync(file, applyReleasePolicy(document));
    return modified;
  }]);
}

module.exports = withAndroidReleasePolicy;
module.exports.applyReleasePolicy = applyReleasePolicy;
