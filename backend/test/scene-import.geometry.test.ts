import { describe, expect, it } from 'vitest';
import { osmToGeoJson, sceneFromGeoJson } from '../src/campus-scene-import/scene-import.geometry.js';
import type { SceneDocument } from '../src/campus-scenes/campus-scenes.contracts.js';

const source: SceneDocument['source'] = { kind: 'open_map', label: 'Source campus map', attribution: '© OpenStreetMap contributors' };
const ring = [[77, 28], [77.0005, 28], [77.0005, 28.0004], [77, 28.0004], [77, 28]];
function polygon(coordinates: unknown[] = [ring], properties: Record<string, unknown> = { building: 'yes', name: 'Learning Block' }) { return { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates } }; }
function point(coordinates: unknown = [77.0006, 28.0002], properties: Record<string, unknown> = { natural: 'tree' }) { return { type: 'Feature', properties, geometry: { type: 'Point', coordinates } }; }
function line(coordinates: unknown = [[77, 28], [77.0007, 28.0005]], properties: Record<string, unknown> = { highway: 'footway' }) { return { type: 'Feature', properties, geometry: { type: 'LineString', coordinates } }; }
function collection(features: unknown[]) { return { type: 'FeatureCollection', features }; }

describe('campus source geometry import', () => {
  it('projects longitude/latitude into bounded metre coordinates and preserves provenance and review', () => {
    const scene = sceneFromGeoJson(collection([polygon(), point(), line()]), 'North campus', source);
    expect(scene.bounds.unit).toBe('metres'); expect(scene.source.attribution).toBe(source.attribution);
    expect(scene.source.notes).toMatch(/not a survey/);
    const building = scene.elements[0]!;
    expect(building).toMatchObject({ kind: 'building', label: 'Learning Block', space_id: null, floor_id: null, review_state: 'needs_review' });
    expect(building.geometry.points).toHaveLength(4);
    const [a, b, c] = building.geometry.points;
    expect(a!.x).toBe(20); expect(b!.x - a!.x).toBeCloseTo(111_320 * Math.cos(28.00025 * Math.PI / 180) * .0005, 1);
    expect(a!.y - c!.y).toBeCloseTo(44.528, 1);
    expect(scene.elements.every((element) => element.geometry.points.every((p) => p.x >= 0 && p.y >= 0 && p.x <= scene.bounds.width && p.y <= scene.bounds.height))).toBe(true);
    expect(scene.elements[1]!.kind).toBe('tree'); expect(scene.elements[2]!.kind).toBe('path');
  });

  it('retains source heights and integer levels, treating missing dimensions as estimates', () => {
    const scene = sceneFromGeoJson(collection([polygon([ring], { building: 'school', height: '13.5 m', 'building:levels': '3' }), line(undefined, { highway: 'service', width: '7 m' })]), 'Campus', source);
    expect(scene.elements[0]).toMatchObject({ height: 13.5, levels: 3 });
    expect(scene.elements[1]).toMatchObject({ kind: 'road', width: 7 });
    const noHeight = sceneFromGeoJson(collection([polygon()]), 'Campus', source).elements[0]!;
    expect(noHeight.height).toBeUndefined(); expect(noHeight.levels).toBeUndefined();
  });

  it('never fills courtyard holes and explains omitted features beside surviving outlines', () => {
    const courtyard = [[77.0001, 28.0001], [77.0002, 28.0001], [77.0002, 28.0002], [77.0001, 28.0001]];
    const scene = sceneFromGeoJson(collection([polygon([ring, courtyard]), point()]), 'Campus', source);
    expect(scene.elements).toHaveLength(1); expect(scene.elements[0]!.kind).toBe('tree');
    expect(scene.source.notes).toMatch(/1 polygon part\(s\) with courtyard holes were omitted/);
    expect(() => sceneFromGeoJson(collection([polygon([ring, courtyard])]), 'Campus', source)).toThrow(/holes have not been filled/);
  });

  it('imports independent MultiPolygon parts without joining disconnected buildings', () => {
    const second = ring.map(([x, y]) => [x! + .001, y]);
    const scene = sceneFromGeoJson(collection([{ type: 'Feature', properties: { building: 'yes' }, geometry: { type: 'MultiPolygon', coordinates: [[ring], [second]] } }]), 'Campus', source);
    expect(scene.elements).toHaveLength(2); expect(scene.elements.every((element) => element.geometry.points.length === 4)).toBe(true);
    expect(scene.elements.map(element => element.source_feature_id)).toEqual(['geojson-feature-1', 'geojson-feature-1']);
    expect(scene.elements[1]!.geometry.points[0]!.x).toBeGreaterThan(scene.elements[0]!.geometry.points[1]!.x);
  });

  it('does not merge independent features because their external IDs or names match', () => {
    const first = { ...polygon(), id: 'shared-external-id' };
    const second = { ...polygon([ring.map(([x, y]) => [x! + .001, y])]), id: 'shared-external-id' };
    const scene = sceneFromGeoJson(collection([first, second]), 'Campus', source);
    expect(scene.elements.map(element => element.source_feature_id)).toEqual(['geojson-feature-1', 'geojson-feature-2']);
    expect(scene.elements.every(element => element.space_id === null && element.review_state === 'needs_review')).toBe(true);
  });

  it('omits an entire malformed or crossing shape instead of removing bad vertices', () => {
    const malformed = [ring[0], ['invalid', 28.0002], ...ring.slice(1)];
    const crossing = [ring[0], ring[2], ring[1], ring[3], ring[0]];
    const unclosed = ring.slice(0, -1);
    const scene = sceneFromGeoJson(collection([polygon([malformed]), polygon([crossing]), polygon([unclosed]), point()]), 'Campus', source);
    expect(scene.elements).toHaveLength(1); expect(scene.source.notes).toMatch(/3 unsupported or invalid/);
  });

  it('does not invent benches for arbitrary points or walking paths for utility lines', () => {
    const scene = sceneFromGeoJson(collection([polygon(), point(undefined, { amenity: 'school', name: 'Campus label' }), line(undefined, { power: 'line' }), point([77.0003, 28.0003], { amenity: 'bench' }), point([77.0004, 28.0003], { highway: 'street_lamp' })]), 'Campus', source);
    expect(scene.elements.map((element) => element.asset_key)).toEqual(['generic', 'bench', 'lamp']);
    expect(scene.source.notes).toMatch(/2 unsupported or invalid/);
  });

  it('honours building=no and keeps unclassified polygons neutral until reviewed', () => {
    const scene = sceneFromGeoJson(collection([polygon([ring], { building: 'no', name: 'Outline' })]), 'Campus', source);
    expect(scene.elements[0]).toMatchObject({ kind: 'surface', asset_key: 'generic', material: 'neutral' });
  });

  it('rejects missing attribution, nongeographic coordinates, oversized areas and unsupported input', () => {
    expect(() => sceneFromGeoJson(collection([polygon()]), 'Campus', { kind: 'manual', label: 'My file' })).toThrow(/attribution/);
    expect(() => sceneFromGeoJson(collection([point([1000, 1000])]), 'Campus', source)).toThrow(/No supported/);
    expect(() => sceneFromGeoJson(collection([line([[77, 28], [78, 28]])]), 'Campus', source)).toThrow(/more than 10 km/);
    expect(() => sceneFromGeoJson({ type: 'Polygon', coordinates: [ring] }, 'Campus', source)).toThrow(/FeatureCollection/);
  });

  it('bounds aggregate point work before constructing a giant projection', () => {
    const points = Array.from({ length: 500 }, (_, index) => [77 + index * .000001, 28]);
    expect(() => sceneFromGeoJson(collection(Array.from({ length: 41 }, () => line(points))), 'Campus', source)).toThrow(/20,000 source points/);
  });
});

