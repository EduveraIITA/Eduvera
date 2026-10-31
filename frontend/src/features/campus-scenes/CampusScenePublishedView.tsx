import { useMemo, useState, type ReactNode } from "react";
import { useInRouterContext } from "react-router-dom";
import { ArrowLeft, Layers } from "lucide-react";
import { CampusSceneCanvas } from "./CampusSceneCanvas";
import { useCampusMapNavigation, type MapPresentation, type PlaceDirections, type WayfindingState } from "./useCampusMapNavigation";
import { CampusMapWorkspace } from "./CampusMapWorkspace";
import { CampusMapSearch } from "./CampusMapSearch";
import { scenePlaceFocus } from "./scenePlaceCamera";
import { CampusMapPlace } from "./CampusMapPlace";
import { CampusBuildingExplorer } from './CampusBuildingExplorer';
import { CampusRoomInventory } from './CampusRoomInventory';
import { CampusAssetStatus } from '../campus-view/CampusAssetStatus';
import { campusMapSearchPlaces, initialCampusMapPresentation, type CampusMapPresentation } from "./sceneMapPresentation";
import { useSceneLighting } from "./useSceneLighting";
import { CampusLifeControls, useScenePeople } from "./useScenePeople";
import type { CampusScenePublished } from "./api";
import type { CampusOperationalBridge } from "../campus-view/campusOperational.types";
import { sceneBuildingFloorIds, sceneElementBuilding, sceneFloorBuilding, sceneInteriorView } from "./sceneInterior";
import { findSceneWalkingRoute, sceneWalkingPlaceIds } from "./sceneWalking";
import { CampusSceneDirections } from "./CampusSceneDirections";
import { SceneRouteSteps } from "./SceneRouteSteps";
import "./campus-scene-directions.css";
import "./campus-map-workspace.css";
import type { CampusSceneOperationsBridge } from "./sceneOperations.types";
import type { CampusPersonalBridge } from "../campus-view/personalJourney.types";

