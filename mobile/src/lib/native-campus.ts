import type { CampusSceneDirectory, CampusScenePublished, SceneCampus } from '../../../packages/contracts/src/campus-scenes/contracts';
import type { CampusSceneDocument, CampusSceneElement } from '../../../packages/contracts/src/campus-scenes/types';
import { sceneBuildingFloorIds, sceneElementBuilding, sceneFloorBuilding, sceneInteriorView } from '../../../packages/contracts/src/campus-scenes/sceneInterior';
import { campusMapPresentationChanges, campusMapSearchPlaces } from '../../../packages/contracts/src/campus-scenes/sceneMapPresentation';
import { buildingExplorerMatches, sceneBuildingExplorer, type BuildingExplorerModel, type BuildingExplorerNode } from '../../../packages/contracts/src/campus-scenes/sceneBuildingExplorer';
import type { CampusMapAsset,CampusOperationalProjection } from '../../../packages/contracts/src/campus-operation';
import type { CampusPersonalResponse } from '../../../packages/contracts/src/campus-personal';
import { personalJourneyDestinations, personalJourneySignature } from '../../../packages/contracts/src/campus-scenes/personalJourney';
import { readCampusMapPresentation, type CampusMapPresentation } from '../../../packages/contracts/src/campus-scenes/sceneMapPresentation';
import { sceneWalkingPlaceIds } from '../../../packages/contracts/src/campus-scenes/sceneWalking';
import { boundCampusAssets } from '../../../packages/contracts/src/campus-operation-presentation';

type Place = CampusScenePublished['places'][number];
type Environment = { mode: 'live' | 'simulation'; namespace_id?: string | null; institution_id?: string | null;run_id?:string;unavailable_reason?:string; unavailable?: boolean };

/** Select only from the current authorized directory. An explicit miss never falls back. */
export function selectNativeCampus(directory: CampusSceneDirectory | undefined, requested?: string | null): SceneCampus | undefined {
  const campuses = directory?.campuses ?? [];
  const candidate = requested != null ? campuses.find(campus => campus.id === requested)
    : campuses.find(campus => campus.is_primary) ?? campuses[0];
  return candidate && campuses.filter(campus => campus.id === candidate.id).length === 1 ? candidate : undefined;
}

/** Projection reads are usable only in the exact server-selected campus/world. */
export function nativeCampusProjectionMatches(
  data: { school_id: string; campus_id: string; environment: { kind: string; namespace_id: string | null } } | undefined,
  schoolId: string, campusId: string, environment: Environment,
): boolean {
  if (!data || !data.environment || environment.unavailable || environment.institution_id && environment.institution_id !== schoolId
    || data.school_id !== schoolId || data.campus_id !== campusId || data.environment.kind !== environment.mode) return false;
  if (environment.mode === 'simulation') return Boolean(environment.namespace_id) && data.environment.namespace_id === environment.namespace_id;
  return data.environment.namespace_id === null || data.environment.namespace_id === `live:${schoolId}`
    || Boolean(environment.namespace_id) && data.environment.namespace_id === environment.namespace_id;
}

