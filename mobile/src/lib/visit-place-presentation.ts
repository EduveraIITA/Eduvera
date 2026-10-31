import type { VisitOptions, VisitPlace } from '../../../packages/contracts/src/wire/features/gate/visitApi';
import type { CampusScenePublished } from '../../../packages/contracts/src/campus-scenes/contracts';
export type PlaceCategory = 'all' | 'campuses' | 'buildings' | 'rooms' | 'outdoors' | 'other';
export const placeCategories = [{ value: 'all', label: 'All places' }, { value: 'campuses', label: 'Campuses' }, { value: 'buildings', label: 'Buildings' }, { value: 'rooms', label: 'Rooms & floors' }, { value: 'outdoors', label: 'Outdoors' }, { value: 'other', label: 'Other' }] as const;
export function placeCategory(kind: string): PlaceCategory {
  if (kind==='campus') return 'campuses';
  if (['building','hostel','library','auditorium'].includes(kind)) return 'buildings';
  if (['floor','wing','classroom','laboratory','office','workshop','staff_room','residential_room'].includes(kind)) return 'rooms';
  if (['outdoor_area','sports_area','gate'].includes(kind)) return 'outdoors';
  return 'other';
}
/** The current owner pages 25 choices. A partial page is never a category total. */
export async function loadVisitPlaceCatalogue(read: (page: number) => Promise<VisitOptions>): Promise<VisitPlace[]> {
  const places = new Map<string,VisitPlace>();
  for (let page = 1; ; page++) {
    const data = await read(page);
    if (!Array.isArray(data.places) || typeof data.pagination?.places_has_more !== 'boolean') throw new Error('The current place catalogue could not be verified.');
    let added = 0;
    for (const place of data.places) {
      if (!place.id || !place.label?.trim() || !place.kind) throw new Error('A current place choice could not be verified.');
      if (!places.has(place.id)) added++;
      places.set(place.id,place);
    }
    if (!data.pagination.places_has_more) return [...places.values()].sort((a,b) => a.label.localeCompare(b.label));
    if (!added) throw new Error('The place catalogue changed while loading. Refresh its current choices.');
  }
}
export interface VisitPlaceContext { category:PlaceCategory; detail:string; footprint:string[] }
export function visitPlaceContexts(publications:readonly CampusScenePublished[]) {
  const result=new Map<string,VisitPlaceContext>();
  for(const publication of publications)for(const place of publication.places){
    const scene=publication.scene?.document,element=scene?.elements.find(row=>row.review_state==='reviewed'&&row.space_id===place.id&&(row.kind==='building'||row.kind==='room'));
    const ancestry:string[]=[],seen=new Set([place.id]);let parent=place.parent_space_id;
    while(parent&&!seen.has(parent)){seen.add(parent);const row=publication.places.find(value=>value.id===parent);if(!row)break;ancestry.unshift(row.name);parent=row.parent_space_id;}
    result.set(place.id,{category:element?.kind==='building'?'buildings':element?.kind==='room'?'rooms':placeCategory(place.kind),detail:[publication.campus.name,...ancestry,place.kind.replaceAll('_',' ')].join(' · '),footprint:visitPlaceFootprint(place.id,publication.places)});
  }
  for(const publication of publications)result.set(publication.campus.id,{category:'campuses',detail:`${publication.campus.name} · entire campus · mapped places`,footprint:[publication.campus.id,...publication.places.map(place=>place.id)]});
  return result;
}
export function filterVisitPlaces(places: readonly VisitPlace[], category: PlaceCategory, search: string, contexts:ReadonlyMap<string,VisitPlaceContext>=new Map()) {
  const query = search.trim().toLocaleLowerCase();
  return places.filter(place => (category === 'all' || (contexts.get(place.id)?.category??placeCategory(place.kind)) === category) && `${place.label} ${place.kind.replaceAll('_',' ')} ${place.campus_label ?? ''} ${contexts.get(place.id)?.detail??''}`.toLocaleLowerCase().includes(query));
}

