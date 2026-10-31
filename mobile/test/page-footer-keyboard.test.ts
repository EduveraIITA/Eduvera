import assert from 'node:assert/strict';
import test from 'node:test';
import { campusKeyboardOverlap } from '../src/lib/campus-workspace-layout';

// PageBody uses the existing native-host intersection helper for Android.
// Verify the pinned footer's resulting window-space bounds across real layout
// modes; keyboard height alone cannot distinguish overlay from adjustResize.
test('an Android pinned composer finishes at the keyboard top below the native header', () => {
  const host = { y: 108,height: 650 }, keyboardTop = 458, composerHeight = 88;
  const reserved = campusKeyboardOverlap(host,keyboardTop);
  assert.equal(reserved,300);
  assert.equal(host.y + host.height - reserved,458);
  assert.equal(host.height - reserved - composerHeight,262,'the transcript has a bounded independent viewport above the composer');
});

test('a fully resized Android host adds no second keyboard inset or bottom gap', () => {
  const host = { y: 108,height: 350 };
  assert.equal(campusKeyboardOverlap(host,458),0);
  assert.equal(host.y + host.height,458);
  assert.equal(host.height - 88,262);
});

test('a partially resized host reserves only its remaining intersection, then restores on hide', () => {
  const host = { y: 108,height: 420 };
  assert.equal(campusKeyboardOverlap(host,458),70);
  assert.equal(host.y + host.height - campusKeyboardOverlap(host,458),458);
  assert.equal(campusKeyboardOverlap(host,null),0);
  assert.equal(campusKeyboardOverlap({ y: 108,height: 650 },null),0);
});

test('rotation and differing header sizes use measured coordinates without fixed toolbar/tab offsets', () => {
  assert.equal(campusKeyboardOverlap({ y: 56,height: 320 },280),96);
  assert.equal(campusKeyboardOverlap({ y: 160,height: 520 },400),280);
  assert.equal(campusKeyboardOverlap({ y: 0,height: 540 },340),200,'headerless/modal hosts also use their own frame');
});

test('a keyboard outside this retained host or absent hardware keyboard adds no inset', () => {
  assert.equal(campusKeyboardOverlap({ y: 108,height: 300 },700),0);
  assert.equal(campusKeyboardOverlap({ y: 108,height: 300 },null),0);
  assert.equal(campusKeyboardOverlap({ y: 108,height: 0 },458),0,'wait for the real host measurement');
});
