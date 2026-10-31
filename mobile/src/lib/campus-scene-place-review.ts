import type { CampusSpace } from '../../../packages/contracts/src/institution';
import type { ReviewedScenePlaceRow } from '../../../packages/contracts/src/campus-scenes/contracts';
import type { CampusSceneDocument } from '../../../packages/contracts/src/campus-scenes/types';
import { floorPlanReviewedRows, type SceneFloorPlanContext } from '../../../packages/contracts/src/campus-scenes/sceneFloorPlans';
import { reviewedScenePlaceDocument, reviewedScenePlaceRows, type ScenePlaceProposal } from '../../../packages/contracts/src/campus-scenes/scenePlaceProposals';

export interface CampusScenePlaceReview { document: CampusSceneDocument;rows: ReviewedScenePlaceRow[];expected_revision: number }
/** Ancestry is explicit and cycle bounded. Nearby geometry is never a parent. */
export function nativeScenePlaceDescends(space: Pick<CampusSpace,'id'|'parent_space_id'>, parentId: string, spaces: readonly CampusSpace[]) {
  const seen=new Set([space.id]);let parent=space.parent_space_id;
  while(parent&&!seen.has(parent)){if(parent===parentId)return true;seen.add(parent);parent=spaces.find(row=>row.id===parent)?.parent_space_id??null;}return false;
}
const currentPlace=(before:CampusSpace,after:CampusSpace|undefined,schoolId:string,campusId:string)=>!!after&&before.school_id===schoolId&&after.school_id===schoolId&&before.campus_id===campusId&&after.campus_id===campusId&&before.status==='active'&&after.status==='active'&&Number.isSafeInteger(before.revision)&&before.revision>0&&after.revision===before.revision&&after.kind===before.kind&&after.parent_space_id===before.parent_space_id&&after.name===before.name&&after.code===before.code;
/** Build the same reviewed rows as the mounted editor, then recheck only exact
 * reused/parent places against the current catalogue before handing off a command. */
export function nativeCampusScenePlaceReview(input:{schoolId:string;campusId:string;document:CampusSceneDocument;revision:number;catalogue:readonly CampusSpace[];currentSpaces:readonly CampusSpace[];proposals:readonly ScenePlaceProposal[];splitElementIds?:ReadonlySet<string>;floorPlan?:SceneFloorPlanContext|null}) {
  const spaces=input.catalogue.filter(row=>row.campus_id===input.campusId),current=input.currentSpaces.filter(row=>row.campus_id===input.campusId),errors:string[]=[];
  if(!input.schoolId||!input.campusId||!Number.isSafeInteger(input.revision)||input.revision<0||new Set(spaces.map(row=>row.id)).size!==spaces.length||new Set(current.map(row=>row.id)).size!==current.length||spaces.some(row=>row.school_id!==input.schoolId)||current.some(row=>row.school_id!==input.schoolId))errors.push('Confirm the current institution and campus places before continuing.');
  const proposalIds=new Set(input.proposals.map(row=>row.id)),outlineIds=input.proposals.flatMap(row=>row.elementIds);
  if(proposalIds.size!==input.proposals.length||new Set(outlineIds).size!==outlineIds.length||input.proposals.some(row=>!row.id||!row.elementIds.length||row.elementIds.some(id=>!input.document.elements.some(element=>element.id===id&&!element.space_id)||input.floorPlan&&!input.floorPlan.elementIds.includes(id))||row.mergedInto&&(row.mergedInto===row.id||!input.proposals.some(parent=>parent.id===row.mergedInto&&!parent.mergedInto))))errors.push('The proposal groups no longer match these unlinked outlines. Reopen the current drawing review.');
  const result=reviewedScenePlaceRows(input.document,input.proposals,spaces);errors.push(...result.errors);
  let rows=result.rows;
  if(input.floorPlan){const floor=input.floorPlan,building=spaces.find(row=>row.id===floor.buildingId),selected=floor.floorId?spaces.find(row=>row.id===floor.floorId):null;
    if(!building||!currentPlace(building,current.find(row=>row.id===building.id),input.schoolId,input.campusId)||!input.document.elements.some(row=>row.id===floor.buildingElementId&&row.kind==='building'&&row.space_id===floor.buildingId))errors.push('The reviewed building changed or is no longer available. Reopen floor-plan review after refreshing campus places.');
    if(floor.floorId&&(!selected||selected.kind!=='floor'||!nativeScenePlaceDescends(selected,floor.buildingId,spaces)))errors.push('Choose a current floor belonging to this exact building.');
    if(new Set(floor.elementIds).size!==floor.elementIds.length||floor.elementIds.some(id=>!input.document.elements.some(row=>row.id===id)))errors.push('The floor-plan outlines changed. Review the current plan before continuing.');
    for(const row of rows)if(row.action==='reuse'){const place=spaces.find(place=>place.id===row.space_id);if(!place||!floor.floorId||!nativeScenePlaceDescends(place,floor.floorId,spaces))errors.push('Reuse only a place inside this reviewed floor.');}
    const scoped=floorPlanReviewedRows(floor,rows,spaces);rows=scoped.rows;errors.push(...scoped.errors);
  }
  for(const row of rows){const id=row.action==='reuse'?row.space_id:row.parent_space_id;if(id){const before=spaces.find(place=>place.id===id);if(!before||!currentPlace(before,current.find(place=>place.id===id),input.schoolId,input.campusId))errors.push('A selected existing place or parent changed. Your review choices are retained; refresh and reopen this review before saving.');}
    if(row.action==='create'&&current.some(place=>place.code.toUpperCase()===row.code.toUpperCase()))errors.push(`The place code ${row.code} is now in use. Reuse the exact place or choose another code.`);
  }
  const selectedElements=rows.flatMap(row=>row.element_ids);if(new Set(selectedElements).size!==selectedElements.length)errors.push('Each outline can connect to only one campus place in this review.');
  const document=reviewedScenePlaceDocument(input.document,input.proposals,input.splitElementIds);
  return{review:{document,rows,expected_revision:input.revision} satisfies CampusScenePlaceReview,errors:[...new Set(errors)],repeatedNames:result.repeatedNames};
}
