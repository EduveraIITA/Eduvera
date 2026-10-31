import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantLayout,assistantVisibleHeight, ASSISTANT_SPLIT_DIVIDER } from '../src/lib/assistant-layout';

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8,`${actual} != ${expected}`);

test('expanded iPad widths allocate the measured host without clipping the operating app or chat', () => {
  for (const [width,chat,app] of [[744,320,423],[768,320,447],[962,384.8,576.2],[1194,477.6,715.4],[1366,480,885]]) {
    const layout = assistantLayout({ width: width!,height: 962,isPad: true,expanded: true });
    assert.equal(layout.mode,'split'); assert.equal(layout.axis,'horizontal');
    near(layout.chat.width,chat!); near(layout.app.width,app!);
    near(layout.app.width + ASSISTANT_SPLIT_DIVIDER + layout.chat.width,width!);
    assert.equal(layout.app.height,962); assert.equal(layout.chat.height,962);
    assert.ok(layout.app.width >= 400); assert.ok(layout.chat.width >= 320 && layout.chat.width <= 480);
  }
});

test('721 is the exact horizontal admission boundary and fractional layout sizes preserve their remainder', () => {
  const narrow = assistantLayout({ width: 720,height: 1000,isPad: true,expanded: true });
  assert.equal(narrow.axis,'vertical'); near(narrow.app.height,499.5); near(narrow.chat.height,499.5);
  const exact = assistantLayout({ width: 721,height: 1000,isPad: true,expanded: true });
  assert.deepEqual(exact.app,{ width: 400,height: 1000 }); assert.deepEqual(exact.chat,{ width: 320,height: 1000 });
  const fractional = assistantLayout({ width: 721.25,height: 1000.5,isPad: true,expanded: true });
  near(fractional.app.width,400.25); near(fractional.chat.width,320); assert.equal(fractional.app.height,1000.5);
  for (const [width,chat] of [[800,320],[801,320.4],[1200,480],[1201,480]]) {
    const result = assistantLayout({ width: width!,height: 900,isPad: true,expanded: true }); near(result.chat.width,chat!);
  }
});

test('narrow iPad multitasking stacks both owners within the real frame and never inserts a sidebar', () => {
  for (const [width,height] of [[320,744],[516,1194],[600,800],[700,450]]) {
    const layout = assistantLayout({ width: width!,height: height!,isPad: true,expanded: true });
    assert.equal(layout.mode,'split'); assert.equal(layout.axis,'vertical'); assert.equal(layout.sidebar,false);
    assert.equal(layout.app.width,width); assert.equal(layout.chat.width,width);
    near(layout.app.height + ASSISTANT_SPLIT_DIVIDER + layout.chat.height,height!);
    near(layout.app.height,layout.chat.height); assert.ok(layout.app.height > 0 && layout.chat.height > 0);
  }
});

test('portrait iPad keeps bottom navigation even when a horizontal split has enough app width for a sidebar', () => {
  for (const [width,height] of [[744,1133],[768,1024],[962,1194],[1194,1366],[1366,1600]]) {
    const layout = assistantLayout({ width: width!,height: height!,isPad: true,expanded: true });
    assert.equal(layout.axis,'horizontal'); assert.equal(layout.sidebar,false);
    assert.equal(assistantLayout({ width: width!,height: height!,isPad: true,expanded: false }).sidebar,false);
  }
});

test('split sidebar admission leaves 400 points after its actual 244-point allocation', () => {
  assert.equal(assistantLayout({ width: 962,height: 744,isPad: true,expanded: true }).sidebar,false);
  assert.equal(assistantLayout({ width: 1074.99,height: 800,isPad: true,expanded: true }).sidebar,false);
  const exact = assistantLayout({ width: 1075,height: 800,isPad: true,expanded: true });
  near(exact.app.width,644); assert.equal(exact.sidebar,true); near(exact.app.width - 244,400);
  for (const width of [1194,1366]) {
    const layout = assistantLayout({ width,height: 962,isPad: true,expanded: true });
    assert.equal(layout.sidebar,true); assert.ok(layout.app.width - 244 >= 400);
  }
});

