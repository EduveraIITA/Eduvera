import assert from 'node:assert/strict';
import test from 'node:test';
import type { CampusSceneDocument, CampusSceneElement, CampusScenePoint } from '../../packages/contracts/src/campus-scenes/types';
import { CAMPUS_SCENE_ASSETS } from '../../packages/contracts/src/campus-scenes/sceneAssets';
import { projectScenePoint, sceneElementHeight } from '../../packages/contracts/src/campus-scenes/sceneGeometry';
import { resolveSceneSunlight } from '../../packages/contracts/src/campus-scenes/sceneSunlight';
import { compileCampusSceneDrawing, pickCampusDrawing, planCampusScenePictureLayers, visibleCampusDrawingParts, type CampusDrawingPart } from '../src/features/campus/skia/compileCampusSceneDrawing';

const rect = (x: number, y: number, width: number, height: number): CampusScenePoint[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
const element = (id: string, changes: Partial<CampusSceneElement> = {}): CampusSceneElement => ({ id, kind: 'building', label: id, geometry: { type: 'polygon', points: rect(20, 30, 36, 24) }, space_id: `space:${id}`, floor_id: null, review_state: 'reviewed', ...changes });
const scene = (elements: CampusSceneElement[], changes: Partial<CampusSceneDocument> = {}): CampusSceneDocument => ({ schema_version: 1, name: 'Institute', bounds: { width: 200, height: 160, unit: 'metres' }, source: { kind: 'manual', label: 'Reviewed layout' }, elements, ...changes });
const compile = (elements: CampusSceneElement[], mode: '2d' | '2.5d' = '2.5d') => compileCampusSceneDrawing(scene(elements), { elements, mode, lighting: 'day', includeSurroundings: false });
const asset = (parts: CampusDrawingPart[], id: string) => parts.find(p => p.elementId === id && p.role === 'asset')!;

test('native vector compilation preserves editable dimensions, exact DT bindings and input document', () => {
  const building = element('architectural-shape', { space_id: 'canonical-building', levels: 3, material: 'brick', roof: 'hip' });
  const lamp = element('pole-graphic', { kind: 'fixture', asset_key: 'lamp', holding_id: 'holding-lamp-301', space_id: null, geometry: { type: 'point', points: [{ x: 83, y: 60 }] }, height: 9, width: 2 });
  const input = scene([building, lamp]), before = JSON.stringify(input), drawing = compileCampusSceneDrawing(input, { mode: '2.5d', lighting: 'day', includeSurroundings: false });
  assert.equal(JSON.stringify(input), before);
  assert.equal(asset(drawing.parts, building.id).spaceId, 'canonical-building');
  assert.equal(asset(drawing.parts, lamp.id).holdingId, 'holding-lamp-301');
  assert.ok(asset(drawing.parts, building.id).commands.some(c => c.detail === 'window'));
  assert.ok(asset(drawing.parts, building.id).commands.some(c => c.detail === 'entrance-canopy'));
  assert.equal(asset(drawing.parts, building.id).commands.filter(c => c.detail === 'roof').length, 4);
  assert.ok(drawing.elementBounds.get(building.id)!.y < projectScenePoint({ x: 20, y: 30 }).y);
});

test('resource-state updates extinguish only affected lights and retain exact interaction identity', () => {
  const point = { x: 50, y: 60 }, lamp = element('lamp-shape', { kind: 'fixture', asset_key: 'lamp', geometry: { type: 'point', points: [point] }, holding_id: 'holding-7', space_id: null, height: 9, width: 2 });
  const input = scene([lamp]), normal = compileCampusSceneDrawing(input, { mode: '2.5d', lighting: 'night', includeSurroundings: false }), failed = compileCampusSceneDrawing(input, { mode: '2.5d', lighting: 'night', unavailableIds: new Set([lamp.id]), includeSurroundings: false });
  assert.equal(asset(normal.parts, lamp.id).commands.filter(c => c.detail === 'lamp-glow').length, 2);
  assert.equal(asset(failed.parts, lamp.id).commands.filter(c => c.detail === 'lamp-glow').length, 0);
  assert.equal(asset(failed.parts, lamp.id).commands.filter(c => c.detail === 'unavailable-status').length, 1);
  const head = projectScenePoint({ x: point.x + 1.6, y: point.y }, 9);
  assert.equal(pickCampusDrawing(failed, head, { tolerance: .1 }), lamp.id);
  assert.equal(asset(failed.parts, lamp.id).holdingId, 'holding-7');
  assert.deepEqual(input.elements[0], lamp);
});

test('roof and facade hit candidates follow actual projected geometry and visual paint order', () => {
  const rear = element('rear', { geometry: { type: 'polygon', points: rect(20, 20, 30, 30) }, height: 12 });
  const front = element('front', { geometry: { type: 'polygon', points: rect(20, 50, 30, 25) }, height: 8 });
  const drawing = compile([front, rear]);
  const roof = projectScenePoint({ x: 35, y: 60 }, 8), facade = projectScenePoint({ x: 35, y: 75 }, 4);
  assert.equal(pickCampusDrawing(drawing, roof), front.id);
  assert.equal(pickCampusDrawing(drawing, facade), front.id);
  assert.equal(pickCampusDrawing(drawing, { x: -40, y: -40 }), null);
  const exact = element('concave', { geometry: { type: 'polygon', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 20 }, { x: 0, y: 20 }] } });
  const plan = compile([exact], '2d');
  assert.equal(pickCampusDrawing(plan, { x: 12, y: 12 }), null, 'an empty concave courtyard is not a bounding-box hit');
  assert.equal(pickCampusDrawing(plan, { x: 2, y: 12 }), exact.id);
});

