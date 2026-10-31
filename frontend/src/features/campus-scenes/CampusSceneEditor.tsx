import { useEffect, useRef, useState } from "react";
import { Check, Download, FileImage, Layers, List, MoreHorizontal, Plus, Redo2, Save, Undo2 } from "lucide-react";
import { InfoSummary } from "../../components/InfoSummary";
import { ApiError } from "../../lib/api";
import { CampusSceneCanvas } from "./CampusSceneCanvas";
import { CampusScenePlaceBatchReview } from "./CampusScenePlaceBatchReview";
import { CampusSceneFloorPlanIntake, type FloorPlanIntakeRequest } from "./CampusSceneFloorPlanIntake";
import { CampusSceneRoomFurnishing } from "./CampusSceneRoomFurnishing";
import { furnishSceneRoom, type RoomFurnishingTemplate } from "./sceneRoomTemplates";
import { floorPlanDisplayBounds, mergeFloorPlanProposal, type SceneFloorPlanContext } from "./sceneFloorPlans";
import type { ReviewedScenePlacesReceipt, ReviewedScenePlacesRequest } from "./api";
import { CampusSceneInspector } from "./CampusSceneInspector";
import type { CampusSceneResourceScope } from "./CampusSceneResourcePicker";
import { CampusSceneSourceIntake } from "./CampusSceneSourceIntake";
import { CampusSceneAdd, CampusSceneItems, CampusSceneReview } from "./CampusSceneTools";
import { clampPoint, defaultPoints, draftIssues, geometryType, moveElement } from "./sceneEditing";
import { scenePointBounds, sceneUnitScale } from "./sceneGeometry";
import { createCampusDemoScene } from "./sceneDemo";
import type { CampusSceneAsset } from "./sceneAssets";
import type { CampusSceneDocument, CampusSceneElement, CampusSceneImportCapabilities, CampusSceneImportRequest, CampusSceneLocation, CampusScenePoint, CampusSceneSavedDraft, CampusSceneSpace } from "./types";
import { useSceneHistory } from "./useSceneHistory";
import { useSceneLighting } from "./useSceneLighting";
import "./campus-scene-editor.css";

export interface CampusSceneEditorProps {
  document: CampusSceneDocument;
  revision: number;
  spaces: CampusSceneSpace[];
  publishedVersion: number | null;
  onSave: (document: CampusSceneDocument, expectedRevision: number) => Promise<CampusSceneSavedDraft>;
  onPublish: (expectedRevision: number) => Promise<{ version: number; revision?: number }>;
  onImport?: (request: CampusSceneImportRequest) => Promise<CampusSceneDocument>;
  onImportFloorPlan?: (request: FloorPlanIntakeRequest) => Promise<CampusSceneDocument>;
  onLookup?: (query: string) => Promise<CampusSceneLocation[]>;
  capabilities?: CampusSceneImportCapabilities;
  sourceImageUrl?: string | null;
  campusTimeZone?: string;
  onDocumentChange?: (document: CampusSceneDocument) => void;
  onReload?: () => void;
  onBack?: () => void;
  setupHref?: string;
  resourceScope?: CampusSceneResourceScope;
  onCreatePlace?: (element: CampusSceneElement, onCreated: (id: string) => void) => void;
  scopeBlocked?: boolean;
  onSaveReviewedPlaces?: (body: ReviewedScenePlacesRequest) => Promise<ReviewedScenePlacesReceipt>;
  initialElementId?: string;
  initialPanel?: "source" | "review" | "places";
}

