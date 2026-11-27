import type { CampusScenePublished } from '../../../../packages/contracts/src/campus-scenes/contracts';
import type { CampusSceneDocument, CampusSceneElement, CampusSceneSpace } from '../../../../packages/contracts/src/campus-scenes/types';
import { sceneElementBuilding } from '../../../../packages/contracts/src/campus-scenes/sceneInterior';
import { createScenePlaceProposals } from '../../../../packages/contracts/src/campus-scenes/scenePlaceProposals';
import { nativeCampusDisplay, nativeCampusPlaceSelection } from '../../lib/native-campus';

type Place = CampusScenePublished['places'][number];
type FocusTarget = { kind: 'place' | 'element'; id: string };

const cleanName = (value: string) => value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase();

export function campusInteriorBuildings(document: CampusSceneDocument, spaces: readonly Pick<CampusSceneSpace, 'id' | 'status'>[]): CampusSceneElement[] {
  const activePlaces = new Set(spaces.filter(place => place.status !== 'inactive').map(place => place.id));
  return document.elements.filter(element => element.kind === 'building' && element.geometry.type === 'polygon'
    && !!element.space_id && activePlaces.has(element.space_id));
}

export function findCampusInteriorBuilding(
  buildings: readonly CampusSceneElement[], spaces: readonly CampusSceneSpace[], query: string,
): CampusSceneElement | undefined {
  const bounded = campusCopilotQuery(query);
  if (!bounded) return undefined;
  const name = cleanName(bounded);
  const linked = new Map(spaces.map(space => [space.id, space]));
  const matching = buildings.filter(building => {
    const space = building.space_id ? linked.get(building.space_id) : undefined;
    return !!space && [building.label, space.name, space.code].some(label => cleanName(label) === name);
  });
  return matching.length === 1 ? matching[0] : undefined;
}

export function campusInteriorSetupStage(
  document: CampusSceneDocument,
  spaces: readonly Pick<CampusSceneSpace, 'id' | 'status'>[],
  draftOpen: boolean,
): 'reopen' | 'indoor' | 'assisted' | 'preview' | 'map' {
  if (!draftOpen) return 'reopen';
  if (campusInteriorBuildings(document, spaces).length) return 'indoor';
  const unlinkedOutlines = new Set(document.elements.filter(element => element.kind === 'building'
    && element.geometry.type === 'polygon' && !element.space_id && !element.floor_id).map(element => element.id));
  if (unlinkedOutlines.size && createScenePlaceProposals(document, []).some(group =>
    group.category === 'places' && group.elementIds.some(id => unlinkedOutlines.has(id)))) return 'assisted';
  if (!document.elements.length && document.source.kind === 'manual' && !document.source.image_asset_id) return 'map';
  return 'preview';
}

export function campusCopilotQuery(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 120 ||
    Array.from(value).some(character => character.charCodeAt(0) < 32)) return null;
  const query = value.trim();
  return query || null;
}

/** Resolve the reviewed drawing the viewer can actually open. A parent's
 * available outline does not make an unmapped room an exact target. */
export function campusCopilotFocusTarget(
  scene: CampusSceneDocument, places: readonly Place[], query: string,
): FocusTarget | null {
  const name = cleanName(query);
  if (!name) return null;
  const availablePlaces = [...places];
  const byId = new Map(places.map(place => [place.id, place]));
  const matches = new Map<string, FocusTarget>();
  const add = (target: FocusTarget) => matches.set(`${target.kind}:${target.id}`, target);
  for (const element of scene.elements) {
    if (element.review_state !== 'reviewed' || element.id === 'map-boundary' ||
      !['building', 'room', 'surface', 'fixture'].includes(element.kind)) continue;
    const place = element.space_id ? byId.get(element.space_id) : undefined;
    if (![element.label, place?.name, place?.code].some(text => text && cleanName(text) === name)) continue;
    if (element.floor_id) {
      const owner = sceneElementBuilding(scene, availablePlaces, element);
      if (!owner || !nativeCampusDisplay(scene, places, {
        selectedId: element.id, buildingId: owner.id, floorId: element.floor_id,
      }).document) continue;
    }
    add(place && (element.kind === 'building' || element.kind === 'room')
      ? { kind: 'place', id: place.id } : { kind: 'element', id: element.id });
  }
  for (const place of places) {
    if (place.kind !== 'floor' || ![place.name, place.code].some(text => cleanName(text) === name)) continue;
    const selection = nativeCampusPlaceSelection(scene, places, place.id);
    if (selection?.floorId === place.id && nativeCampusDisplay(scene, places, selection).document)
      add({ kind: 'place', id: place.id });
  }
  return matches.size === 1 ? matches.values().next().value ?? null : null;
}