test('holding/place eligibility is identity based, while draft mode allows visual-only selection', () => {
  const decorative = element('illustration', { label: 'canonical-building', space_id: null });
  const drawing = compile([decorative], '2d');
  assert.equal(pickCampusDrawing(drawing, { x: 30, y: 40 }), null);
  assert.equal(pickCampusDrawing(drawing, { x: 30, y: 40 }, { draftPreview: true }), decorative.id);
  const bound = element('bound', { label: 'Unrelated label', space_id: null, holding_id: 'canonical-holding' });
  assert.equal(pickCampusDrawing(compile([bound], '2d'), { x: 30, y: 40 }), bound.id);
});

test('same-anchor workstation ordering remains desk then computer regardless of arbitrary IDs', () => {
  const point = { x: 22, y: 35 }, computer = element('a-computer', { kind: 'fixture', asset_key: 'computer', floor_id: 'floor-a', parent_element_id: 'room', space_id: null, holding_id: 'computer-holding', geometry: { type: 'point', points: [point] }, width: 1.5, depth: .7 });
  const desk = element('z-desk', { ...computer, id: 'z-desk', asset_key: 'desk', holding_id: 'desk-holding', width: 3, depth: 1.4 });
  for (const mode of ['2d', '2.5d'] as const) {
    const drawing = compileCampusSceneDrawing(scene([computer, desk]), { floorId: 'floor-a', mode, lighting: 'day' });
    assert.deepEqual(drawing.parts.filter(p => p.role === 'asset').map(p => p.elementId), [desk.id, computer.id]);
    const screenPoint = projectScenePoint({ x: point.x, y: point.y - .25 }, 0, mode);
    assert.equal(pickCampusDrawing(drawing, screenPoint), computer.id);
  }
});

test('rotated furniture and floors reuse shared physical geometry without cross-floor leakage', () => {
  const cabinet = element('cabinet', { kind: 'fixture', asset_key: 'cabinet', geometry: { type: 'point', points: [{ x: 50, y: 50 }] }, rotation_deg: 90, width: 8, depth: 1, floor_id: 'floor-one', holding_id: 'cabinet-holding', space_id: null });
  const hidden = element('other-floor', { floor_id: 'floor-two' });
  const room = element('room', { kind: 'room', floor_id: 'floor-one', geometry: { type: 'polygon', points: rect(30, 30, 40, 40) } });
  const drawing = compileCampusSceneDrawing(scene([cabinet, hidden, room]), { floorId: 'floor-one', mode: '2d', lighting: 'night' });
  assert.equal(drawing.elementBounds.has(hidden.id), false);
  assert.ok(asset(drawing.parts, room.id).commands.some(c => c.detail === 'floor-tiles'));
  assert.equal(pickCampusDrawing(drawing, { x: 50, y: 53.5 }), cabinet.id);
  assert.notEqual(pickCampusDrawing(drawing, { x: 53.5, y: 50 }), cabinet.id);
  assert.equal(drawing.stats.decorativeTrees, 0);
});

