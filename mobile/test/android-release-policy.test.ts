import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const { applyReleasePolicy } = createRequire(import.meta.url)('../plugins/withAndroidReleasePolicy.cjs');

test('release denies cleartext and removes overlay permission without broad permission removal', () => {
  const document = { manifest: { 'uses-permission': [{ $: { 'android:name': 'android.permission.CAMERA' } }, { $: { 'android:name': 'android.permission.SYSTEM_ALERT_WINDOW' } }] } };
  applyReleasePolicy(document);
  assert.equal((document.manifest as any).application[0].$['android:usesCleartextTraffic'], 'false');
  assert.deepEqual(document.manifest['uses-permission'], [{ $: { 'android:name': 'android.permission.CAMERA' } }, { $: { 'android:name': 'android.permission.SYSTEM_ALERT_WINDOW', 'tools:node': 'remove' } }]);
});

test('release policy preserves existing application content and merger replacements across regeneration', () => {
  const document = { manifest: { application: [{ $: { 'android:theme': '@style/AppTheme', 'tools:replace': 'android:theme' }, provider: [{ $: { 'android:name': 'ExistingProvider' } }] }] } };
  applyReleasePolicy(document);
  const once = JSON.stringify(document);
  applyReleasePolicy(document);
  assert.equal(JSON.stringify(document), once);
  assert.equal(document.manifest.application[0].$['android:theme'], '@style/AppTheme');
  assert.equal(document.manifest.application[0].$['tools:replace'], 'android:theme,android:usesCleartextTraffic');
  assert.equal(document.manifest.application[0].provider[0].$['android:name'], 'ExistingProvider');
});
