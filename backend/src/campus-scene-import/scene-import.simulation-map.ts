import type { PreparedMapArea } from './scene-import.area.js';
import { osmToGeoJson, sceneFromGeoJson } from './scene-import.geometry.js';

/** The fictional shapes in the offline map picker. Never used in Live. */
const schematic = osmToGeoJson({ elements: [
  rectangle(1, 'Learning block', 77.23045, 28.61222, 77.23082, 28.61246, { building: 'yes' }),
  rectangle(2, 'Library', 77.23110, 28.61222, 77.23147, 28.61246, { building: 'yes' }),
  { type: 'way', id: 3, tags: { name: 'Campus walk', highway: 'footway' }, geometry: [{ lon: 77.2303, lat: 28.61210 }, { lon: 77.23155, lat: 28.61210 }] },
  rectangle(4, 'Sports ground', 77.2306, 28.61165, 77.23135, 28.61196, { leisure: 'pitch', sport: 'soccer' }),
] });

function rectangle(id: number, name: string, west: number, south: number, east: number, north: number, tags: Record<string, string>) {
  return { type: 'way', id, tags: { ...tags, name }, geometry: [
    { lon: west, lat: south }, { lon: east, lat: south }, { lon: east, lat: north }, { lon: west, lat: north }, { lon: west, lat: south },
  ] };
}

export function simulationMapArea(label: string, area: PreparedMapArea) {
  return sceneFromGeoJson(area.filter(schematic), label, {
    kind: 'manual', label: 'Fictional campus map', attribution: 'ThatCampus fictional Simulation map',
    notes: 'This schematic supports rehearsal. No external map or AI provider was contacted.',
  }, area.bounds);
}