export interface VisitTimeWindow { startsAt: string; endsAt: string; timezone: string }
export interface VisitScheduleItem { id: string; space_id: string | null; starts_at: string; ends_at: string; state: string }
export interface VisitSchedulePage { items: VisitScheduleItem[]; page: number; total_pages: number; can_manage: boolean }
export async function loadVisitSchedule(read:(page:number)=>Promise<VisitSchedulePage>) {
  const items:VisitScheduleItem[]=[],seen=new Set<string>();let complete=true,total:number|undefined;
  for(let page=1;;page++){
    const data=await read(page);
    if(!Array.isArray(data.items)||!Number.isSafeInteger(data.total_pages)||data.total_pages<0||data.page!==page||typeof data.can_manage!=='boolean'||total!==undefined&&total!==data.total_pages)throw new Error('The published schedule could not be verified.');
    total=data.total_pages;complete&&=data.can_manage;
    for(const row of data.items){
      if(typeof row.id!=='string'||!row.id||seen.has(row.id)||!(row.space_id===null||typeof row.space_id==='string')||!['expected','cancelled'].includes(row.state)||!Number.isFinite(Date.parse(row.starts_at))||!Number.isFinite(Date.parse(row.ends_at))||Date.parse(row.ends_at)<=Date.parse(row.starts_at))throw new Error('A published schedule entry could not be verified.');
      seen.add(row.id);items.push(row);
    }
    if(page>=total)return{items,complete};
    if(!data.items.length)throw new Error('The schedule changed while loading.');
  }
}
/** Whole-building/floor checks include mapped descendants, without inventing occupancy. */
export function visitPlaceFootprint(id:string,places:readonly {id:string;parent_space_id:string|null}[]) {
  const result=new Set([id]);let changed=true;
  while(changed){changed=false;for(const place of places)if(place.parent_space_id&&result.has(place.parent_space_id)&&!result.has(place.id)){result.add(place.id);changed=true;}}
  return [...result];
}
export function visitWindowLabel(window:VisitTimeWindow) {
  try{const format=new Intl.DateTimeFormat('en-GB',{timeZone:window.timezone,dateStyle:'medium',timeStyle:'short'});return `${format.format(new Date(window.startsAt))} – ${format.format(new Date(window.endsAt))} · ${window.timezone}`;}catch{return 'Visit time unavailable';}
}
export function visitScheduleRange(window?: VisitTimeWindow) {
  if (!window || !window.timezone || !Number.isFinite(Date.parse(window.startsAt)) || !Number.isFinite(Date.parse(window.endsAt)) || Date.parse(window.endsAt) <= Date.parse(window.startsAt)) return null;
  try {
    const day = (value: string) => { const parts = new Intl.DateTimeFormat('en-GB',{timeZone:window.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)); return ['year','month','day'].map(type=>parts.find(part=>part.type===type)!.value).join('-'); };
    const from = day(window.startsAt), until = day(window.endsAt);
    return (Date.parse(until)-Date.parse(from))/86400000 <= 34 ? { from,until } : null;
  } catch { return null; }
}
export function visitPlaceSchedule(places: readonly string[], rows: readonly VisitScheduleItem[] | undefined, window?: VisitTimeWindow, complete = false) {
  if (!window || !visitScheduleRange(window) || !rows) return { label:'Availability not confirmed',tone:'muted' as const };
  const conflicts = rows.filter(row=>row.state==='expected' && !!row.space_id && places.includes(row.space_id) && Date.parse(row.starts_at)<Date.parse(window.endsAt) && Date.parse(row.ends_at)>Date.parse(window.startsAt));
  if (conflicts.length) return { label:`${conflicts.length} scheduled ${conflicts.length===1?'conflict':'conflicts'}`,tone:'warning' as const };
  return { label:complete?'No scheduled conflict':'Availability not confirmed',tone:complete?'positive' as const:'muted' as const };
}

/** Published timetable conflicts tint their exact mapped place and containing buildings. */
export function visitScheduleHighlights(publication: CampusScenePublished, rows: readonly VisitScheduleItem[] | undefined, window?: VisitTimeWindow) {
  return (publication.scene?.document.elements ?? []).flatMap(element => {
    if (element.review_state !== 'reviewed' || !element.space_id || !['building','room'].includes(element.kind)) return [];
    const status = visitPlaceSchedule(visitPlaceFootprint(element.space_id, publication.places), rows, window);
    return status.tone === 'warning' ? [{ elementId: element.id, tone: 'warning' as const }] : [];
  });
}
