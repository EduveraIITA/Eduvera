import assert from 'node:assert/strict';
import test from 'node:test';
import { clampSceneViewport, fitSceneViewport, sceneViewportInsets, zoomSceneViewport, type SceneBounds, type SceneSize, type SceneViewport } from '../../packages/contracts/src/campus-scenes/sceneGeometry';
import { campusViewportConstraints, constrainCampusSkiaViewport, zoomCampusSkiaViewport } from '../src/features/campus/skia/campusSkiaViewport';

const sizes: SceneSize[] = [
  { width: 390, height: 290, topInset: 108, bottomInset: 12 },
  { width: 320, height: 568, topInset: 72, bottomInset: 76 },
  { width: 390, height: 844, topInset: 72, bottomInset: 110 },
  { width: 390, height: 180, topInset: 120, bottomInset: 76 },
  { width: 768, height: 1024, topInset: 120, bottomInset: 76 },
  { width: 854, height: 834, topInset: 72, bottomInset: 0 },
  { width: 1194, height: 550, topInset: 120, bottomInset: 140 },
  { width: 1024, height: 768 },
  { width: 1, height: 1, topInset: 500, bottomInset: 500 },
];
const bounds: SceneBounds[] = [
  { x: 0, y: 0, width: 1200, height: 800 },
  { x: -506, y: -406, width: 112, height: 62 },
  { x: 4200, y: 7050, width: 24, height: 60 },
  { x: -8000, y: 9000, width: 10000, height: 8000 },
  { x: -0.25, y: -0.5, width: 0.5, height: 0.75 },
];
const near = (actual: number, expected: number, label: string) => assert.ok(
  Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(actual), Math.abs(expected)), `${label}: ${actual} !== ${expected}`,
);
const sameViewport = (actual: SceneViewport, expected: SceneViewport, label: string) => {
  near(actual.scale, expected.scale, `${label} scale`); near(actual.x, expected.x, `${label} x`); near(actual.y, expected.y, `${label} y`);
};

test('UI-thread constraints preserve shared phone/tablet, keyboard and floor inset rules', () => {
  for (const size of sizes) for (const box of bounds) {
    const before = structuredClone({ size, box }), fit = fitSceneViewport(size, box), inset = sceneViewportInsets(size);
    const limits = campusViewportConstraints(size, box, fit.scale);
    assert.equal(limits.top, inset.top); assert.equal(limits.availableHeight, inset.height);
    assert.equal(limits.minimumScale, fit.scale); assert.equal(limits.maximumScale, fit.scale * 8);
    assert.equal(limits.width, size.width); assert.equal(limits.height, size.height);
    assert.deepEqual({ size, box }, before);
  }
});

test('pan constraints match the shared camera across zoom limits and remote/global scene coordinates', () => {
  for (const size of sizes) for (const box of bounds) {
    const fit = fitSceneViewport(size, box), limits = campusViewportConstraints(size, box, fit.scale);
    for (const zoom of [0.01, 1, 2.85, 4, 8, 100]) for (const x of [-1e6, -50, 0, size.width / 2, 1e6]) for (const y of [-1e6, -80, 0, size.height / 2, 1e6]) {
      const value = { scale: fit.scale * zoom, x, y };
      sameViewport(constrainCampusSkiaViewport(value, limits), clampSceneViewport(value, size, box), JSON.stringify({ size, box, zoom, x, y }));
    }
  }
});

test('pinch focal points match shared zoom at screen edges, insets and off-screen coordinates', () => {
  for (const size of sizes) for (const box of bounds) {
    const fit = fitSceneViewport(size, box), limits = campusViewportConstraints(size, box, fit.scale);
    for (const zoom of [1, 2.85, 8]) {
      const value = clampSceneViewport({ scale: fit.scale * zoom, x: fit.x - 100, y: fit.y + 70 }, size, box);
      const focal = [{ x: 0, y: 0 }, { x: size.width, y: size.height }, { x: size.width / 2, y: limits.top + limits.availableHeight / 2 }, { x: -20, y: size.height + 50 }];
      for (const point of focal) for (const multiplier of [0.01, 0.5, 1, 1.2, 4, 100]) {
        sameViewport(zoomCampusSkiaViewport(value, point.x, point.y, multiplier, limits), zoomSceneViewport(value, point, multiplier, size, box), JSON.stringify({ size, box, zoom, point, multiplier }));
      }
    }
  }
});

test('continuous pan/pinch sequences remain equivalent without accumulating camera drift', () => {
  let seed = 73991;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
  for (const size of sizes.slice(0, -1)) for (const box of bounds.slice(0, -1)) {
    const fit = fitSceneViewport(size, box), limits = campusViewportConstraints(size, box, fit.scale);
    let actual = { ...fit }, expected = { ...fit };
    for (let i = 0; i < 120; i++) {
      if (i % 3 === 0) {
        const point = { x: random() * size.width, y: random() * size.height }, multiplier = 0.85 + random() * 0.4;
        actual = zoomCampusSkiaViewport(actual, point.x, point.y, multiplier, limits);
        expected = zoomSceneViewport(expected, point, multiplier, size, box);
      } else {
        const x = (random() - 0.5) * 90, y = (random() - 0.5) * 90;
        actual = constrainCampusSkiaViewport({ ...actual, x: actual.x + x, y: actual.y + y }, limits);
        expected = clampSceneViewport({ ...expected, x: expected.x + x, y: expected.y + y }, size, box);
      }
      sameViewport(actual, expected, `sequence ${JSON.stringify({ size, box, i })}`);
    }
  }
});

test('unclamped pinch preserves the world coordinate under the fingers', () => {
  const size = sizes[1], box = bounds[0], fit = fitSceneViewport(size, box), limits = campusViewportConstraints(size, box, fit.scale);
  const focal = { x: size.width / 2, y: limits.top + limits.availableHeight / 2 }, scale = fit.scale * 3;
  const before = constrainCampusSkiaViewport({ scale, x: focal.x - (box.x + box.width / 2) * scale, y: focal.y - (box.y + box.height / 2) * scale }, limits);
  const world = { x: (focal.x - before.x) / before.scale, y: (focal.y - before.y) / before.scale };
  const after = zoomCampusSkiaViewport(before, focal.x, focal.y, 1.4, limits);
  near((focal.x - after.x) / after.scale, world.x, 'focal world x');
  near((focal.y - after.y) / after.scale, world.y, 'focal world y');
});

test('gesture worklets do not mutate captured limits, viewport or authored bounds', () => {
  const size = sizes[3], box = structuredClone(bounds[1]), fit = fitSceneViewport(size, box), limits = campusViewportConstraints(size, box, fit.scale);
  const viewport = { ...fit }, before = structuredClone({ viewport, limits, box });
  constrainCampusSkiaViewport(viewport, limits); zoomCampusSkiaViewport(viewport, 300, 400, 1.5, limits);
  assert.deepEqual({ viewport, limits, box }, before);
});
