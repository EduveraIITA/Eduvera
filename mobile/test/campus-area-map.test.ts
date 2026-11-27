import assert from 'node:assert/strict';
import test from 'node:test';
import { departurePointOnMap, departureMapFrame } from '../src/features/DepartureMapPolicy';
import {
  CAMPUS_AREA_MAX_POINTS,
  CAMPUS_AREA_SIMULATION_CENTER,
  CAMPUS_AREA_SIMULATION_FEATURES,
  campusAreaBoundaryIssue,
  campusAreaCoordinates,
  campusAreaPointAt,
  campusAreaView,
  panCampusArea,
} from '../src/features/campus/CampusAreaMapPolicy';

test('map taps and directional controls resolve to the same coordinates at the displayed zoom', () => {
  const view = campusAreaView(CAMPUS_AREA_SIMULATION_CENTER);
  const point = campusAreaPointAt(view, 360, 320, 230, 120);
  const projected = departurePointOnMap(point, departureMapFrame(view, 360, 320, ''));
  assert.ok(Math.abs(projected.x - 230) < .01);
  assert.ok(Math.abs(projected.y - 120) < .01);
  assert.deepEqual(campusAreaPointAt(panCampusArea(view, 50, -40), 0, 0, 0, 0), point);
});

test('campus boundary validation matches the map drawing constraints', () => {
  const rectangle = CAMPUS_AREA_SIMULATION_FEATURES.grounds;
  assert.equal(campusAreaBoundaryIssue(rectangle), null);
  assert.match(campusAreaBoundaryIssue(rectangle.slice(0, 2))!, /three/);
  assert.match(campusAreaBoundaryIssue([rectangle[0]!, rectangle[2]!, rectangle[1]!, rectangle[3]!])!, /crosses/);
  assert.match(campusAreaBoundaryIssue(Array.from({ length: CAMPUS_AREA_MAX_POINTS + 1 }, () => rectangle[0]!))!, /48 points/);
  assert.match(campusAreaBoundaryIssue([
    { latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.00001 }, { latitude: 0.00001, longitude: 0 },
  ])!, /25 square metres/);
  assert.match(campusAreaBoundaryIssue([
    { latitude: 0, longitude: 0 }, { latitude: 0, longitude: .06 }, { latitude: .01, longitude: 0 },
  ])!, /4 km/);
});

test('a local outline remains local on either side of the date line', () => {
  assert.equal(campusAreaBoundaryIssue([
    { latitude: 0, longitude: 179.999 }, { latitude: 0, longitude: -179.999 },
    { latitude: 0.002, longitude: -179.999 }, { latitude: 0.002, longitude: 179.999 },
  ]), null);
});

test('the permission-free coordinate fallback accepts decimal coordinates without changing the requested location', () => {
  assert.deepEqual(campusAreaCoordinates('  -33.875, +151.214 '), { latitude: -33.875, longitude: 151.214 });
  assert.equal(campusAreaCoordinates('90, 0'), null);
  assert.equal(campusAreaCoordinates('0, 181'), null);
  assert.equal(campusAreaCoordinates('0, 0, 0'), null);
  assert.equal(campusAreaCoordinates('12,'), null);
});
