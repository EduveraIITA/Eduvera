import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const { androidApplicationBoolean } = createRequire(import.meta.url)('../scripts/android-preview-policy.cjs');

test('preview checks current aapt2 literal namespace booleans and older typed hexadecimal booleans', () => {
  assert.equal(androidApplicationBoolean('E: application (line=1)\n  A: http://schemas.android.com/apk/res/android:usesCleartextTraffic(0x010104ec)=false', 'usesCleartextTraffic'), false);
  assert.equal(androidApplicationBoolean('E: application\n  A: android:usesCleartextTraffic(0x010104ec)=(type 0x12)0x0', 'usesCleartextTraffic'), false);
  assert.equal(androidApplicationBoolean('E: application\n  A: android:debuggable(0x0101000f)=(type 0x12)0xffffffff', 'debuggable'), true);
});

test('preview rejects missing, enabled, ambiguous and child-only cleartext restrictions', () => {
  assert.equal(androidApplicationBoolean('E: application\n  A: android:usesCleartextTraffic(0x010104ec)=true', 'usesCleartextTraffic'), true);
  assert.equal(androidApplicationBoolean('E: application\n    E: provider\n      A: android:usesCleartextTraffic(0x010104ec)=false', 'usesCleartextTraffic'), undefined);
  assert.equal(androidApplicationBoolean('E: application\n  A: android:usesCleartextTraffic(0x010104ec)=false\n  A: android:usesCleartextTraffic(0x010104ec)=true', 'usesCleartextTraffic'), undefined);
  assert.equal(androidApplicationBoolean('E: application\n  A: android:label="ThatCampus"', 'usesCleartextTraffic'), undefined);
});