describe('OpenStreetMap geometry adapter', () => {
  it('uses source way geometry and node types without inventing coordinates', () => {
    const geojson = osmToGeoJson({ elements: [
      { type: 'way', id: 1, tags: { building: 'school', name: 'School' }, geometry: ring.map(([lon, lat]) => ({ lon, lat })) },
      { type: 'node', id: 2, lon: 77.0007, lat: 28.0004, tags: { natural: 'tree' } },
      { type: 'way', id: 3, tags: { highway: 'service' }, geometry: [{ lon: 77, lat: 28 }, { lon: 77.001, lat: 28 }] },
    ] });
    expect(geojson.features.map((feature) => feature.geometry?.type)).toEqual(['Polygon', 'Point', 'LineString']);
    expect(sceneFromGeoJson(geojson, 'Campus', source).elements.map((element) => element.kind)).toEqual(['building', 'tree', 'road']);
  });

  it('preserves a malformed source vertex for whole-shape rejection', () => {
    const geojson = osmToGeoJson({ elements: [{ type: 'way', id: 1, tags: { highway: 'footway' }, geometry: [{ lon: 77, lat: 28 }, { lat: 28.0001 }, { lon: 77.001, lat: 28 }] }, { type: 'node', id: 2, lon: 77, lat: 28, tags: { natural: 'tree' } }] });
    const scene = sceneFromGeoJson(geojson, 'Campus', source);
    expect(scene.elements).toHaveLength(1); expect(scene.elements[0]!.kind).toBe('tree');
  });

  it('rejects unreadable and oversized provider envelopes', () => {
    expect(() => osmToGeoJson(null)).toThrow(/unreadable/);
    expect(() => osmToGeoJson({ elements: Array.from({ length: 10_001 }, () => ({})) })).toThrow(/oversized/);
  });
});