export function CampusSceneEditor(props: CampusSceneEditorProps) {
  const lighting = useSceneLighting(props.campusTimeZone);
  const optionsMenu = useRef<HTMLDetailsElement>(null);
  const closeOptions = () => {
    const menu = optionsMenu.current;
    if (menu) { menu.open = false; menu.querySelector("summary")?.focus(); }
  };
  const history = useSceneHistory(props.document);
  const scene = history.document;
  const [revision, setRevision] = useState(props.revision);
  const [publishedVersion, setPublishedVersion] = useState(props.publishedVersion);
  const [selectedId, setSelectedId] = useState<string | null>(props.document.elements.some(element => element.id === props.initialElementId) ? props.initialElementId! : null);
  const [mode, setMode] = useState<"2d" | "2.5d">("2.5d");
  const [panel, setPanel] = useState<"source" | "add" | "items" | null>(props.initialPanel === "source" ? "source" : scene.elements.length ? null : "source");
  const [batchReview, setBatchReview] = useState(props.initialPanel === "places");
  const [floorPlanIntake, setFloorPlanIntake] = useState(false);
  const [floorPlan, setFloorPlan] = useState<SceneFloorPlanContext | null>(null);
  const [focusFloorId, setFocusFloorId] = useState<string | null>(null);
  const floorPlanImage = useRef<string | null>(null);
  const floorPlanBase = useRef<CampusSceneDocument | null>(null);
  const [offerPlaces, setOfferPlaces] = useState(false);
  const [review, setReview] = useState(props.initialPanel === "review");
  const [drawing, setDrawing] = useState<CampusSceneAsset | null>(null);
  const [points, setPoints] = useState<CampusScenePoint[]>([]);
  const [busy, setBusy] = useState<"save" | "publish" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const selected = scene.elements.find(element => element.id === selectedId) ?? null;
  const issues = draftIssues(scene);
  const locked = busy !== null || batchReview || Boolean(props.scopeBlocked);
  const onDocumentChange = props.onDocumentChange;
  useEffect(() => () => { if (floorPlanImage.current) URL.revokeObjectURL(floorPlanImage.current); }, []);
  useEffect(() => { onDocumentChange?.(scene); }, [scene, onDocumentChange]);
  useEffect(() => {
    if (!history.dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [history.dirty]);
  const change = (update: CampusSceneDocument | ((current: CampusSceneDocument) => CampusSceneDocument)) => {
    if (locked) return; history.change(update); setNotice(null);
  };
  const updateElement = (element: CampusSceneElement) => change(current => ({ ...current, elements: current.elements.map(item => item.id === element.id ? element : item) }));
  const select = (id: string | null) => { setSelectedId(id); if (id) { setPanel(null); const element = scene.elements.find(item => item.id === id); if (element?.floor_id) setFocusFloorId(element.floor_id); } };
  const add = (asset: CampusSceneAsset, geometryPoints: CampusScenePoint[]) => {
    const scale = sceneUnitScale(scene);
    const element: CampusSceneElement = { id: crypto.randomUUID(), kind: asset.kind, label: asset.label,
      geometry: { type: geometryType(asset.kind), points: geometryPoints }, asset_key: asset.key, material: asset.material,
      space_id: null, floor_id: floorPlan?.floorId ?? focusFloorId, ...(floorPlan ? { parent_element_id: floorPlan.buildingElementId } : {}), review_state: "needs_review",
      ...(asset.width ? { width: asset.width * scale } : {}), ...(asset.height ? { height: asset.height * scale } : {}),
      ...(asset.depth ? { depth: asset.depth * scale } : {}),
      ...(asset.levels ? { levels: asset.levels } : {}), ...(asset.roof ? { roof: asset.roof } : {}) };
    change(current => ({ ...current, elements: [...current.elements, element] }));
    if (floorPlan) setFloorPlan(current => current ? { ...current, elementIds: [...current.elementIds, element.id] } : null);
    if (element.kind === "room") setMode("2d");
    setSelectedId(element.id); setPanel(null); setDrawing(null); setPoints([]);
  };
  const perform = async (kind: "save" | "publish") => {
    if (locked) return; setBusy(kind); setError(null); setStale(false); setNotice(null);
    try {
      if (kind === "save") { const saved = await props.onSave(scene, revision); history.acceptSaved(saved.document); setRevision(saved.revision); setNotice("Draft saved. Your published campus view is unchanged."); }
      else { const result = await props.onPublish(revision); setPublishedVersion(result.version); if (result.revision !== undefined) setRevision(result.revision); setNotice(`Campus view published · version ${result.version}.`); setReview(false); }
    } catch (caught) {
      const conflict = caught instanceof ApiError && caught.status === 409;
      setStale(conflict);
      setError(conflict ? "This campus draft changed elsewhere. Your edits are still here. Download a copy, then reload the latest draft before continuing." : caught instanceof Error ? caught.message : "This action did not complete. Your edits are still here; try again.");
    } finally { setBusy(null); }
  };
  const importSource = async (request: CampusSceneImportRequest) => {
    if (!props.onImport || locked) return;
    setBusy("import"); setError(null); setNotice(null);
    try {
      const imported = await props.onImport(request); history.change(imported); setSelectedId(null); setPanel(null);
      setMode(imported.elements.length ? "2.5d" : "2d"); setOfferPlaces(Boolean(imported.elements.length));
      setNotice(imported.elements.length ? "Layout prepared. Check each feature and connect your campus places before publishing." : "Your image is ready as a guide. Add a feature, then choose Draw on plan to trace it.");
    } finally { setBusy(null); }
  };
  const importFloorPlan = async (request: FloorPlanIntakeRequest) => {
    if (!props.onImportFloorPlan || locked) return;
    setBusy("import"); setError(null); setNotice(null);
    try {
      const proposal = await props.onImportFloorPlan(request);
      const building = scene.elements.find(element => element.kind === "building" && element.space_id === request.buildingId);
      if (!building) throw new Error("This building is no longer mapped. Refresh the layout before continuing.");
      const merged = mergeFloorPlanProposal(scene, proposal, building, request.floorId);
      if (floorPlanImage.current) URL.revokeObjectURL(floorPlanImage.current);
      floorPlanImage.current = URL.createObjectURL(request.file);
      floorPlanBase.current = scene;
      history.change(merged.document); setFloorPlan({ buildingId: request.buildingId, buildingElementId: building.id, floorId: request.floorId, newFloor: request.newFloor, elementIds: merged.elementIds, imageUrl: floorPlanImage.current, imageBounds: merged.imageBounds });
      setFloorPlanIntake(false); setPanel(null); setSelectedId(null); setFocusFloorId(request.floorId); setMode("2d"); setBatchReview(Boolean(merged.elementIds.length));
      setNotice(merged.elementIds.length ? "Floor plan prepared. Review the proposed places together; the rest of your campus stays in this draft." : "Trace rooms over the floor plan, then choose Review floor plan to create the places together.");
    } finally { setBusy(null); }
  };
  const discardFloorPlan = () => {
    if (locked || !floorPlan) return;
    if (floorPlanBase.current) history.change(floorPlanBase.current);
    if (floorPlanImage.current) URL.revokeObjectURL(floorPlanImage.current);
    floorPlanImage.current = null; floorPlanBase.current = null;
    setFloorPlan(null); setFocusFloorId(null); setSelectedId(null); setNotice("Floor-plan proposal discarded. Your previous campus draft is restored.");
  };
  const furnish = (template: RoomFurnishingTemplate) => {
    if (!selected || locked) return;
    const result = furnishSceneRoom(scene, selected, template);
    if (!result.elements.length) { setNotice("This room is too small or irregular for the arrangement. Add individual objects to place them precisely."); return; }
    if (scene.elements.length + result.elements.length > 2000) { setError("This arrangement would exceed the layout limit. Remove unused objects or choose a smaller arrangement."); return; }
    change(current => ({ ...current, elements: [...current.elements, ...result.elements] }));
    if (floorPlan) setFloorPlan(current => current ? { ...current, elementIds: [...current.elementIds, ...result.elements.map(element => element.id)] } : null);
    setNotice(`${result.elements.length} editable furniture objects added.${result.omitted ? ` ${result.omitted} could not fit and were left out.` : ""} No resource inventory was created.`);
  };
  const focusedFloor = props.spaces.find(space => space.id === focusFloorId);
  const focusedBuilding = (() => { let id = focusedFloor?.parent_space_id; const seen = new Set<string>(); while (id && !seen.has(id)) { seen.add(id); const match = scene.elements.find(element => element.kind === "building" && element.space_id === id); if (match) return match; id = props.spaces.find(space => space.id === id)?.parent_space_id; } return null; })();
  const floorBounds = (floorPlan ? floorPlanDisplayBounds(floorPlan) : undefined) ?? (focusedBuilding ? scenePointBounds(focusedBuilding.geometry.points) : undefined);
  const floorViewBounds = floorBounds ? { x: floorBounds.x - floorBounds.width * .08, y: floorBounds.y - floorBounds.height * .08, width: floorBounds.width * 1.16, height: floorBounds.height * 1.16 } : undefined;
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(scene, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `${scene.name.replace(/[^a-zA-Z0-9_-]/g, "-") || "campus"}-draft.json`; link.click(); URL.revokeObjectURL(url);
  };
  const drawPoint = (point: CampusScenePoint) => {
    if (!drawing || locked) return;
    const next = clampPoint(point, scene.bounds);
    if (geometryType(drawing.kind) === "point") add(drawing, [next]);
    else setPoints(current => current.length < 500 ? [...current, next] : current);
  };
  return <div className="campus-scene-editor" aria-busy={locked} onKeyDown={event => {
    if (locked || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z" || (event.target as HTMLElement).closest("input, textarea, select")) return;
    event.preventDefault(); if (event.shiftKey) history.redo(); else history.undo();
  }}>
    <div className="campus-scene-edit-bar"><div><span className="campus-scene-draft-label">Draft</span><span className="campus-scene-save-state" role="status">{busy === "import" ? "Preparing campus layout…" : history.dirty ? "Unsaved changes" : revision ? "Saved" : "Not saved yet"}</span></div><div className="campus-scene-inline-actions"><button type="button" className="campus-scene-button" disabled={locked || Boolean(drawing)} onClick={() => { setReview(value => !value); setPanel(null); }}>{review ? "Edit layout" : "Review"}</button><button type="button" className="campus-scene-button campus-scene-button--primary" disabled={locked || Boolean(floorPlan) || stale || (!history.dirty && revision > 0) || Boolean(drawing) || !scene.name.trim()} onClick={() => void perform("save")}><Save size={17} />{busy === "save" ? "Saving…" : "Save draft"}</button></div></div>
    {error ? <div className="campus-scene-error" role="alert"><p>{error}</p><div className="campus-scene-inline-actions"><button type="button" className="campus-scene-button" onClick={download}><Download size={16} />Download my draft</button>{stale && props.onReload ? <button type="button" className="campus-scene-button" onClick={props.onReload}>Reload latest draft</button> : null}</div></div> : null}
    {notice ? <p role="status" className="campus-scene-notice">{notice}</p> : null}
    {props.onSaveReviewedPlaces && props.resourceScope && scene.elements.length && !floorPlan ? <div className="campus-scene-setup-note"><div><strong>{floorPlan ? "Review the floor together" : offerPlaces ? "Bring the useful places into your campus" : "Connect campus places"}</strong><p>Review names and types together. Reuse existing places or leave scenery visual.</p></div><button type="button" className="campus-scene-button" disabled={locked || Boolean(drawing) || stale} onClick={() => setBatchReview(true)}>{floorPlan ? "Review floor plan" : "Review campus places"}</button></div> : null}
    {batchReview && props.onSaveReviewedPlaces && props.resourceScope ? <CampusScenePlaceBatchReview {...props.resourceScope} document={scene} revision={revision} floorPlan={floorPlan} onFloorPlanAdjusted={(document, context) => { history.change(document); setFloorPlan(context); }} scopeBlocked={props.scopeBlocked} sourceImageUrl={props.sourceImageUrl} onClose={() => setBatchReview(false)} onCommit={props.onSaveReviewedPlaces} onStale={() => { setStale(true); setError("The campus draft or a selected place changed. Your edits are still here. Download a copy, then reload the latest draft before continuing."); }} onAccepted={receipt => { history.change(receipt.document); history.acceptSaved(receipt.document); setRevision(receipt.revision); setBatchReview(false); setOfferPlaces(false); if (floorPlan) { setFocusFloorId(receipt.mappings.find(item => item.proposal_id === "floor_plan_target")?.space_id ?? floorPlan.floorId); setFloorPlan(null); } setNotice(`${receipt.mappings.filter(item => item.action === "created").length} campus places created and ${receipt.mappings.reduce((total, item) => total + item.element_ids.length, 0)} features connected. Your draft is saved; publishing stays separate. Created places remain available if you undo a drawing change.`); }} /> : null}
    {floorPlanIntake && props.onImportFloorPlan ? <CampusSceneFloorPlanIntake document={scene} spaces={props.spaces} initialBuildingId={selected?.kind === "building" ? selected.space_id : focusedBuilding?.space_id} capabilities={props.capabilities} disabled={busy !== null || Boolean(props.scopeBlocked)} onPrepare={importFloorPlan} onClose={() => setFloorPlanIntake(false)} /> : null}
    {panel === "source" && props.onImport ? <CampusSceneSourceIntake hasElements={Boolean(scene.elements.length)} disabled={locked} capabilities={props.capabilities} onLookup={props.onLookup} onImport={importSource} onClose={() => setPanel(null)} /> : null}
    {!scene.elements.length && !scene.source.image_asset_id ? <div className="campus-scene-sample"><span>Explore what you can build with an illustrative campus.</span><button type="button" className="campus-scene-button" disabled={locked} onClick={() => { change(createCampusDemoScene(props.spaces, scene.name)); setPanel(null); setMode("2.5d"); setNotice("This is a sample layout, not your actual campus. Replace or reshape it and review any suggested place links before publishing."); }}>Try sample campus</button></div> : null}
    <div className={`campus-scene-workbench${selected ? " has-selection" : ""}`}>
      <div className="campus-scene-stage">
        <div className="campus-scene-toolbar"><div className="campus-scene-mode" aria-label="Campus perspective"><button type="button" aria-pressed={mode === "2.5d"} disabled={Boolean(drawing)} onClick={() => setMode("2.5d")}><Layers size={16} />2.5D</button><button type="button" aria-pressed={mode === "2d"} onClick={() => setMode("2d")}>Flat plan</button></div><div className="campus-scene-inline-actions"><button type="button" className="campus-scene-button" disabled={locked || Boolean(drawing)} aria-expanded={panel === "add"} onClick={() => setPanel(panel === "add" ? null : "add")}><Plus size={17} />Add</button><button type="button" className="campus-scene-icon-button" aria-label={`Campus items, ${scene.elements.length}`} aria-expanded={panel === "items"} onClick={() => setPanel(panel === "items" ? null : "items")}><List size={20} /></button><details ref={optionsMenu} className="campus-scene-tool-options"><summary aria-label="Editor options"><MoreHorizontal size={21} /></summary><div className="campus-scene-options-content"><div className="campus-scene-inline-actions"><button type="button" className="campus-scene-button" disabled={locked || !history.canUndo || Boolean(drawing)} onClick={history.undo}><Undo2 size={16} />Undo</button><button type="button" className="campus-scene-button" disabled={locked || !history.canRedo || Boolean(drawing)} onClick={history.redo}><Redo2 size={16} />Redo</button></div>{props.onImport ? <button type="button" className="campus-scene-button" disabled={locked || Boolean(drawing)} onClick={() => { closeOptions(); setPanel("source"); }}>Change layout source</button> : null}{props.onImportFloorPlan ? <button type="button" className="campus-scene-button" disabled={locked || Boolean(drawing) || Boolean(floorPlan)} onClick={() => { closeOptions(); setFloorPlanIntake(true); }}><FileImage size={16} />Add a floor plan</button> : null}<label>Campus view name<input value={scene.name} maxLength={160} disabled={locked} onChange={event => change({ ...scene, name: event.target.value })} /></label><button type="button" className="campus-scene-button" onClick={() => { closeOptions(); download(); }}><Download size={16} />Download draft</button></div></details></div></div>
        {floorPlan || focusedFloor ? <div className="scene-floor-plan-context"><span><strong>{floorPlan?.newFloor?.name ?? focusedFloor?.name ?? "Floor plan"}</strong><small>{floorPlan ? "Proposal · review places before saving" : "Floor plan"}</small></span>{!floorPlan ? <button type="button" className="campus-scene-button" onClick={() => { setFocusFloorId(null); setSelectedId(null); }}>Show campus</button> : <div className="campus-scene-inline-actions"><button type="button" className="campus-scene-button" disabled={locked || Boolean(drawing)} onClick={discardFloorPlan}>Discard plan</button><button type="button" className="campus-scene-button" disabled={locked || Boolean(drawing) || !floorPlan.elementIds.some(id => scene.elements.some(element => element.id === id))} onClick={() => setBatchReview(true)}>Review floor plan</button></div>}</div> : selected?.kind === "building" && selected.space_id && props.onImportFloorPlan ? <div className="scene-floor-plan-context"><span><strong>{selected.label}</strong><small>Add rooms from a plan</small></span><button type="button" className="campus-scene-button" disabled={locked || Boolean(drawing)} onClick={() => setFloorPlanIntake(true)}><FileImage size={16} />Add floor plan</button></div> : null}
        {panel === "add" ? <CampusSceneAdd indoor={Boolean(floorPlan || focusFloorId)} disabled={locked || scene.elements.length >= 2000} onPlace={asset => add(asset, floorBounds ? defaultPoints(asset.kind, { ...scene.bounds, width: floorBounds.width, height: floorBounds.height }).map(point => ({ x: point.x + floorBounds.x, y: point.y + floorBounds.y })) : defaultPoints(asset.kind, scene.bounds, scene.elements.length))} onDraw={asset => { setDrawing(asset); setPoints([]); setMode("2d"); setPanel(null); setSelectedId(null); }} onClose={() => setPanel(null)} /> : null}
        {drawing ? <div className="campus-scene-drawing" role="status"><div><strong>{drawing.label}</strong><p>{geometryType(drawing.kind) === "point" ? "Tap the plan to place this feature." : `Tap the plan to add ${geometryType(drawing.kind) === "polygon" ? "corners" : "path points"}. ${points.length} placed.`}</p></div><div className="campus-scene-inline-actions">{geometryType(drawing.kind) !== "point" ? <><button type="button" className="campus-scene-button campus-scene-button--primary" disabled={points.length < (geometryType(drawing.kind) === "polygon" ? 3 : 2)} onClick={() => add(drawing, points)}><Check size={16} />Finish</button><button type="button" className="campus-scene-button" disabled={!points.length} onClick={() => setPoints(current => current.slice(0, -1))}>Undo point</button></> : null}<button type="button" className="campus-scene-button" onClick={() => { setDrawing(null); setPoints([]); }}>Cancel</button></div></div> : null}
        <CampusSceneCanvas className={floorPlan ? "scene-floor-plan-reference" : undefined} scene={floorPlan ? { ...scene, elements: scene.elements.filter(element => floorPlan.elementIds.includes(element.id)) } : scene} floorId={floorPlan ? null : focusFloorId} interiorView={Boolean(floorPlan)} interiorOutline={focusedBuilding?.geometry.points} viewBounds={floorViewBounds} resetKey={floorPlan ? "floor-proposal" : focusFloorId ?? "campus"} sourceImageBounds={floorPlan?.imageBounds} sourceImageRotationDeg={floorPlan?.imageRotationDeg} mode={mode} lighting={lighting.lighting} sunlight={lighting.sunlight} showRooms={mode === "2d"} selectedElementId={selectedId} onSelectElement={select} sourceImageUrl={floorPlan?.imageUrl ?? (focusFloorId ? null : props.sourceImageUrl)} interaction={drawing ? "draw" : "select"} draftPoints={points} onCanvasPoint={drawing ? drawPoint : undefined} onMoveElement={locked || drawing ? undefined : (id, dx, dy) => { const element = scene.elements.find(item => item.id === id); if (element) updateElement(moveElement(element, dx, dy, scene.bounds)); }} onChangeVertex={locked || drawing ? undefined : (id, index, point) => { const element = scene.elements.find(item => item.id === id); if (element) updateElement({ ...element, review_state: "needs_review", geometry: { ...element.geometry, points: element.geometry.points.map((item, position) => position === index ? clampPoint(point, scene.bounds) : item) } }); }} />
        <div className="campus-scene-caption"><span>{scene.elements.length ? mode === "2d" ? "Select an item to move it or adjust its corners." : "Explore your campus. Select a place to edit its details." : "Your campus starts here. Add buildings, paths and landscape features."}{mode === "2.5d" ? " Surroundings are illustrative." : ""}</span><small>{floorPlan ? "Illustrative fit · verify dimensions" : scene.bounds.unit === "relative" ? "Illustrative scale" : "Dimensions in metres"}</small></div>
      </div>
      {selected ? <div className="campus-scene-selected-tools"><CampusSceneInspector key={selected.id} element={selected} scene={scene} spaces={props.spaces} setupHref={props.setupHref} resourceScope={props.resourceScope} onCreatePlace={!floorPlan && props.onCreatePlace && (selected.kind === "building" || selected.kind === "room" || selected.asset_key === "gate") ? () => props.onCreatePlace!(selected, id => updateElement({ ...selected, space_id: id, review_state: "needs_review" })) : undefined} disabled={locked || Boolean(drawing)} fixedFloorContext={Boolean(floorPlan)} onChange={updateElement} onClose={() => setSelectedId(null)} onDelete={() => { change(current => ({ ...current, elements: current.elements.filter(item => item.id !== selected.id).map(item => item.parent_element_id === selected.id ? { ...item, parent_element_id: null, review_state: "needs_review" } : item) })); if (floorPlan) setFloorPlan(current => current ? { ...current, elementIds: current.elementIds.filter(id => id !== selected.id) } : null); setSelectedId(null); }} onDuplicate={() => { const duplicate = { ...moveElement(selected, scene.bounds.width * .03, scene.bounds.height * .03, scene.bounds), id: crypto.randomUUID(), source_feature_id: undefined, label: `${selected.label} copy`.slice(0, 160), space_id: null, floor_id: floorPlan ? floorPlan.floorId : selected.floor_id ?? focusFloorId, holding_id: null, navigation: undefined, navigation_connector: undefined }; change(current => ({ ...current, elements: [...current.elements, duplicate] })); setSelectedId(duplicate.id); if (floorPlan) setFloorPlan(current => current ? { ...current, elementIds: [...current.elementIds, duplicate.id] } : null); }} />{selected.kind === "room" && selected.floor_id ? <CampusSceneRoomFurnishing key={`furnish-${selected.id}`} relativeScale={scene.bounds.unit === "relative"} existingCount={scene.elements.filter(element => element.parent_element_id === selected.id && element.kind === "fixture").length} disabled={locked || Boolean(drawing)} onApply={furnish} /> : null}</div> : null}
    </div>
    {panel === "items" ? <CampusSceneItems scene={scene} selectedId={selectedId} onSelect={select} onClose={() => setPanel(null)} /> : null}
    {review ? <CampusSceneReview scene={scene} spaces={props.spaces} dirty={history.dirty || revision === 0} issues={issues} busy={locked} onSelect={select} onPublish={() => void perform("publish")} onBack={() => setReview(false)} onReviewAll={() => change(current => ({ ...current, elements: current.elements.map(element => ({ ...element, review_state: "reviewed" })) }))} /> : null}
    <details className="campus-scene-disclosure campus-scene-provenance"><InfoSummary>Layout source and published version</InfoSummary><p>{scene.source.label || "Manually drawn campus"}{scene.source.attribution ? ` · ${scene.source.attribution}` : ""}</p>{scene.source.notes ? <p>{scene.source.notes}</p> : null}<p>{publishedVersion ? `Published version ${publishedVersion}. Draft changes appear there only after you publish.` : "No published view yet. Save and review this draft to make it available."} The layout does not show live presence.</p></details>
  </div>;
}
