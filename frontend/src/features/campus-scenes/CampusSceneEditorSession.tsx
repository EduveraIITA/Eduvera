import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { LIVE_EXECUTION_ENVIRONMENT } from "../simulation/executionEnvironment";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { type InstitutionSetup } from "../office/api";
import { CampusScenePlaceCreator } from "./CampusScenePlaceCreator";
import { CampusSceneEditor } from "./CampusSceneEditor";
import { getCampusSceneImportCapabilities, lookupCampusSceneLocation, publishCampusScene, requestCampusSceneImport, saveReviewedScenePlaces, saveCampusSceneDraft, uploadCampusSceneImage, type CampusSceneImage, type CampusSceneWorkspace } from "./api";
import { useSceneImageUrl } from "./useSceneImageUrl";
import { isDefinitiveSceneImportFailure } from "./sceneImportFailure";
import type { FloorPlanIntakeRequest } from "./CampusSceneFloorPlanIntake";
import type { CampusSceneDocument, CampusSceneElement, CampusSceneImportCapabilities, CampusSceneImportRequest, CampusSceneSpace } from "./types";

interface Props { schoolId: string; campusId: string; worldKey: string; workspace: CampusSceneWorkspace; onPublished: () => void; onReload: () => void; onDirtyChange: (dirty: boolean) => void; initialElementId?: string; initialPanel?: "source" | "review" | "places"; scopeBlocked?: boolean }
const emptyScene = (name: string): CampusSceneDocument => ({ schema_version: 1, name, bounds: { width: 1000, height: 800, unit: "relative" }, source: { kind: "manual", label: "Manually drawn campus" }, elements: [] });
const unavailableCapabilities: CampusSceneImportCapabilities = { image_analysis: { available: false, reason: "Image analysis availability could not be verified." }, map_search: { available: false, reason: "Campus search availability could not be verified. You can upload a plan or map data." }, max_image_bytes: 4 * 1024 * 1024 };

