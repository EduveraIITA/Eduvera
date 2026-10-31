import type { CampusViewSpace } from "../campus-view";
import type { CampusSceneDocument, CampusSceneElement } from "./types";
import { sceneVisibleElements } from "./sceneGeometry";
import type { SceneEvidenceLayer, SceneEvidenceProjection, SceneEvidenceRecord, SceneEvidenceGroup } from "./sceneEvidence.types";

export type SceneCanonicalPlace = Pick<CampusViewSpace,"id"|"campus_id"|"parent_space_id"|"kind"> & Partial<Pick<CampusViewSpace,"capacity"|"name"|"code">>;
export interface SceneEvidenceInput {
  records: readonly SceneEvidenceRecord[];
  spaces: readonly SceneCanonicalPlace[];
  scene: CampusSceneDocument;
  campusId: string;
  floorId?: string | null;
  layer: SceneEvidenceLayer;
}

const dimensionLabel = {expected:"Expected",observed:"Observed",accepted:"Accepted",unknown:"Unknown"} as const;

/** Pure presentation projection: only explicit links and known canonical ancestry locate a record. */
export function projectSceneEvidence({records,spaces,scene,campusId,floorId = null,layer}:SceneEvidenceInput):SceneEvidenceProjection {
  if (layer === "none") return {markers:[],groups:[],unlocated:[]};
  const allPlaces = new Map(spaces.map(space=>[space.id,space]));
  const places = new Map(spaces.filter(space=>space.campus_id===campusId).map(space=>[space.id,space]));
  const parentChain = (space:SceneCanonicalPlace) => {
    const result:SceneCanonicalPlace[] = [], visited = new Set<string>([space.id]);
    let parent = space.parent_space_id;
    while (parent && !visited.has(parent)) {
      visited.add(parent); const current = places.get(parent);
      if (!current) break;
      result.push(current); parent = current.parent_space_id;
    }
    if (parent && visited.has(parent)) return [];
    return result;
  };
  const visible = sceneVisibleElements(scene.elements,floorId).filter(element=>element.space_id && places.has(element.space_id));
  const rank = (element:CampusSceneElement,kind:string) => element.kind===kind ? 0 : element.kind==="building" ? 1 : element.kind==="room" ? 2 : element.kind==="surface" ? 3 : 4;
  const candidates = new Map<string,CampusSceneElement[]>();
  for (const element of visible) {
    const spaceId=element.space_id!,place=places.get(spaceId)!;
    if (floorId && (element.kind!=="room" || element.floor_id!==floorId || parentChain(place).find(parent=>parent.kind==="floor")?.id!==floorId)) continue;
    candidates.set(spaceId,[...(candidates.get(spaceId)??[]),element]);
  }
  for (const [spaceId,elements] of candidates) elements.sort((a,b)=>rank(a,places.get(spaceId)!.kind)-rank(b,places.get(spaceId)!.kind)||a.id.localeCompare(b.id));
  const selected = new Map<string,SceneEvidenceRecord>();
  for (const record of records) if (record.dimension===layer && (!record.spaceId || !allPlaces.has(record.spaceId) || allPlaces.get(record.spaceId)!.campus_id===campusId) && !selected.has(record.id)) selected.set(record.id,record);
  const groupsById = new Map<string,SceneEvidenceGroup>(), unlocated:SceneEvidenceRecord[]=[];
  for (const record of [...selected.values()].sort((a,b)=>a.id.localeCompare(b.id))) {
    const place=record.spaceId ? places.get(record.spaceId) : undefined;
    let element = place ? candidates.get(place.id)?.[0] : undefined;
    if (!element && place && !floorId) for (const parent of parentChain(place)) {
      if (parent.kind!=="building") continue;
      element=candidates.get(parent.id)?.find(candidate=>candidate.kind==="building");
      if (element) break;
    }
    if (!element || !place) {unlocated.push(record);continue;}
    const id=`${record.dimension}:${element.id}`;
    const group=groupsById.get(id)??{id,elementId:element.id,records:[],spaceIds:[],aggregated:false};
    group.records.push(record); if (!group.spaceIds.includes(place.id)) group.spaceIds.push(place.id);
    group.aggregated ||= element.space_id!==place.id;
    groupsById.set(id,group);
  }
  const elementsById=new Map(visible.map(element=>[element.id,element]));
  const groups=[...groupsById.values()].sort((a,b)=>a.id.localeCompare(b.id));
  const markers=groups.map(group=>{
    group.spaceIds.sort();
    const element=elementsById.get(group.elementId)!,count=group.records.length,current=group.records.filter(record=>record.temporal==="current");
    const expectedCount=layer==="expected" && current.length===1 && Number.isSafeInteger(current[0]!.expectedCount) && current[0]!.expectedCount!>=0 ? current[0]!.expectedCount : undefined;
    const historical=group.records.filter(record=>record.temporal==="historical").length;
    // An outdoor building marker may retain one child room's exact warning.
    // Distinct rooms or assignments never acquire a summed participant count.
    const capacityPlace = group.spaceIds.length===1 && current.length===1 ? places.get(group.spaceIds[0]!) : undefined;
    const capacity = capacityPlace?.capacity;
    const plannedCapacityPressure = expectedCount!==undefined && typeof capacity==="number" && Number.isFinite(capacity) && capacity>0 && expectedCount>capacity ? {expectedCount,capacity} : undefined;
    const capacityPlaceLabel = capacityPlace?.name?.trim() || capacityPlace?.code?.trim() || capacityPlace?.id;
    const summary=`${count} ${dimensionLabel[layer].toLowerCase()} ${count===1 ? "record" : "records"}${current.length ? `, ${current.length} current` : ""}${historical ? `, ${historical} historical` : ""}.${group.aggregated ? ` Includes records from ${group.spaceIds.length} linked ${group.spaceIds.length===1 ? "place" : "places"}.` : ""}${plannedCapacityPressure ? ` Planned capacity pressure at ${capacityPlaceLabel}: ${expectedCount} scheduled participants, recorded capacity ${capacity}.` : ""}`;
    return {id:group.id,elementId:group.elementId,dimension:layer,count,label:`${dimensionLabel[layer]} · ${element.label}`,summary,...(expectedCount!==undefined ? {expectedCount} : {}),...(plannedCapacityPressure ? {plannedCapacityPressure} : {})};
  });
  return {markers,groups,unlocated};
}
