import { BadRequestException } from '@nestjs/common';
import { polygonIsSimple, type ScenePoint } from '../campus-scenes/campus-scenes.contracts.js';
import type { SceneMapBoundary } from './scene-import.contracts.js';
import type { osmToGeoJson } from './scene-import.geometry.js';

type Coordinate = [longitude: number, latitude: number];
type MapBounds = { south: number; west: number; north: number; east: number };

const METRES_PER_DEGREE = 111_320;
const EPSILON = 1e-6;

function pointsDiffer(a: ScenePoint, b: ScenePoint) {
  return Math.hypot(a.x - b.x, a.y - b.y) > EPSILON;
}

function cross(ax: number, ay: number, bx: number, by: number) {
  return ax * by - ay * bx;
}

function mapCoordinate(value: unknown): value is Coordinate {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

/** Use local metres for robust containment and retain only complete polygons. */
export function prepareMapArea(boundary: SceneMapBoundary) {
  const bounds: MapBounds = {
    south: Math.min(...boundary.map(point => point.latitude)),
    west: Math.min(...boundary.map(point => point.longitude)),
    north: Math.max(...boundary.map(point => point.latitude)),
    east: Math.max(...boundary.map(point => point.longitude)),
  };
  const scaleX = METRES_PER_DEGREE * Math.cos((bounds.south + bounds.north) / 2 * Math.PI / 180);
  const toLocal = ([longitude, latitude]: Coordinate): ScenePoint => ({
    x: (longitude - bounds.west) * scaleX,
    y: (latitude - bounds.south) * METRES_PER_DEGREE,
  });
  const toMap = (point: ScenePoint): Coordinate => [
    Math.min(bounds.east, Math.max(bounds.west, bounds.west + point.x / scaleX)),
    Math.min(bounds.north, Math.max(bounds.south, bounds.south + point.y / METRES_PER_DEGREE)),
  ];
  const ring = boundary.map(point => toLocal([point.longitude, point.latitude]));
  const edges = ring.map((point, index) => [point, ring[(index + 1) % ring.length]!] as const);
  const area = Math.abs(edges.reduce((sum, [a, b]) => sum + cross(a.x, a.y, b.x, b.y), 0)) / 2;
  const extent = toLocal([bounds.east, bounds.north]);
  if (extent.x > 4000 || extent.y > 4000)
    throw new BadRequestException('Choose a campus boundary no more than 4 km across.');
  if (extent.x < 5 || extent.y < 5 || area < 25 || !polygonIsSimple(ring))
    throw new BadRequestException('Draw a single campus boundary of at least 25 square metres with no crossing edges.');

  function contains(point: ScenePoint) {
    let inside = false;
    for (const [a, b] of edges) {
      if (Math.abs(cross(b.x - a.x, b.y - a.y, point.x - a.x, point.y - a.y)) < EPSILON
        && point.x >= Math.min(a.x, b.x) - EPSILON && point.x <= Math.max(a.x, b.x) + EPSILON
        && point.y >= Math.min(a.y, b.y) - EPSILON && point.y <= Math.max(a.y, b.y) + EPSILON) return true;
      if ((a.y > point.y) !== (b.y > point.y) && point.x < a.x + (b.x - a.x) * (point.y - a.y) / (b.y - a.y))
        inside = !inside;
    }
    return inside;
  }

  // Split at all boundary intersections. Testing each midpoint handles concave
  // selections and line segments that leave and re-enter the selected campus.
  function intervals(a: ScenePoint, b: ScenePoint) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const cuts = [0, 1];
    for (const [c, d] of edges) {
      const ex = d.x - c.x, ey = d.y - c.y, vx = c.x - a.x, vy = c.y - a.y;
      const denominator = cross(dx, dy, ex, ey);
      if (Math.abs(denominator) < EPSILON) {
        if (Math.abs(cross(vx, vy, dx, dy)) >= EPSILON || !pointsDiffer(a, b)) continue;
        const base = dx * dx + dy * dy;
        for (const edge of [c, d]) {
          const t = ((edge.x - a.x) * dx + (edge.y - a.y) * dy) / base;
          if (t > 0 && t < 1) cuts.push(t);
        }
        continue;
      }
      const t = cross(vx, vy, ex, ey) / denominator;
      const u = cross(vx, vy, dx, dy) / denominator;
      if (t > 0 && t < 1 && u >= -EPSILON && u <= 1 + EPSILON) cuts.push(t);
    }
    cuts.sort((left, right) => left - right);
    const at = (t: number): ScenePoint => ({ x: a.x + dx * t, y: a.y + dy * t });
    return cuts.slice(1).flatMap((end, index) => {
      const start = cuts[index]!;
      if (end - start < EPSILON) return [];
      return [{ a: at(start), b: at(end), inside: contains(at((start + end) / 2)) }];
    });
  }

  function clippedLine(coordinates: Coordinate[]) {
    const local = coordinates.map(toLocal);
    const parts: Coordinate[][] = [];
    let points: ScenePoint[] = [];
    const finish = () => {
      if (points.length > 1) parts.push(points.map(toMap));
      points = [];
    };
    for (let i = 1; i < local.length; i++) {
      for (const part of intervals(local[i - 1]!, local[i]!)) {
        if (!part.inside) {
          finish();
          continue;
        }
        if (!pointsDiffer(part.a, part.b)) continue;
        const last = points.at(-1);
        if (last && pointsDiffer(last, part.a)) finish();
        if (!points.length) points.push(part.a);
        points.push(part.b);
      }
    }
    finish();
    return parts;
  }

  function completeRing(coordinates: unknown) {
    if (!Array.isArray(coordinates) || !coordinates.every(mapCoordinate)) return false;
    const local = coordinates.map(toLocal);
    return local.every((point, index) => contains(point)
      && intervals(point, local[(index + 1) % local.length]!).every(part => part.inside));
  }

  function filter(features: ReturnType<typeof osmToGeoJson>) {
    const vertices = features.features.reduce((count, feature) => {
      const coordinates = feature.geometry?.coordinates;
      if (!Array.isArray(coordinates)) return count;
      if (feature.geometry?.type === 'Point') return count + 1;
      if (feature.geometry?.type === 'LineString') return count + coordinates.length;
      return count + coordinates.reduce((sum, ring) => sum + (Array.isArray(ring) ? ring.length : 0), 0);
    }, 0);
    if (vertices > 40_000)
      throw new BadRequestException('This map has too many outlines. Draw a smaller campus area.');
    return { type: 'FeatureCollection', features: features.features.flatMap(item => {
      const geometry = item.geometry;
      if (!geometry) return [];
      const coordinates = geometry.coordinates;
      if (geometry.type === 'Point' && mapCoordinate(coordinates) && contains(toLocal(coordinates))) return [item];
      if (geometry.type === 'Polygon' && Array.isArray(coordinates) && coordinates.every(completeRing)) return [item];
      if (geometry.type === 'LineString' && Array.isArray(coordinates) && coordinates.every(mapCoordinate))
        return clippedLine(coordinates).map((part, index) => ({ ...item, id: `${item.id}-clip-${index + 1}`, geometry: { type: 'LineString', coordinates: part } }));
      return [];
    }) };
  }
  return { bounds, filter };
}

export type PreparedMapArea = ReturnType<typeof prepareMapArea>;