test('wall render fragments preserve one original editable ID and culling retains global painter order', () => {
  const wall = element('boundary', { kind: 'path', asset_key: 'boundary_wall', geometry: { type: 'polyline', points: [{ x: 5, y: 90 }, { x: 195, y: 90 }] }, width: .8, height: 2.2 });
  const input = scene([wall, element('rear'), element('front', { geometry: { type: 'polygon', points: rect(90, 95, 30, 20) } })]), drawing = compileCampusSceneDrawing(input, { mode: '2.5d', lighting: 'day', includeSurroundings: false });
  const fragments = drawing.parts.filter(p => p.elementId === wall.id && p.role === 'asset');
  assert.ok(fragments.length > 1);
  assert.ok(fragments.every(p => p.elementId === wall.id && p.spaceId === wall.space_id));
  assert.equal(input.elements[0]!.geometry.points.length, 2);
  const visible = visibleCampusDrawingParts(drawing, { x: 80, y: 40, width: 60, height: 45 });
  assert.deepEqual(visible.map(p => p.key), drawing.parts.filter(p => visible.includes(p)).map(p => p.key));
  assert.equal(pickCampusDrawing(drawing, projectScenePoint({ x: 10, y: 90 }, 1)), wall.id);
});

test('every editable asset kind has a native vector representation without a campus-specific catalogue', () => {
  for (const [index, preset] of CAMPUS_SCENE_ASSETS.entries()) {
    const point = { x: 30 + index, y: 60 };
    const e = element(`kind:${index}`, { ...preset, id: `kind:${index}`, kind: preset.kind, asset_key: preset.key as CampusSceneElement['asset_key'], geometry: preset.kind === 'building' || preset.kind === 'room' || preset.kind === 'surface' ? { type: 'polygon', points: rect(point.x, point.y, 40, 30) } : preset.kind === 'road' || preset.kind === 'path' ? { type: 'polyline', points: [point, { x: point.x + 30, y: point.y + 20 }] } : { type: 'point', points: [point] } });
    for (const mode of ['2d', '2.5d'] as const) {
      const drawing = compile([e], mode), parts = drawing.parts.filter(p => p.elementId === e.id && p.role !== 'shadow');
      assert.ok(parts.length && parts.some(p => p.commands.some(c => c.fill || c.stroke)), `${preset.kind}/${preset.key} is drawn in ${mode}`);
      for (const part of parts) assert.ok(Object.values(part.bounds).every(Number.isFinite));
    }
  }
});

test('sunlight shifts shadows at compile boundaries and night never casts daylight shadows', () => {
  const e = element('timed-building', { height: 12 });
  const morning = compileCampusSceneDrawing(scene([e]), { mode: '2.5d', lighting: 'day', sunlight: resolveSceneSunlight('day', 8), includeSurroundings: false });
  const evening = compileCampusSceneDrawing(scene([e]), { mode: '2.5d', lighting: 'day', sunlight: resolveSceneSunlight('day', 16), includeSurroundings: false });
  const night = compileCampusSceneDrawing(scene([e]), { mode: '2.5d', lighting: 'night', sunlight: resolveSceneSunlight('day', 8), includeSurroundings: false });
  assert.notDeepEqual(morning.parts.find(p => p.role === 'shadow')!.bounds, evening.parts.find(p => p.role === 'shadow')!.bounds);
  assert.equal(night.parts.flatMap(p => p.commands).some(c => c.detail === 'cast-shadow'), false);
  assert.deepEqual(morning.elementBounds.get(e.id), evening.elementBounds.get(e.id));
});

test('large buildings and scenery use bounded detail, while contextual trees have no identities', () => {
  const e = element('large', { levels: 100, height: 360, geometry: { type: 'polygon', points: rect(100, 100, 3000, 2200) } });
  const input = scene([e], { bounds: { width: 10000, height: 8000, unit: 'metres' } });
  const drawing = compileCampusSceneDrawing(input, { mode: '2.5d', lighting: 'day' });
  assert.ok(asset(drawing.parts, e.id).commands.filter(c => c.detail === 'window').length <= 288 * 4);
  assert.ok(drawing.stats.decorativeTrees <= 600);
  assert.ok(drawing.stats.commands < 15000);
  assert.ok(drawing.parts.filter(p => p.role === 'surroundings').every(p => !p.elementId && !p.spaceId && !p.holdingId));
  assert.equal(pickCampusDrawing(drawing, { x: -500, y: -500 }, { draftPreview: true }), null);
  assert.equal(sceneElementHeight(input.elements[0]!), 360);
});