export function CampusSceneEditorSession({ schoolId, campusId, worldKey, workspace, onPublished, onReload, onDirtyChange, initialElementId, initialPanel, scopeBlocked }: Props) {
  const activeSession = useRef(true);
  useEffect(() => { activeSession.current = true; return () => { activeSession.current = false; }; }, []);
  const queryClient = useQueryClient();
  const environment = useOptionalExecutionEnvironment() ?? LIVE_EXECUTION_ENVIRONMENT;
  const [initial] = useState(() => workspace.scene?.draft ?? emptyScene(workspace.campus.name));
  const [createdSpaces, setCreatedSpaces] = useState<CampusSceneSpace[]>([]);
  const [creatingPlace, setCreatingPlace] = useState<{ element: CampusSceneElement; created: (id: string) => void } | null>(null);
  const spaces = useMemo(() => [...new Map([...workspace.spaces, ...createdSpaces].map(space => [space.id, space])).values()], [workspace.spaces, createdSpaces]);
  const [imageId, setImageId] = useState(initial.source.image_asset_id);
  const savedDocument = useRef(JSON.stringify(initial));
  const [currentDocument, setCurrentDocument] = useState(initial);
  const keys = useRef(new Map<string, { signature: string; key: string }>());
  const images = useRef(new WeakMap<File, { key: string; image?: CampusSceneImage }>());
  const capabilities = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["campus-scenes", worldKey, schoolId, campusId, "import-capabilities"]), queryFn: ({ signal }) => getCampusSceneImportCapabilities(schoolId, campusId, signal), staleTime: 60_000, retry: false });
  const sourceImage = useSceneImageUrl(schoolId, campusId, imageId, worldKey);
  const commandKey = (kind: string, signature: string) => {
    const previous = keys.current.get(kind);
    if (previous?.signature === signature) return previous.key;
    const next = { signature, key: crypto.randomUUID() }; keys.current.set(kind, next); return next.key;
  };
  const documentChanged = useCallback((document: CampusSceneDocument) => {
    setCurrentDocument(document); setImageId(document.source.image_asset_id); onDirtyChange(JSON.stringify(document) !== savedDocument.current);
  }, [onDirtyChange]);
  const sendImport = async (payload: object): Promise<CampusSceneDocument> => {
    try { return (await requestCampusSceneImport(schoolId, campusId, { ...payload, idempotency_key: commandKey("import", JSON.stringify(payload)) })).document; }
    catch (error) { if (isDefinitiveSceneImportFailure(error)) keys.current.delete("import"); throw error; }
  };
  const importScene = async (request: CampusSceneImportRequest): Promise<CampusSceneDocument> => {
    if (request.kind === "image") {
      if (!request.rightsConfirmed) throw new Error("Confirm that you have permission to adapt this image first.");
      let stored = images.current.get(request.file);
      if (!stored) { stored = { key: crypto.randomUUID() }; images.current.set(request.file, stored); }
      if (!stored.image) stored.image = (await uploadCampusSceneImage(schoolId, campusId, request.file, stored.key)).image;
      if (request.traceOnly || capabilities.data?.image_analysis.available !== true) {
        const longest = Math.max(stored.image.width, stored.image.height);
        return { ...emptyScene(workspace.campus.name), bounds: { width: Math.max(1, Math.round(stored.image.width / longest * 1000)), height: Math.max(1, Math.round(stored.image.height / longest * 1000)), unit: "relative" }, source: { kind: request.sourceKind, label: request.label.slice(0, 160), image_asset_id: stored.image.id, notes: "Uploaded image for manual tracing. No buildings or landscape features have been identified automatically." } };
      }
      const payload = { kind: "image", image_asset_id: stored.image.id, label: request.label.slice(0, 160), source_kind: request.sourceKind, instructions: request.instructions ?? "" };
      return sendImport(payload);
    }
    if (request.kind === "geojson" && !request.rightsConfirmed) throw new Error("Confirm the map data rights and attribution first.");
    const payload = request.kind === "location" ? { kind: "location", location: request.location, radius_metres: request.radiusMetres ?? 400 }
      : { kind: "geojson", text: request.text, label: request.label.slice(0, 160), attribution: request.attribution, rights_confirmed: true };
    return sendImport(payload);
  };
  const importFloorPlan = async (request: FloorPlanIntakeRequest): Promise<CampusSceneDocument> => {
    if (!request.rightsConfirmed) throw new Error("Confirm that you have permission to use this floor plan first.");
    const building = spaces.find(space => space.id === request.buildingId);
    const floor = request.floorId ? spaces.find(space => space.id === request.floorId && space.kind === "floor") : undefined;
    if (!building || building.revision === undefined || request.floorId && (!floor || floor.revision === undefined)) throw new Error("Refresh campus places before preparing this floor plan.");
    let stored = images.current.get(request.file);
    if (!stored) { stored = { key: crypto.randomUUID() }; images.current.set(request.file, stored); }
    if (!stored.image) stored.image = (await uploadCampusSceneImage(schoolId, campusId, request.file, stored.key)).image;
    if (request.traceOnly || capabilities.data?.image_analysis.available !== true) {
      const longest = Math.max(stored.image.width, stored.image.height);
      return { ...emptyScene(workspace.campus.name), bounds: { width: Math.max(1, Math.round(stored.image.width / longest * 1000)), height: Math.max(1, Math.round(stored.image.height / longest * 1000)), unit: "relative" }, source: { kind: "site_plan", label: request.file.name.slice(0, 160), image_asset_id: stored.image.id, notes: "Uploaded floor plan for manual tracing. No rooms or openings have been identified automatically." } };
    }
    return sendImport({ kind: "image", purpose: "floor_plan", source_kind: "site_plan", image_asset_id: stored.image.id, label: request.file.name.slice(0, 160), instructions: request.instructions, target: { building_id: building.id, expected_building_revision: building.revision, ...(floor ? { floor_id: floor.id, expected_floor_revision: floor.revision } : {}) } });
  };
  return <>
    {sourceImage.loading ? <p role="status" className="campus-scene-notice">Loading the private source image…</p> : null}
    {sourceImage.error ? <p role="alert" className="campus-scene-error">{sourceImage.error}</p> : null}
    {creatingPlace ? <CampusScenePlaceCreator key={`${worldKey}:${schoolId}:${campusId}:${creatingPlace.element.id}`} schoolId={schoolId} campusId={campusId} worldKey={worldKey} element={creatingPlace.element} scene={currentDocument} onClose={() => setCreatingPlace(null)} onCreated={space => { setCreatedSpaces(current => [...current, space]); creatingPlace.created(space.id); setCreatingPlace(null); }} /> : null}
    <CampusSceneEditor scopeBlocked={scopeBlocked} initialElementId={initialElementId} initialPanel={initialPanel} onCreatePlace={(element, created) => setCreatingPlace({ element, created })} resourceScope={{ schoolId, campusId }} campusTimeZone={workspace.campus.timezone} document={initial} revision={workspace.scene?.revision ?? 0} spaces={spaces} publishedVersion={workspace.scene?.published_version ?? null} sourceImageUrl={sourceImage.url} setupHref={`/more/setup/institution/campus?campus_id=${encodeURIComponent(campusId)}`} capabilities={capabilities.data ?? unavailableCapabilities} onDocumentChange={documentChanged} onReload={onReload} onLookup={query => lookupCampusSceneLocation(schoolId, campusId, query)} onImport={importScene} onImportFloorPlan={importFloorPlan}
      onSaveReviewedPlaces={async body => {
        const result = await saveReviewedScenePlaces(schoolId, campusId, body);
        if (activeSession.current && result.current_revision === result.revision) {
          savedDocument.current = JSON.stringify(result.document); onDirtyChange(false);
          const created = result.mappings.filter(mapping => mapping.action === "created").flatMap(mapping => {
            const row = body.rows.find(item => item.proposal_id === mapping.proposal_id);
            return row?.action === "create" ? [{ id: mapping.space_id, campus_id: campusId, parent_space_id: row.parent_proposal_id ? result.mappings.find(item => item.proposal_id === row.parent_proposal_id)?.space_id ?? null : row.parent_space_id ?? null, name: row.name, code: row.code, kind: row.kind, revision: mapping.space_revision }] : [];
          });
          const cached = queryClient.getQueryData<InstitutionSetup>(executionEnvironmentQueryKey(environment, ["institution-setup", schoolId]));
          const reused = cached?.spaces.filter(space => space.campus_id === campusId && result.mappings.some(mapping => mapping.space_id === space.id)) ?? [];
          setCreatedSpaces(current => [...current, ...reused, ...created]);
          void queryClient.invalidateQueries({ queryKey: executionEnvironmentQueryKey(environment, ["institution-setup", schoolId]) });
        }
        return result;
      }}
      onSave={async (document, revision) => {
        const result = await saveCampusSceneDraft(schoolId, campusId, document, revision, commandKey("save", `${revision}:${JSON.stringify(document)}`));
        savedDocument.current = JSON.stringify(result.document); onDirtyChange(false); keys.current.delete("save");
        return { document: result.document, revision: result.revision };
      }} onPublish={async revision => {
        const result = await publishCampusScene(schoolId, campusId, revision, commandKey("publish", String(revision)));
        onDirtyChange(false); onPublished(); return { version: result.version ?? result.revision, revision: result.revision };
      }} />
  </>;
}