/** Null publication is a legitimate preparing state; a private draft is never substituted. */
export function nativeCampusPublicationMatches(data: CampusScenePublished | undefined, campusId: string): boolean {
  if (!data || data.campus.id !== campusId) return false;
  if (data.scene === null) return true;
  const { document, version } = data.scene;
  return Boolean(data.scene.id) && Number.isSafeInteger(version) && version > 0 && document.schema_version === 1
    && Number.isFinite(document.bounds.width) && document.bounds.width > 0
    && Number.isFinite(document.bounds.height) && document.bounds.height > 0
    && new Set(document.elements.map(element => element.id)).size === document.elements.length
    && document.elements.every(element => Boolean(element.id) && element.geometry.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
}

export interface NativeCampusSelection { selectedId: string | null; spaceId: string | null; buildingId: string | null; floorId: string | null }

/** The same canonical-place navigation as web; an unmapped room stays unmapped. */
export function nativeCampusPlaceSelection(scene: CampusSceneDocument, places: readonly Place[], spaceId: string): NativeCampusSelection | null {
  const place = places.find(item => item.id === spaceId);
  if (!place) return null;
  const reviewed = { ...scene, elements: scene.elements.filter(item => item.review_state === 'reviewed') };
  const owner = sceneFloorBuilding(reviewed, [...places], spaceId);
  const element = reviewed.elements.find(item => item.space_id === spaceId && (item.kind === 'room' || item.kind === 'building'));
  let buildingId: string | null = null, floorId: string | null = null;
  if (place.kind === 'floor' && owner && sceneBuildingFloorIds(reviewed, owner).includes(spaceId)) {
    buildingId = owner.id; floorId = spaceId;
  } else if (element?.floor_id) {
    const building = sceneElementBuilding(reviewed, [...places], element);
    if (building) { buildingId = building.id; floorId = element.floor_id; }
  }
  return { selectedId: element?.id ?? owner?.id ?? null, spaceId, buildingId, floorId };
}

export interface NativeCampusDisplay {
  document: CampusSceneDocument | null;
  selected: CampusSceneElement | null;
  building: CampusSceneElement | null;
  contextBuilding: CampusSceneElement | null;
  floorId: string | null;
  interior: ReturnType<typeof sceneInteriorView> | null;
  unavailable: boolean;
}

/** Reuse the web's interior crop without translating authored geometry or mixing buildings. */
export function nativeCampusDisplay(scene: CampusSceneDocument, places: readonly Place[], selection: Partial<NativeCampusSelection>): NativeCampusDisplay {
  const reviewed = { ...scene, elements: scene.elements.filter(item => item.review_state === 'reviewed') };
  const selected = reviewed.elements.find(item => item.id === selection.selectedId) ?? null;
  const requestedBuilding = reviewed.elements.find(item => item.id === selection.buildingId && item.kind === 'building') ?? null;
  const selectedPlace = places.find(item => item.id === selection.spaceId);
  const contextBuilding = requestedBuilding ?? sceneElementBuilding(reviewed, [...places], selected ?? undefined)
    ?? (selectedPlace ? sceneFloorBuilding(reviewed, [...places], selectedPlace.id) : undefined) ?? null;
  if (!selection.floorId) return { document: reviewed, selected, building: null, contextBuilding, floorId: null, interior: null, unavailable: Boolean(selection.buildingId && !requestedBuilding) };
  const floor = places.find(item => item.id === selection.floorId && item.kind === 'floor');
  const owner = floor ? sceneFloorBuilding(reviewed, [...places], floor.id) : undefined;
  if (!owner || selection.buildingId && owner.id !== requestedBuilding?.id || !sceneBuildingFloorIds(reviewed, owner).includes(selection.floorId)) {
    return { document: null, selected, building: null, contextBuilding, floorId: null, interior: null, unavailable: true };
  }
  const interior = sceneInteriorView(reviewed, owner, selection.floorId);
  return { document: interior.document, selected, building: owner, contextBuilding: owner, floorId: selection.floorId, interior, unavailable: false };
}

/** An explicit floor/Campus action supersedes older location intents. Saved
 * report origins retain their own asset intent until the person navigates. */
export function nativeCampusFloorNavigation(scene: CampusSceneDocument, places: readonly Place[], current: NativeCampusSelection, floorId: string | null,
  options: { panel: CampusMapPresentation['panel']; manualDirections: boolean }): { selection: NativeCampusSelection; changes: Record<string, string | null> } | null {
  const owner = floorId ? null : nativeCampusDisplay(scene, places, current).contextBuilding;
  const selection = floorId ? nativeCampusPlaceSelection(scene, places, floorId)
    : { selectedId: owner?.id ?? null, spaceId: owner?.space_id ?? null, buildingId: null, floorId: null };
  if (!selection || floorId && selection.floorId !== floorId) return null;
  return { selection, changes: { ...campusMapPresentationChanges({ ...selection, panel: options.panel }),
    map_floor: options.manualDirections ? floorId : null, campus_asset: null, campus_asset_context: null,
    campus_space: null, campus_focus: 'explore', panel: null } };
}

export interface NativeCampusPage<T> { rows: T[]; page: number; pages: number; total: number; hasMore: boolean }
export function nativeCampusPage<T>(items: readonly T[], requestedPage = 1): NativeCampusPage<T> {
  const pages = Math.max(1, Math.ceil(items.length / 8));
  const page = Math.max(1, Math.min(pages, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  return { rows: items.slice((page - 1) * 8, page * 8), page, pages, total: items.length, hasMore: page < pages };
}

/** Search published outlines once per canonical identity, including multipart buildings. */
export function nativeCampusPlacePage(scene: CampusSceneDocument, places: readonly Place[], search: string, page = 1): NativeCampusPage<CampusSceneElement> {
  const query = search.trim().slice(0, 200).toLocaleLowerCase();
  const canonicalPlaces = new Map(places.map(place => [place.id, place]));
  const matches = campusMapSearchPlaces(scene.elements.filter(element => element.review_state === 'reviewed')).filter(element => {
    const place = element.space_id ? canonicalPlaces.get(element.space_id) : undefined;
    return `${element.label} ${place?.name ?? ''} ${place?.code ?? ''} ${place?.kind ?? element.kind}`.toLocaleLowerCase().includes(query);
  });
  return nativeCampusPage(matches, page);
}

/** One level of the web's canonical hierarchy; search retains the actual ancestor path. */
export function nativeCampusBuildingPage({ building, scene, places, assets = [], search = '', page = 1, parentId = null }: {
  building: CampusSceneElement; scene: CampusSceneDocument; places: readonly Place[]; assets?: readonly CampusMapAsset[];
  search?: string; page?: number; parentId?: string | null;
}): NativeCampusPage<BuildingExplorerNode> & { model: BuildingExplorerModel } {
  const model = sceneBuildingExplorer({ building, scene, places, assets });
  const matches = buildingExplorerMatches(model, search.slice(0, 200));
  const items = parentId === null ? model.children : model.nodes.get(parentId)?.children ?? [];
  return { ...nativeCampusPage(matches ? items.filter(item => matches.has(item.id)) : items, page), model };
}

/** A simulated illustration uses only the server-confirmed instant, including while paused. */
export function nativeCampusSceneInstant(environment: { mode: 'live' | 'simulation'; unavailable?: boolean; virtual_clock?: { now: string } }, liveInstant: Date): Date | null {
  if (environment.mode === 'live') return Number.isFinite(liveInstant.getTime()) ? liveInstant : null;
  if (environment.unavailable || !environment.virtual_clock?.now) return null;
  const instant = new Date(environment.virtual_clock.now);
  return Number.isFinite(instant.getTime()) ? instant : null;
}

/** Match the current web presentation qualifier; it never selects a world. */
export function nativeCampusWorldIdentity(environment:Environment){return environment.mode==='live'?`live:${environment.namespace_id??environment.institution_id??'global'}`:environment.unavailable?`simulation-unavailable:${environment.namespace_id}:${environment.run_id}:${environment.unavailable_reason}`:`simulation:${environment.namespace_id}:${environment.run_id}`;}
export function nativeCampusMapContext(campusId:string,environment:Environment){return `${campusId}:${nativeCampusWorldIdentity(environment)}`;}
export function nativeCampusAssetContext(schoolId:string,actorId:string,campusId:string,environment:Environment,data:CampusScenePublished){return `${schoolId}:${actorId}:${campusId}:${nativeCampusWorldIdentity(environment)}:${data.scene?.id??'none'}:${data.scene?.version??0}`;}
export function nativeCampusJourneyMatches(data:CampusPersonalResponse|undefined,schoolId:string,campusId:string,environment:Environment):data is CampusPersonalResponse{return !!data&&data.schema_version===1&&nativeCampusProjectionMatches(data,schoolId,campusId,environment)&&[data.now,data.next,data.destinations,data.places,data.limitations].every(Array.isArray)&&[...data.now,...data.next,...data.destinations].every(row=>!!row&&typeof row.id==='string'&&typeof row.title==='string'&&!!row.source&&Number.isSafeInteger(row.source.revision)&&row.source.revision>=1&&typeof row.target_path==='string');}
export function nativeCampusLayersMatch(data:CampusOperationalProjection|undefined,schoolId:string,campusId:string,environment:Environment,publication:CampusScenePublished):data is CampusOperationalProjection{
  if(!data||data.schema_version!==1||!nativeCampusProjectionMatches(data,schoolId,campusId,environment)
    ||data.publication?.id!==publication.scene?.id||data.publication?.version!==publication.scene?.version
    ||![data.assets,data.activities,data.limitations].every(Array.isArray))return false;
  const id=(value:unknown):value is string=>typeof value==='string'&&!!value.trim();
  if(!data.assets.every(row=>!!row&&id(row.element_id)&&id(row.holding_id)&&typeof row.name==='string'
    &&(row.asset_tag===null||typeof row.asset_tag==='string')&&(row.space_id===null||id(row.space_id))&&typeof row.reportable==='boolean'
    &&['available','unavailable','retired','unknown'].includes(row.native_state)&&!!row.signal
    &&['unknown','reported_fault','awaiting_verification','verified_resolution'].includes(row.signal.state)
    &&[null,'not_working','degraded'].includes(row.signal.impact)&&Number.isSafeInteger(row.signal.open_reports)&&row.signal.open_reports>=0
    &&(row.signal.updated_at===null||typeof row.signal.updated_at==='string'&&Number.isFinite(Date.parse(row.signal.updated_at)))
    &&Array.isArray(row.repairs)&&row.repairs.every(repair=>!!repair&&id(repair.id)&&Number.isSafeInteger(repair.revision)&&repair.revision>=1
      &&['reported','accepted','in_progress','waiting','awaiting_verification','closed'].includes(repair.state)
      &&typeof repair.target_path==='string'&&typeof repair.action_label==='string')
    &&new Set(row.repairs.map(repair=>repair.id)).size===row.repairs.length))return false;
  // A graphic and an individual holding each have exactly one shared condition.
  // An ambiguous response withdraws the whole layer before details or graphics.
  if(new Set(data.assets.map(row=>row.element_id)).size!==data.assets.length||new Set(data.assets.map(row=>row.holding_id)).size!==data.assets.length)return false;
  return data.limitations.every(row=>typeof row==='string')&&data.activities.every(row=>!!row&&typeof row.id==='string'&&['classes','events','maintenance'].includes(row.layer)&&['expected','accepted'].includes(row.dimension)&&typeof row.target_path==='string');
}
export const nativeCampusPresentationKeys=['map_context','map_panel','map_full','map_mode','map_place','map_space','map_search','map_page','map_inside','map_view_floor','map_to','map_from','map_step_free','map_floor','campus_space','campus_view','campus_focus','campus_layer','campus_asset','campus_asset_context','journey','directions','walk_from','walk_context','step_free','place_id','place'] as const;
export interface NativeCampusUrlView {selection:NativeCampusSelection;presentation:CampusMapPresentation;privatePanel:'spaces'|'timetable'|'activity'|'kpis'|null;layer:'none'|'classes'|'events'|'maintenance';assetId:string|null;journey:ReturnType<typeof personalJourneyDestinations>[number]|undefined;journeyStale:boolean;personalDirections:boolean;personalOrigin:string;personalAccessible:boolean;manualDirections:{destination:string;origin:string;accessible:boolean;floorId:string|null}|null;error:string;signature:string}
/** Resolve links only against current authorized records. Actor/world/publication
 * qualifiers protect saved presentation, not domain authority. Asset intent is last. */
export function nativeCampusUrlView(params:URLSearchParams,input:{schoolId:string;actorId:string;environment:Environment;data:CampusScenePublished;personal?:CampusPersonalResponse;operations?:CampusOperationalProjection}):NativeCampusUrlView{
  const personal=nativeCampusJourneyMatches(input.personal,input.schoolId,input.data.campus.id,input.environment)?input.personal:undefined;
  const data={...input.data,scene:input.data.scene?{...input.data.scene,document:{...input.data.scene.document,elements:input.data.scene.document.elements.filter(row=>row.review_state==='reviewed')}}:null},scene=data.scene?.document;
  const context=nativeCampusMapContext(data.campus.id,input.environment),scoped=params.get('map_context')===context,presentation={...readCampusMapPresentation(params,context,data)},hasPanel=scoped&&params.has('map_panel');
  const duplicate=[...nativeCampusPresentationKeys,'campus_id','panel','edit'].some(key=>params.getAll(key).length>1),items=personal?personalJourneyDestinations(personal):[],journey=items.find(item=>item.id===params.get('journey'))??items[0],journeyStale=!!params.get('walk_context')&&(!journey||params.get('walk_context')!==personalJourneySignature(journey)||params.get('journey')!==journey.id);
  let selection:NativeCampusSelection={selectedId:presentation.selectedId,spaceId:presentation.spaceId,buildingId:presentation.buildingId,floorId:presentation.floorId},error=duplicate?'This campus link contains conflicting selections. Open the current campus view again.':'';
  // Canonical links supply an initial destination. A later explicit scoped map
  // selection takes over without deleting the link identity and triggering Back.
  const explicitExplore=scoped&&params.get('campus_focus')==='explore'&&hasPanel;
  const alias=params.get('place_id')??params.get('place');if(scene&&alias&&!explicitExplore){const next=nativeCampusPlaceSelection(scene,data.places,alias);if(next){selection=next;if(!hasPanel)presentation.panel='place';}else error='The requested canonical place is unavailable in this published campus.';}
  const rawPanel=params.get('panel'),privatePanel=rawPanel==='spaces'||rawPanel==='timetable'||rawPanel==='activity'||rawPanel==='kpis'?rawPanel:null;
  if(privatePanel)presentation.panel='operations';
  const requested=params.get('campus_space'),intent=params.get('campus_focus');
  if(scene&&requested&&privatePanel){const next=nativeCampusPlaceSelection(scene,data.places,requested);if(next)selection=next;else error='The requested canonical place is unavailable in this published campus.';}
  else if(scene&&requested&&personal){const memberPlace=personal.places.some(place=>place.id===requested),next=memberPlace?nativeCampusPlaceSelection(scene,data.places,requested):null;
    if(journeyStale&&intent!=='explore'){selection={selectedId:null,spaceId:null,buildingId:null,floorId:null};error='Your activity or its assigned place changed. Choose a starting place again before using directions.';}
    else if(next){if(!(scoped&&presentation.buildingId&&presentation.floorId)){selection=next;if(params.get('campus_view')==='outside')selection={...selection,buildingId:null,floorId:null};}if(!hasPanel)presentation.panel=intent==='journey'?'day':'place';}
    else error='This canonical place is not available in your current campus activities.';
  }
  if(!hasPanel&&params.has('journey'))presentation.panel='day';
  const endpointIds=scene?sceneWalkingPlaceIds(scene):[],to=scoped?data.places.find(place=>place.id===params.get('map_to')):undefined,from=scoped&&endpointIds.includes(params.get('map_from')??'')?params.get('map_from')!:'',routeFloor=scoped?data.places.find(place=>place.kind==='floor'&&place.id===params.get('map_floor')):undefined;
  if(to&&scene&&routeFloor){const owner=sceneFloorBuilding(scene,data.places,routeFloor.id);if(owner)selection={...selection,buildingId:owner.id,floorId:routeFloor.id};}
  const assets=boundCampusAssets(scene??null,nativeCampusLayersMatch(input.operations,input.schoolId,data.campus.id,input.environment,data)?input.operations.assets:[]),assetId=params.get('campus_asset_context')===nativeCampusAssetContext(input.schoolId,input.actorId,data.campus.id,input.environment,data)?assets.find(asset=>asset.element_id===params.get('campus_asset'))?.element_id??null:null;
  if(assetId&&scene){const element=scene.elements.find(row=>row.id===assetId)!,owner=sceneElementBuilding(scene,data.places,element);selection={selectedId:element.id,spaceId:element.space_id??assets.find(row=>row.element_id===element.id)?.space_id??null,buildingId:element.floor_id?owner?.id??null:null,floorId:element.floor_id&&owner?element.floor_id:null};presentation.panel='place';}
  if(duplicate){selection={selectedId:null,spaceId:null,buildingId:null,floorId:null};presentation.panel=null;}
  const personalDirections=!duplicate&&!(scoped&&params.has('map_to'))&&params.get('directions')==='1'&&!!journey,personalOrigin=!journeyStale&&endpointIds.includes(params.get('walk_from')??'')?params.get('walk_from')!:'',layer=params.get('campus_layer');
  return{selection,presentation,privatePanel,layer:layer==='classes'||layer==='events'||layer==='maintenance'?layer:'none',assetId,journey,journeyStale,personalDirections,personalOrigin,personalAccessible:params.get('step_free')==='1',manualDirections:!duplicate&&to?{destination:to.id,origin:from,accessible:params.get('map_step_free')==='1',floorId:routeFloor?.id??null}:null,error,signature:JSON.stringify([data.scene?.id,data.scene?.version,[...nativeCampusPresentationKeys,'panel'].map(key=>params.getAll(key)),journey?.id,journey&&personalJourneySignature(journey),assetId])};
}

/** An explicit personal selection supersedes a previously restored map interior. */
export function nativeCampusJourneyChanges(item:ReturnType<typeof personalJourneyDestinations>[number],directions=false):Record<string,string|null>{return {map_place:null,map_space:null,map_inside:null,map_view_floor:null,map_to:null,map_from:null,map_floor:null,map_step_free:null,directions:directions?'1':null,walk_from:null,walk_context:personalJourneySignature(item),journey:item.id,campus_space:item.space_id,campus_view:directions?'outside':'place',campus_focus:'journey',campus_asset:null,campus_asset_context:null,map_panel:'day',panel:null};}
/** Presentation only; it cannot choose actor, campus, publication, or world. */
export function nativeCampusPresentationQuery(params:URLSearchParams):string{const saved=new URLSearchParams();for(const name of [...nativeCampusPresentationKeys,'panel']){const value=params.get(name);if(name!=='map_full'&&value!==null)saved.set(name,value);}return saved.toString();}
export function nativeCampusFullscreenReturnMatches(record:{sourceKey:string|null;sourceQuery:string},entryKey:string,params:URLSearchParams):boolean{return record.sourceKey===entryKey&&record.sourceQuery===nativeCampusPresentationQuery(params);}

/** Both current mounted owners retain their own navigator and ordinary query state. */
export function nativeCampusRoutePath(href:string):'/areas/campus-view'|'/more/virtual-campus'{return /^\/areas\/campus-view(?:[/?#]|$)/.test(href)?'/areas/campus-view':'/more/virtual-campus';}