test('compact overlay preserves the complete app frame and existing iPad landscape sidebar threshold', () => {
  for (const width of [744,768,899,900,962,1194,1366]) {
    const layout = assistantLayout({ width,height: 700,isPad: true,expanded: false });
    assert.equal(layout.mode,'compact'); assert.equal(layout.axis,null);
    assert.deepEqual(layout.app,{ width,height: 700 }); assert.deepEqual(layout.chat,{ width,height: 700 });
    assert.equal(layout.sidebar,width >= 900);
  }
});

test('iPhone always expands fullscreen including wide landscape; device width never impersonates iPad', () => {
  for (const [width,height] of [[393,852],[932,430],[1194,962],[1366,1024]]) {
    const layout = assistantLayout({ width: width!,height: height!,isPad: false,expanded: true });
    assert.equal(layout.mode,'fullscreen'); assert.equal(layout.axis,null); assert.equal(layout.sidebar,false);
    assert.deepEqual(layout.app,{ width,height }); assert.deepEqual(layout.chat,{ width,height });
    assert.equal(assistantLayout({ width: width!,height: height!,isPad: false,expanded: false }).sidebar,false);
  }
});

test('nonfinite, negative and unmeasured dimensions remain finite and cannot admit a phantom split', () => {
  for (const [width,height,expectedWidth,expectedHeight] of [[NaN,900,0,900],[Infinity,900,0,900],[-100,900,0,900],[900,-1,900,0],[900,Infinity,900,0],[900,NaN,900,0],[0,0,0,0],[500,.5,500,.5],[500,1,500,1]]) {
    const layout = assistantLayout({ width: width!,height: height!,isPad: true,expanded: true });
    assert.equal(layout.mode,'fullscreen'); assert.equal(layout.axis,null); assert.equal(layout.sidebar,false);
    assert.deepEqual(layout.app,{ width: expectedWidth,height: expectedHeight }); assert.deepEqual(layout.chat,layout.app);
  }
  assert.deepEqual(assistantLayout({ width: -10,height: NaN,isPad: true,expanded: false }),{ mode: 'compact',axis: null,app: { width: 0,height: 0 },chat: { width: 0,height: 0 },sidebar: false });
  assert.equal(assistantLayout({ width: 1194,height: NaN,isPad: true,expanded: false }).sidebar,false);
});

test('rotation and expansion recalculate allocation without sharing mutable frame defaults', () => {
  const landscape = assistantLayout({ width: 1194,height: 962,isPad: true,expanded: true });
  const portrait = assistantLayout({ width: 962,height: 1194,isPad: true,expanded: true });
  assert.equal(landscape.sidebar,true); assert.equal(portrait.sidebar,false); assert.ok(landscape.app.width > portrait.app.width);
  const compact = assistantLayout({ width: 1194,height: 962,isPad: true,expanded: false });
  assert.equal(compact.app.width,1194); assert.notEqual(compact.app,compact.chat);
  compact.app.width = 1;
  assert.equal(assistantLayout({ width: 1194,height: 962,isPad: true,expanded: false }).app.width,1194);
  assert.equal(compact.chat.width,1194);
});


test('stacked iPad panes intersect the measured screen frame with IME before splitting, instead of leaving a39-point chat', () => {
  for (const screenY of [0,24,80]) {
    const height = assistantVisibleHeight(744,screenY,411), layout = assistantLayout({ width: 320,height,isPad: true,expanded: true });
    assert.equal(height,411 - screenY); assert.equal(layout.axis,'vertical');
    assert.equal(layout.app.height + 1 + layout.chat.height,height);
    assert.ok(screenY + layout.app.height + 1 + layout.chat.height <= 411);
    assert.ok(layout.chat.height >= 165,'both toolbar and composer receive a usable measured pane before their own residual avoidance');
  }
  assert.equal(assistantVisibleHeight(744,24,null),744,'keyboard dismissal restores the full measured app/chat allocation');
  assert.equal(assistantVisibleHeight(411,0,411),411,'already resized native hosts never subtract a second keyboard height');
  assert.equal(assistantVisibleHeight(744,24,900),744);
  assert.equal(assistantVisibleHeight(744,24,10),0);
  assert.equal(assistantVisibleHeight(744,NaN,411),744);
});