interface ScenePublishedProps { schoolId?: string; data: CampusScenePublished; operations?: CampusSceneOperationsBridge; personal?: CampusPersonalBridge; campusLayers?: CampusOperationalBridge; expandedContext?: ReactNode; onExpandedChange?: (expanded: boolean) => void }
export function CampusScenePublishedView(props: ScenePublishedProps) {
  const original = props.data, canonicalPlaces = props.operations?.places, placesState = props.operations?.placesState;
  const data = useMemo(() => {
    const places = new Map(original.places.map(place => [place.id,place]));
    if(placesState === 'available') for(const place of canonicalPlaces ?? []) {
      if(place.campus_id === original.campus.id) places.set(place.id,place);
    }
    return {...original,places:[...places.values()]};
  },[original,canonicalPlaces,placesState]);
  return useInRouterContext() ? <UrlCampusScenePublishedView {...props} data={data} /> : <CampusScenePublishedContent {...props} data={data} />;
}
function UrlCampusScenePublishedView(props: ScenePublishedProps) {
  const { context, wayfinding, presentation } = useCampusMapNavigation(props.data);
  return <CampusScenePublishedContent key={context} {...props} wayfinding={wayfinding} presentation={presentation} />;
}
function CampusScenePublishedContent({ schoolId = "", data, operations, personal, campusLayers, wayfinding, presentation, expandedContext, onExpandedChange }: ScenePublishedProps & { wayfinding?: WayfindingState; presentation?: MapPresentation }) {
  const lighting = useSceneLighting(data.campus.timezone);
  const life = useScenePeople(data.scene?.document ?? null, data.places, schoolId, data.campus.id, `${data.scene?.id ?? ""}:${data.scene?.version ?? ""}`, operations?.motion ?? personal?.motion, { routingAvailable: !campusLayers?.layoutChanged, excludedConnectorIds: campusLayers?.blockedConnectorIds });
  const [localView, setLocalView] = useState(initialCampusMapPresentation);
  const view = presentation?.value ?? localView;
  const updateView = (changes: Partial<CampusMapPresentation>) => presentation ? presentation.change(changes) : setLocalView(value => ({ ...value, ...changes }));
  const { mode, search, page } = view;
  const [selectedId, setSelectedId] = useState(view.selectedId);
  const [selectedSpaceId,setSelectedSpaceId] = useState(view.spaceId);
  const [focusedId, setFocusedId] = useState(view.selectedId);
  if (selectedId && focusedId !== selectedId) setFocusedId(selectedId);
  const selectionKey = `${view.selectedId}:${view.spaceId}`;
  const [previousSelected, setPreviousSelected] = useState(selectionKey);
  if (selectionKey !== previousSelected) { setPreviousSelected(selectionKey); setSelectedId(view.selectedId); setSelectedSpaceId(view.spaceId); }
  const [panelOverride, setPanelOverride] = useState<typeof view.panel | undefined>(undefined);
  const panel = panelOverride === undefined ? view.panel : panelOverride;
  const setPanel = (value: typeof view.panel) => setPanelOverride(value);
  const [inside, setInside] = useState<string | null>(view.buildingId), [floorId, setFloorId] = useState<string | null>(view.floorId);
  const [previousInterior, setPreviousInterior] = useState(`${view.buildingId}:${view.floorId}`);
  if (`${view.buildingId}:${view.floorId}` !== previousInterior) { setPreviousInterior(`${view.buildingId}:${view.floorId}`); setInside(view.buildingId); setFloorId(view.floorId); }
  const [localDirections, setLocalDirections] = useState<PlaceDirections | null>(null);
  const directions = wayfinding ? wayfinding.directions : localDirections;
  const setDirections = wayfinding?.change ?? setLocalDirections;
  const [lastExternalSpace, setLastExternalSpace] = useState<string | null | undefined>(undefined);
  const [lastPersonalSelection, setLastPersonalSelection] = useState<string | null>(null);
  const [lastWayfindingFloor, setLastWayfindingFloor] = useState<string | undefined>(undefined);
  const [lastAsset, setLastAsset] = useState<string | null>(null);
  const [routeViewError, setRouteViewError] = useState<string | null>(null);
  const externalSpaceId = operations?.selectedSpaceId;
  // A source-panel selection changes the local view once. Operational refreshes
  // with the same canonical place retain the person's current floor and camera.
  if (!presentation?.restoring && externalSpaceId !== undefined && lastExternalSpace !== externalSpaceId) {
    setLastExternalSpace(externalSpaceId);
    const element = externalSpaceId ? data.scene?.document.elements.find(item => item.space_id === externalSpaceId) : undefined;
    const changed = externalSpaceId !== selectedSpaceId && (externalSpaceId || lastExternalSpace !== undefined || !view.selectedId);
    if (changed) { setSelectedId(element?.id ?? null); setSelectedSpaceId(externalSpaceId ?? null); }
    if (changed && element && (lastExternalSpace !== undefined || !presentation?.hasPanel)) setPanel("place");
    if (changed && element?.kind === "room" && element.floor_id && element.parent_element_id && data.places.some(place => place.id === element.floor_id)) {
      setInside(element.parent_element_id); setFloorId(element.floor_id);
    } else if (changed && element) { setInside(null); setFloorId(null); }
  }
  const personalSelectionKey = personal?.selection ? JSON.stringify(personal.selection) : null;
  if (!presentation?.restoring && personalSelectionKey !== lastPersonalSelection) {
    setLastPersonalSelection(personalSelectionKey);
    const selection = personal?.selection;
    if (selection) {
      const element = data.scene?.document.elements.find(item => item.space_id === selection.spaceId);
      const restoredInterior = selection.token === 0 && Boolean(view.buildingId && view.floorId);
      if (!restoredInterior) { setSelectedId(element?.id ?? null); setSelectedSpaceId(selection.spaceId); }
      if (selection.token === 0 && presentation?.hasPanel) setPanel(view.panel);
      else if (element) setPanel(selection.intent === "journey" ? "day" : selection.intent === "explore" ? "place" : view.panel === "day" ? "day" : "place");
      if (restoredInterior) { /* The scoped floor is already restored above. */ }
      else if (selection.view === "place" && element?.kind === "room" && element.floor_id && element.parent_element_id && data.places.some(place => place.id === element.floor_id)) {
        setInside(element.parent_element_id); setFloorId(element.floor_id);
      } else if (selection.view === "place" && selection.spaceId && data.places.some(place => place.id === selection.spaceId && place.kind === "floor") && data.scene) {
        const parent = sceneFloorBuilding(data.scene.document, data.places, selection.spaceId);
        setInside(parent?.id ?? null); setFloorId(parent ? selection.spaceId : null);
      } else { setInside(null); setFloorId(null); }
    }
  }
  const wayfindingView = wayfinding?.directions ? `${wayfinding.directions.destination}:${wayfinding.floor ?? "outside"}` : undefined;
  if (wayfindingView !== lastWayfindingFloor) {
    setLastWayfindingFloor(wayfindingView);
    if (wayfinding?.directions && data.scene) {
      const parent = wayfinding.floor ? sceneFloorBuilding(data.scene.document, data.places, wayfinding.floor) : undefined;
      setInside(parent?.id ?? null); setFloorId(parent ? wayfinding.floor : null);
    }
  }
  const assetId = campusLayers?.selectedAssetElementId ?? null;
  if (!presentation?.restoring && assetId !== lastAsset) {
    setLastAsset(assetId);
    const asset = assetId ? data.scene?.document.elements.find(item => item.id === assetId && item.holding_id) : undefined;
    if (asset) {
      setSelectedId(asset.id); setPanel("place");
      setSelectedSpaceId(asset.space_id ?? campusLayers?.assets?.find(item=>item.element_id===asset.id)?.space_id ?? null);
      const parent = asset.floor_id && data.scene ? sceneFloorBuilding(data.scene.document, data.places, asset.floor_id) : undefined;
      setInside(parent?.id ?? null); setFloorId(parent ? asset.floor_id : null);
    }
  }
  if (!data.scene) return null;
  const scene = data.scene.document;
  const selected = scene.elements.find(item => item.id === selectedId);
  const building = scene.elements.find(item => item.id === inside && item.kind === "building");
  const floorIds = building || selected?.kind === "building" ? sceneBuildingFloorIds(scene, (building ?? selected)!) : [];
  const floors = floorIds.map(id => data.places.find(place => place.id === id)).filter((floor): floor is NonNullable<typeof floor> => Boolean(floor));
  const selectedPlace = data.places.find(place => place.id === (selectedSpaceId ?? selected?.space_id));
  const contextBuilding = building ?? sceneElementBuilding(scene,data.places,selected) ?? (selectedPlace ? sceneFloorBuilding(scene,data.places,selectedPlace.id) : undefined);
  const selectedAsset = selected?.holding_id ? campusLayers?.assets?.find(asset => asset.element_id===selected.id && asset.holding_id===selected.holding_id) : undefined;
  const interior = building && floorId ? sceneInteriorView(scene, building, floorId) : null;
  const visibleScene = interior?.document ?? scene;
  const places = campusMapSearchPlaces(scene.elements);
  const choosePanel = (value: typeof view.panel) => { setPanelOverride(undefined); updateView({ panel: value }); };
  const select = (id: string | null) => {
    const element = scene.elements.find(item => item.id === id), spaceId = element?.space_id ?? campusLayers?.assets?.find(asset=>asset.element_id===id)?.space_id ?? null;
    // A new destination must not retain a route to a previously selected building.
    if (directions && spaceId && directions.destination !== spaceId) setDirections(null);
    setSelectedId(id); setSelectedSpaceId(spaceId); setPanelOverride(undefined); updateView({ selectedId: id, spaceId, panel: id ? "place" : null });
    setLastExternalSpace(externalSpaceId); operations?.onSelectPlace(spaceId);
    if (element?.holding_id && campusLayers) campusLayers.onSelectAsset?.(element.id);
    else if (personal) personal.onSelectPlace(spaceId);
    else campusLayers?.onSelectAsset?.(null);
  };
  const openPlace = (spaceId:string) => {
    const place=data.places.find(item=>item.id===spaceId); if(!place) return;
    const parent=sceneFloorBuilding(scene,data.places,spaceId);
    const element=scene.elements.find(item=>item.space_id===spaceId && (item.kind==='room'||item.kind==='building'));
    let nextBuilding:string|null=null,nextFloor:string|null=null;
    if(place.kind==='floor' && parent && sceneBuildingFloorIds(scene,parent).includes(spaceId)) { nextBuilding=parent.id;nextFloor=spaceId; }
    else if(element?.floor_id) { const owner=sceneElementBuilding(scene,data.places,element); nextBuilding=owner?.id??null;nextFloor=owner?element.floor_id:null; }
    const elementId=element?.id ?? parent?.id ?? null;
    setInside(nextBuilding);setFloorId(nextFloor);setSelectedId(elementId);setSelectedSpaceId(spaceId);setPanelOverride(undefined);
    if(directions && directions.destination!==spaceId) setDirections(null);
    updateView({selectedId:elementId,spaceId,buildingId:nextBuilding,floorId:nextFloor,panel:'place'});
    setLastExternalSpace(externalSpaceId);operations?.onSelectPlace(spaceId);
    if(personal) personal.onSelectPlace(spaceId); else campusLayers?.onSelectAsset?.(null);
  };
  const openResource = (id:string) => {
    const element=scene.elements.find(item=>item.id===id && item.holding_id);if(!element) return;
    const owner=sceneElementBuilding(scene,data.places,element), asset=campusLayers?.assets?.find(item=>item.element_id===id);
    const placeId=asset?.space_id ?? element.space_id;
    setInside(owner?.id??null);setFloorId(owner?element.floor_id:null);select(id);setSelectedSpaceId(placeId);
    updateView({selectedId:id,spaceId:placeId,buildingId:owner?.id??null,floorId:owner?element.floor_id:null,panel:'place'});
  };
  const openDirections = (spaceId:string) => { if(!data.places.some(place=>place.id===spaceId)) return;
    if(directions?.destination!==spaceId) { setDirections({destination:spaceId,origin:'',accessible:false});setInside(null);setFloorId(null); }
    choosePanel('directions');
  };
  const endpointIds = new Set(sceneWalkingPlaceIds(scene));
  const origins = data.places.filter(place => endpointIds.has(place.id)).sort((a, b) => Number(b.kind === "gate") - Number(a.kind === "gate") || a.name.localeCompare(b.name));
  const requestedDestination = directions ? data.places.find(place => place.id === directions.destination) : undefined;
  let arrival = requestedDestination;
  const seen = new Set<string>();
  while (arrival && !endpointIds.has(arrival.id) && !seen.has(arrival.id)) { seen.add(arrival.id); arrival = data.places.find(place => place.id === arrival?.parent_space_id); }
  const manualRoute = !campusLayers?.layoutChanged && directions?.origin && arrival ? findSceneWalkingRoute(scene, { fromSpaceId: directions.origin, toSpaceId: arrival.id, accessibleOnly: directions.accessible, excludedConnectorIds: campusLayers?.blockedConnectorIds }) : null;
  const walkingRoute = campusLayers?.layoutChanged ? null : directions ? manualRoute : personal?.walkingRoute;
  const showFloor = (id: string | null) => {
    setRouteViewError(null); if (directions) wayfinding?.showFloor(id);
    if (id === null) { setInside(null); setFloorId(null); return; }
    const parent = sceneFloorBuilding(scene, data.places, id);
    if (!parent) { setRouteViewError("This floor does not have a published building plan."); return; }
    setInside(parent.id); setFloorId(id); setSelectedId(null);
  };
  const markers = [...operations?.markersFor(visibleScene, floorId) ?? [], ...campusLayers?.markersFor(visibleScene, floorId) ?? []];
  const panelTitles = { search: "Find a place", place: contextBuilding?.label ?? selected?.label ?? "Campus place", directions: `Directions to ${requestedDestination?.name ?? "place"}`, day: "My campus day", layers: "Layers and view", operations: "Campus activity", information: "About this map" };
  let content: ReactNode = null;
  if (panel === "search") content = <CampusMapSearch places={places} search={search} page={page} onSearch={search => updateView({ search, page: 1 })} onPage={page => updateView({ page })} onSelect={item => { if(item.space_id && data.places.some(place=>place.id===item.space_id)) openPlace(item.space_id); else { select(item.id);setInside(null);setFloorId(null);updateView({buildingId:null,floorId:null}); } }} />;
  if (panel === "place") {
    const reportSpace = selectedAsset?.space_id ?? selectedPlace?.id;
    const reportHref = schoolId && reportSpace ? `/areas/facilities?${new URLSearchParams({report:'1',space_id:reportSpace,...(selectedAsset?.reportable?{holding_id:selectedAsset.holding_id}:{})})}` : null;
    const inspectionState = selectedPlace ? operations?.inspectionState?.(selectedPlace.id) ?? 'available' : 'unavailable';
    const activity = selectedPlace ? <>{personal?.placeDetails(selectedPlace.id)}{operations ? <><button type="button" className="campus-scene-button" disabled={inspectionState!=='available'} onClick={()=>operations.onInspectPlace(selectedPlace.id)}>View recorded activity</button>{inspectionState!=='available'?<p role="status">{inspectionState==='loading'?'Loading recorded activity…':'Recorded activity for this place is unavailable in the current snapshot.'}</p>:null}</> : null}</> : null;
    content = contextBuilding ? <CampusBuildingExplorer key={contextBuilding.id} building={contextBuilding} scene={scene} places={data.places}
      assets={campusLayers?.assetsState==='available'?campusLayers.assets:[]} selectedPlaceId={selectedPlace?.id??selected?.space_id}
      selectedResourceElementId={selectedAsset?selected?.id:null} coverage={operations?.placesState==='available'?'campus':'mapped'}
      placesState={operations?.placesState??'available'} assetsState={campusLayers?.assetsState??'unavailable'}
      onSelectPlace={openPlace} onSelectResource={openResource}
      onShowBuilding={()=>{setInside(null);setFloorId(null);select(contextBuilding.id);updateView({buildingId:null,floorId:null,spaceId:contextBuilding.space_id});}}
      onDirections={openDirections} reportHref={reportHref} activityContext={activity}
      selectedDetails={<>{selectedAsset ? <CampusAssetStatus asset={selectedAsset} isLamp={selected?.asset_key==='lamp'} timezone={data.campus.timezone??'UTC'} showReport={false}/> : selectedPlace && selectedPlace.id!==contextBuilding.space_id && selectedPlace.kind!=='floor' ? <CampusRoomInventory schoolId={schoolId} campusId={data.campus.id} spaceId={selectedPlace.id} canRead={data.can_edit && operations?.placesState==='available'}/> : null}</>}
    /> : selected ? <CampusMapPlace selected={selected} place={selectedPlace} onDirections={()=>selectedPlace&&openDirections(selectedPlace.id)}>{activity}{campusLayers?.elementDetails(selected)}</CampusMapPlace> : <p>Select a building or find a place on the map.</p>;
  }
  if (panel === "directions" && directions) content = <><CampusSceneDirections destinationName={requestedDestination?.name ?? "Unavailable place"} exact={arrival?.id === requestedDestination?.id} arrivalName={arrival?.name} origins={origins} originId={directions.origin} accessibleOnly={directions.accessible} onOrigin={origin => { setDirections({ ...directions, origin }); setInside(null); setFloorId(null); }} onAccessible={accessible => setDirections({ ...directions, accessible })} route={manualRoute} places={data.places} currentFloorId={floorId} onSelectFloor={showFloor} />{campusLayers?.routeWarnings}</>;
  if (panel === "day") content = <>{personal?.controls}{!directions && personal?.walkingRoute?.status === "available" && personal.walkingRoute.transitionCount ? <SceneRouteSteps route={personal.walkingRoute} places={data.places} currentFloorId={floorId} onSelectFloor={showFloor} /> : null}</>;
  if (panel === "operations") content = operations?.controls;
  if (panel === "layers") content = <div className="campus-map-layers"><CampusLifeControls enabled={life.enabled} onEnabled={life.setEnabled} data={life.compiled} state={operations?.motionState ?? personal?.motionState} personal={!operations?.motion}/><div><h3>View</h3><div className="campus-scene-mode" aria-label="Campus perspective"><button type="button" aria-pressed={mode === "2.5d"} onClick={() => updateView({ mode: "2.5d" })}><Layers size={16} />2.5D</button><button type="button" aria-pressed={mode === "2d"} onClick={() => updateView({ mode: "2d" })}>Flat plan</button></div></div>{campusLayers?.mapControls ? <section><h3>Campus activity</h3>{campusLayers.mapControls}</section> : null}{operations?.mapControls ? <section><h3>Recorded evidence</h3>{operations.mapControls}</section> : null}{campusLayers?.controls}</div>;
  if (panel === "information") content = <div className="campus-map-information"><p>This map shows the reviewed campus layout, not current occupancy. Surroundings are illustrative.</p><p>Select a building to explore its places, recorded activity or directions.</p><dl><dt>Published</dt><dd>{new Date(data.scene.published_at).toLocaleString()}</dd><dt>Source</dt><dd>{scene.source.label}</dd></dl>{scene.source.attribution ? <p>{scene.source.attribution}</p> : null}</div>;
  return <div className="campus-scene-editor campus-scene-public"><CampusMapWorkspace panel={panel} title={panel ? panelTitles[panel] : "Campus map"} panelContent={<>{routeViewError ? <p role="status" className="campus-scene-error">{routeViewError}</p> : null}{content}</>} onPanel={value => { if (panel === "directions" && (value === "place" || value === null)) { if (!selected && requestedDestination) { const target = scene.elements.find(item => item.space_id === requestedDestination.id); setSelectedId(target?.id ?? null); updateView({ selectedId: target?.id ?? null, panel: "place" }); setPanelOverride(undefined); return; } } choosePanel(value); }} expanded={view.expanded} onExpanded={expanded => updateView({ expanded })} expandedContext={expandedContext} onExpandedChange={onExpandedChange} dialogOpen={Boolean(operations?.dialogOpen || campusLayers?.dialogOpen)} hasPersonal={Boolean(personal)} hasOperations={Boolean(operations)} map={<CampusSceneCanvas people={life.data} peopleClock={life.clock} lighting={lighting.lighting} sunlight={lighting.sunlight} scene={visibleScene} mode={building ? "2d" : mode} floorId={floorId} interiorOutline={interior?.outline} viewBounds={interior?.viewBounds} topInset={building ? 120 : 72} bottomInset={76} overview selectedElementId={selectedId} onSelectElement={select} markers={markers} selectedMarkerId={campusLayers?.selectedMarkerId ?? operations?.selectedMarkerId} unavailableFixtureIds={campusLayers?.faultLampIds ?? operations?.unavailableFixtureIds} onSelectMarker={id => id.startsWith("campus-layer:") ? campusLayers?.onSelectMarker(id) : operations?.onSelectMarker(id)} walkingRoute={walkingRoute} placeFocus={scenePlaceFocus(visibleScene, focusedId, building ? "2d" : mode, floorId)} resetKey={`${data.scene.id}:${data.scene.version}:${inside ?? "outside"}:${floorId ?? ""}`} />}>
    {building ? <div className="campus-map-workspace__floor"><button type="button" className="campus-scene-button" onClick={() => { if (directions) showFloor(null); else { setInside(null); setFloorId(null); select(building.id); updateView({ buildingId: null, floorId: null }); } }}><ArrowLeft size={17} />Campus</button><label><span className="campus-scene-visually-hidden">Floor</span><select aria-label="Floor" value={floorId ?? ""} onChange={event => { if (directions) showFloor(event.target.value); else { openPlace(event.target.value); } }}>{floors.map(floor => <option key={floor.id} value={floor.id}>{floor.name}</option>)}</select></label></div> : null}
  </CampusMapWorkspace></div>;
}
