import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assistantBrand, assistantTracks, brandFeatherColor, brandMotionAllowed, loadingFeatherScale, sampledAssistantTrack } from '../src/ui/assistant-brand';

interface SvgNode { tag: string; attributes: Record<string, string>; children: SvgNode[]; parent?: SvgNode }
/** Parse only the local canonical SVG's element/attribute structure, without rendering or executing it. */
function canonicalSvg(relativePath: string): SvgNode {
  const source = readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
  const document: SvgNode = { tag: '#document', attributes: {}, children: [] }, stack = [document];
  for (const match of source.matchAll(/<(\/?)([\w:-]+)\b([^<>]*?)(\/?)>/g)) {
    if (match[1]) { assert.equal(stack.pop()?.tag, match[2], 'Canonical SVG element nesting'); continue; }
    const node: SvgNode = { tag: match[2], attributes: Object.fromEntries([...match[3].matchAll(/([\w:-]+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]])), children: [], parent: stack.at(-1) };
    stack.at(-1)!.children.push(node);
    if (!match[4]) stack.push(node);
  }
  assert.equal(stack.length, 1);
  assert.equal(document.children.length, 1);
  assert.equal(document.children[0].tag, 'svg');
  return document.children[0];
}
function descendants(node: SvgNode, tag: string): SvgNode[] {
  return node.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...descendants(child, tag)]);
}
function numbers(value: string): number[] { return value.trim().split(/[\s,]+/).map(Number); }
function close(actual: number, expected: number, tolerance = 1e-5, label = '') {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} differs from ${expected} by more than ${tolerance}`);
}

test('native assistant preserves original static and animated SVG geometry and black/yellow palette', () => {
  const staticMark = canonicalSvg('mobile/assets/brand-source/thatcampus-brand-mark.svg');
  const animatedMark = canonicalSvg('mobile/assets/brand-source/thatcampus-agent-no-glow.svg');
  assert.equal(assistantBrand.viewBox, staticMark.attributes.viewBox);
  assert.equal(assistantBrand.viewBox, animatedMark.attributes.viewBox);
  assert.equal(assistantBrand.feather, '#090909');
  assert.equal(assistantBrand.featherDark, '#ffffff');
  assert.equal(assistantBrand.dot, '#fec106');
  for (const svg of [staticMark, animatedMark]) {
    const paths = descendants(svg, 'path'), dots = descendants(svg, 'circle');
    assert.equal(paths.length, 3);
    assert.deepEqual(paths.map(path => path.attributes.d), [...assistantBrand.feathers]);
    assert.ok(paths.every(path => path.attributes.fill === assistantBrand.feather));
    assert.equal(dots.length, 1);
    assert.equal(dots[0].attributes.fill, assistantBrand.dot);
    assert.equal(Number(dots[0].attributes.r), 83);
  }
  const dot = descendants(staticMark, 'circle')[0];
  assert.deepEqual([Number(dot.attributes.cx), Number(dot.attributes.cy)], [768, 657]);
  assert.equal(descendants(animatedMark, 'circle')[0].parent?.parent?.attributes.transform, 'translate(768 657)');
});

test('transparent native brand uses white feathers in Dark or on filled actions and black otherwise', () => {
  assert.equal(brandFeatherColor(false), assistantBrand.feather);
  assert.equal(brandFeatherColor(false, false), '#090909', 'Light secondary/danger-soft surface');
  assert.equal(brandFeatherColor(false, true), '#ffffff', 'Light filled primary action');
  assert.equal(brandFeatherColor(true), assistantBrand.featherDark);
  assert.equal(brandFeatherColor(true, false), '#ffffff', 'Dark content/secondary surface');
  assert.equal(brandFeatherColor(true, true), '#ffffff', 'Dark filled primary action');
  assert.equal(assistantBrand.dot, '#fec106', 'The yellow dot keeps its original identity in either appearance');
  const nativeComponent = readFileSync(new URL('../src/ui/AssistantMark.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(nativeComponent, /backgroundColor\s*:|#fff8e7|brand\.backing/, 'Artwork wrappers must remain transparent');
  assert.equal('backing' in assistantBrand, false);
});

test('native seven assistant tracks retain every canonical 7.2-second SMIL time and value', () => {
  const animatedMark = canonicalSvg('mobile/assets/brand-source/thatcampus-agent-no-glow.svg');
  const tracks = descendants(animatedMark, 'animateTransform');
  assert.equal(tracks.length, 7);
  assert.equal(assistantTracks.length, tracks.length);
  for (const [index, node] of tracks.entries()) {
    const { attributes } = node, native = assistantTracks[index];
    assert.equal(Number.parseFloat(attributes.dur) * 1000, assistantBrand.assistantDuration);
    assert.equal(attributes.repeatCount, 'indefinite');
    assert.equal(attributes.calcMode, 'spline');
    assert.deepEqual(attributes.keyTimes.split(';').map(Number), [...native.times]);
    const vectors = attributes.values.split(';').map(numbers);
    assert.equal(attributes.type, index === 6 || index % 2 ? 'scale' : 'rotate');
    if (index === 6) assert.ok(vectors.every(value => value.length === 2 && value[0] === value[1]));
    else if (index % 2) assert.ok(vectors.every(value => value.length === 2 && value[0] === 1));
    else assert.ok(vectors.every(value => value.length === 1));
    assert.deepEqual(vectors.map(value => value.at(-1)), [...native.values]);
    const splines = attributes.keySplines.split(';').map(numbers);
    assert.equal(splines.length, native.times.length - 1);
    assert.ok(splines.every(spline => JSON.stringify(spline) === JSON.stringify([.42, 0, .58, 1])));
    assert.equal(native.times[0], 0); assert.equal(native.times.at(-1), 1);
    assert.equal(native.values[0], native.values.at(-1), `Track ${index} must loop continuously`);
  }
});

/** Independent Newton solution of the canonical cubic-bezier(.42,0,.58,1). */
function canonicalEase(x: number) {
  if (x === 0 || x === 1) return x;
  let t = x;
  for (let i = 0; i < 16; i++) {
    const value = 1.26 * t - .78 * t * t + .52 * t * t * t;
    const derivative = 1.26 - 1.56 * t + 1.56 * t * t;
    t = Math.max(0, Math.min(1, t - (value - x) / derivative));
  }
  return 3 * t * t - 2 * t * t * t;
}

test('native assistant easing samples preserve canonical keyframes, bounded motion and continuous endpoints', () => {
  for (const [index, track] of assistantTracks.entries()) {
    const sampled = sampledAssistantTrack(track);
    assert.equal(sampled.inputRange.length, (track.times.length - 1) * 16 + 1);
    assert.equal(sampled.inputRange.length, sampled.outputRange.length);
    assert.ok(sampled.inputRange.every((time, i, all) => time >= 0 && time <= 1 && (i === 0 || time > all[i - 1])));
    assert.equal(sampled.inputRange[0], 0); assert.equal(sampled.inputRange.at(-1), 1);
    assert.equal(sampled.outputRange[0], sampled.outputRange.at(-1));
    for (let segment = 0; segment < track.times.length - 1; segment++) {
      assert.equal(sampled.inputRange[segment * 16], track.times[segment]);
      assert.equal(sampled.outputRange[segment * 16], track.values[segment]);
      for (let step = 0; step < 16; step++) {
        const expected = track.values[segment] + canonicalEase(step / 16) * (track.values[segment + 1] - track.values[segment]);
        close(sampled.outputRange[segment * 16 + step], expected, 1e-5, `Track ${index}, segment ${segment}, sample ${step}`);
      }
    }
    close(sampled.outputRange.at(-1)!, track.values.at(-1)!);
  }
});

test('native radial loader preserves all eight original paths, anchors, rotations and duration', () => {
  const loadingMark = canonicalSvg('mobile/assets/brand-source/thatcampus-loader-fast.svg');
  assert.equal(loadingMark.attributes.viewBox, '-214 -214 428 428');
  const paths = descendants(loadingMark, 'path'), tracks = descendants(loadingMark, 'animateTransform');
  assert.equal(paths.length, 8); assert.equal(tracks.length, 8);
  assert.ok(paths.every(path => path.attributes.d === assistantBrand.loadingFeather));
  assert.ok(paths.every(path => path.attributes.fill === assistantBrand.feather));
  for (const [index, track] of tracks.entries()) {
    assert.equal(track.attributes.type, 'scale');
    assert.equal(Number.parseFloat(track.attributes.dur) * 1000, assistantBrand.loadingDuration);
    assert.equal(track.attributes.repeatCount, 'indefinite');
    assert.equal(track.parent?.parent?.attributes.transform, 'translate(0 -62)');
    assert.equal(track.parent?.parent?.parent?.attributes.transform, `rotate(${index * 45})`);
    assert.equal(paths[index].attributes.transform, 'translate(0 62)');
  }
  const dots = descendants(loadingMark, 'circle');
  assert.equal(dots.length, 1); assert.equal(Number(dots[0].attributes.r), 43);
  assert.equal(dots[0].attributes.fill, assistantBrand.dot);
});

test('native loader scales match all original 8 × 257 SVG samples within 1e-5', () => {
  const loadingMark = canonicalSvg('mobile/assets/brand-source/thatcampus-loader-fast.svg');
  for (const [feather, track] of descendants(loadingMark, 'animateTransform').entries()) {
    const samples = track.attributes.values.split(';').map(numbers);
    assert.equal(samples.length, 257);
    for (const [frame, expected] of samples.entries()) {
      assert.equal(expected.length, 2);
      const actual = loadingFeatherScale(frame / 256, feather);
      close(actual.x, expected[0], 1e-5, `Feather ${feather}, frame ${frame}, x`);
      close(actual.y, expected[1], 1e-5, `Feather ${feather}, frame ${frame}, y`);
    }
  }
});

test('native loader loops continuously and keeps all axes finite and within original bounds', () => {
  for (let feather = 0; feather < 8; feather++) {
    assert.deepEqual(loadingFeatherScale(0, feather), loadingFeatherScale(1, feather));
    assert.deepEqual(loadingFeatherScale(0, feather), loadingFeatherScale(-1, feather));
    const start = loadingFeatherScale(0, feather), before = loadingFeatherScale(1 - 1e-8, feather), after = loadingFeatherScale(1e-8, feather);
    close(before.x, start.x, 1e-5); close(before.y, start.y, 1e-5);
    close(after.x, start.x, 1e-5); close(after.y, start.y, 1e-5);
    for (let frame = 0; frame <= 1024; frame++) {
      const scale = loadingFeatherScale(frame / 1024, feather);
      assert.ok(Number.isFinite(scale.x) && Number.isFinite(scale.y));
      assert.ok(scale.x >= 0 && scale.x <= 1 && scale.y >= 0 && scale.y <= 1);
    }
  }
});

test('brand motion starts only for explicitly permitted foreground and focused state', () => {
  for (const reduced of [null, true, false] as const) for (const focused of [false, true]) {
    for (const state of ['active', 'inactive', 'background', 'unknown', '', null, undefined]) {
      assert.equal(brandMotionAllowed(reduced, focused, state), reduced === false && focused && state === 'active');
    }
  }
  assert.equal(brandMotionAllowed(null, true, 'active'), false, 'Unknown initial setting remains static');
  assert.equal(brandMotionAllowed(true, true, 'active'), false, 'Reduced motion remains static');
  assert.equal(brandMotionAllowed(false, false, 'active'), false, 'Retained blurred screen remains static');
  assert.equal(brandMotionAllowed(false, true, 'background'), false, 'Background app remains static');
});

test('a retained closed Assistant overlay stops motion while its campus ancestor remains focused', () => {
  assert.equal(brandMotionAllowed(false, true, 'active', false), false);
  assert.equal(brandMotionAllowed(false, true, 'active', true), true);
  assert.equal(brandMotionAllowed(false, true, 'active', undefined), true, 'Ordinary route marks retain their existing policy');
  assert.equal(brandMotionAllowed(true, true, 'active', true), false);
  assert.equal(brandMotionAllowed(false, false, 'active', true), false);
  assert.equal(brandMotionAllowed(false, true, 'background', true), false);
});
