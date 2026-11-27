import { projectDeparturePoint, unprojectDeparturePoint, type DepartureMapPoint, type DepartureMapViewport } from '../DepartureMapPolicy';

export type CampusAreaPoint = DepartureMapPoint;

const MERCATOR_LATITUDE_LIMIT = 85.05112878;
const MAX_BOUNDARY_SPAN_METRES = 4000;
export const CAMPUS_AREA_MAX_POINTS = 48;
export const CAMPUS_AREA_MIN_ZOOM = 14;
export const CAMPUS_AREA_SIMULATION_CENTER: CampusAreaPoint = { latitude: 28.612, longitude: 77.231 };
export const CAMPUS_AREA_WORLD_VIEW: DepartureMapViewport = { center: { latitude: 18, longitude: 0 }, zoom: 2 };

export function campusAreaView(point: CampusAreaPoint): DepartureMapViewport {
  return { center: point, zoom: 17 };
}

export function panCampusArea(view: DepartureMapViewport, dx: number, dy: number): DepartureMapViewport {
  const point = projectDeparturePoint(view.center, view.zoom);
  return { ...view, center: unprojectDeparturePoint(point.x + dx, point.y + dy, view.zoom) };
}

export function campusAreaCoordinates(text: string): CampusAreaPoint | null {
  const parts = text.match(/^\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*$/);
  if (!parts) return null;
  const point = { latitude: Number(parts[1]), longitude: Number(parts[2]) };
  return Math.abs(point.latitude) <= MERCATOR_LATITUDE_LIMIT && Math.abs(point.longitude) <= 180 ? point : null;
}

export function campusAreaPointAt(view: DepartureMapViewport, width: number, height: number, x: number, y: number): CampusAreaPoint {
  const point = panCampusArea(view, x - width / 2, y - height / 2).center;
  return { latitude: Number(point.latitude.toFixed(7)), longitude: Number(point.longitude.toFixed(7)) };
}

type Vector = { x: number; y: number };

function side(a: Vector, b: Vector, c: Vector) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function touches(a: Vector, b: Vector, c: Vector) {
  return Math.abs(side(a, b, c)) < .0001 &&
    (c.x - a.x) * (c.x - b.x) + (c.y - a.y) * (c.y - b.y) <= 0;
}

function crosses(a: Vector, b: Vector, c: Vector, d: Vector) {
  return (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) ||
    touches(a, b, c) || touches(a, b, d) || touches(c, d, a) || touches(c, d, b);
}

export function campusAreaBoundaryIssue(boundary: readonly CampusAreaPoint[]): string | null {
  if (boundary.length < 3) return 'Add at least three points around the campus.';
  if (boundary.length > CAMPUS_AREA_MAX_POINTS) return 'Campus outlines can have up to 48 points.';
  const origin = boundary[0]!;
  const longitudeScale = 111_320 * Math.cos(origin.latitude * Math.PI / 180);
  const points = boundary.map(point => ({
    x: (((point.longitude - origin.longitude + 540) % 360) - 180) * longitudeScale,
    y: (point.latitude - origin.latitude) * 111_320,
  }));
  const x = points.map(point => point.x), y = points.map(point => point.y);
  const width = Math.max(...x) - Math.min(...x), height = Math.max(...y) - Math.min(...y);
  if (width > MAX_BOUNDARY_SPAN_METRES || height > MAX_BOUNDARY_SPAN_METRES) {
    return 'Draw a smaller campus outline, up to 4 km across.';
  }
  const count = points.length;
  let area = 0;
  for (let i = 0; i < count; i++) {
    const a = points[i]!, b = points[(i + 1) % count]!;
    area += a.x * b.y - b.x * a.y;
    for (let j = i + 2; j < count; j++) {
      if (i === 0 && j === count - 1) continue;
      if (crosses(a, b, points[j]!, points[(j + 1) % count]!)) {
        return 'The outline crosses itself. Undo a point and follow the campus edge in order.';
      }
    }
  }
  if (width < 5 || height < 5 || Math.abs(area) < 50) return 'Spread the points out to enclose at least 25 square metres.';
  return null;
}

function simulationPath(coordinates: readonly (readonly [number, number])[]) {
  return coordinates.map(([longitude, latitude]) => ({ latitude, longitude }));
}

export const CAMPUS_AREA_SIMULATION_FEATURES = {
  buildings: [
    simulationPath([[77.23045, 28.61222], [77.23082, 28.61222], [77.23082, 28.61246], [77.23045, 28.61246]]),
    simulationPath([[77.2311, 28.61222], [77.23147, 28.61222], [77.23147, 28.61246], [77.2311, 28.61246]]),
  ],
  path: simulationPath([[77.2303, 28.6121], [77.23155, 28.6121]]),
  grounds: simulationPath([[77.2306, 28.61165], [77.23135, 28.61165], [77.23135, 28.61196], [77.2306, 28.61196]]),
};