test('retained resource slots preserve the full painter sequence, including shadows and source-plan boundary', () => {
  const lamp = element('mutable-lamp', { kind: 'fixture', asset_key: 'lamp', holding_id: 'lamp-holding', geometry: { type: 'point', points: [{ x: 60, y: 70 }] } });
  const input = scene([element('static-building'), lamp]), drawing = compileCampusSceneDrawing(input, { mode: '2.5d', lighting: 'night', includeSurroundings: false });
  const layers = planCampusScenePictureLayers(drawing, new Set([lamp.id]));
  assert.deepEqual(layers.flatMap(layer => layer.parts.map(part => part.key)), drawing.parts.filter(part => part.commands.length).map(part => part.key));
  assert.ok(layers.filter(layer => layer.elementId === lamp.id).some(layer => layer.parts[0]!.role === 'shadow'));
  assert.ok(layers.filter(layer => layer.elementId === lamp.id).some(layer => layer.parts[0]!.role === 'asset'));
  assert.ok(layers.filter(layer => layer.base).every(layer => layer.parts.every(part => part.elementId === null)));
  const changed = compileCampusSceneDrawing(input, { elements: [lamp], includeBase: false, mode: '2.5d', lighting: 'night', unavailableIds: [lamp.id] });
  assert.ok(changed.parts.every(part => part.elementId === lamp.id));
  assert.equal(changed.stats.decorativeTrees, 0);
  assert.equal(changed.parts.flatMap(part => part.commands).some(command => command.detail === 'lamp-glow'), false);
});

test('only exact reviewed closed navigation adds route/gate treatment; open and unknown remain unchanged', () => {
  const navigation = { walkable: true as const, accessible: true, status: 'open' as const, start_space_id: 'start', end_space_id: 'end' };
  const road = element('road', { kind: 'road', asset_key: 'generic', geometry: { type: 'polyline', points: [{ x: 10, y: 40 }, { x: 90, y: 40 }] }, width: 8 });
  for (const lighting of ['day', 'night'] as const) for (const mode of ['2d', '2.5d'] as const) {
    const render = (e: CampusSceneElement) => compileCampusSceneDrawing(scene([e]), { elements: [e], mode, lighting, includeBase: false });
    const unknown = render(road), open = render({ ...road, navigation }), closedElement = { ...road, navigation: { ...navigation, status: 'closed' as const } }, before = JSON.stringify(closedElement), closed = render(closedElement);
    assert.deepEqual(open.parts, unknown.parts, 'an explicit open link does not restyle the available road');
    const commands = closed.parts.flatMap(part => part.commands), closure = commands.filter(command => command.detail?.startsWith('reviewed-route-closed'));
    assert.equal(closure.length, 2);
    assert.ok(closure.every(command => command.decorative));
    assert.ok(closure.some(command => command.dash?.length));
    assert.equal(pickCampusDrawing(closed, projectScenePoint({ x: 50, y: 40 }, 0, mode)), road.id);
    assert.equal(JSON.stringify(closedElement), before, 'rendering neither changes the reviewed route nor introduces clock inputs');
    assert.equal(render({ ...closedElement, review_state: 'needs_review' }).parts.flatMap(part => part.commands).some(command => command.detail?.startsWith('reviewed-route-closed')), false);
    const gate = element('gate', { kind: 'fixture', asset_key: 'gate', geometry: { type: 'point', points: [{ x: 50, y: 40 }] }, width: 12, height: 6, navigation: closedElement.navigation });
    assert.ok(render(gate).parts.flatMap(part => part.commands).some(command => command.detail === 'reviewed-gate-closed'));
    assert.equal(render({ ...gate, navigation }).parts.flatMap(part => part.commands).some(command => command.detail === 'reviewed-gate-closed'), false);
  }
});

test('stairs, lifts and entrances show reviewed connector closure without changing authored identity or destinations', () => {
  for (const kind of ['stairs', 'lift', 'entrance'] as const) for (const lighting of ['day', 'night'] as const) {
    const connector = element(`connector:${kind}`, { kind: 'fixture', geometry: { type: 'point', points: [{ x: 50, y: 50 }] }, width: 4, navigation_connector: { kind, status: 'closed', accessible: kind !== 'stairs', from_floor_id: null, to_floor_id: 'floor-two' } });
    const before = JSON.stringify(connector), render = (e: CampusSceneElement) => compileCampusSceneDrawing(scene([e]), { mode: '2d', lighting, includeBase: false });
    const closed = render(connector), open = render({ ...connector, navigation_connector: { ...connector.navigation_connector!, status: 'open' } }), unreviewed = render({ ...connector, review_state: 'needs_review' });
    assert.equal(closed.parts.flatMap(part => part.commands).filter(command => command.detail === 'reviewed-connector-closed').length, 3);
    assert.equal(open.parts.flatMap(part => part.commands).some(command => command.detail === 'reviewed-connector-closed'), false);
    assert.equal(unreviewed.parts.flatMap(part => part.commands).some(command => command.detail === 'reviewed-connector-closed'), false);
    assert.equal(pickCampusDrawing(closed, { x: 50, y: 50 }), connector.id);
    assert.equal(JSON.stringify(connector), before);
  }
});
