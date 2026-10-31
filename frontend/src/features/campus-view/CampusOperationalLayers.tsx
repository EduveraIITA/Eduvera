import { useCallback, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentIdentity, LIVE_EXECUTION_ENVIRONMENT } from "../simulation/executionEnvironment";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import type { CampusScenePublished } from "../campus-scenes/api";
import type { CampusSceneDocument } from "../campus-scenes/types";
import type { SceneEvidenceRecord } from "../campus-scenes/sceneOperations.types";
import { projectSceneEvidence } from "../campus-scenes/sceneEvidence";
import { sceneVisibleElements } from "../campus-scenes/sceneGeometry";
import { CampusLayoutChangedError, campusOperationalMatches, getCampusOperationalLayers } from "./campusOperational.api";
import { assetForSceneElement, boundCampusAssets, campusActivityRecords, campusAssetFaultIds, campusAssetLabel, campusBlockedLiftIds, campusLinkedLiftIds } from "./campusOperational";
import type { CampusMapLayer, CampusOperationalBridge } from "./campusOperational.types";
import { CampusAssetStatus } from "./CampusAssetStatus";
import { CampusEvidenceSheet } from "./CampusEvidenceSheet";
import { CampusLayerRecords } from "./CampusLayerRecords";
import { campusDateFormatter } from "./campusSceneRecords";
import "./campus-operational-layers.css";

const empty: CampusOperationalBridge = { assets: [], assetsState: "unavailable", mapControls: null, controls: null, routeWarnings: null, markersFor: () => [], selectedMarkerId: null, onSelectMarker: () => undefined, selectedAssetElementId: null, onSelectAsset: () => undefined, faultLampIds: [], blockedConnectorIds: [], layoutChanged: false, elementDetails: () => null, dialogOpen: false, closeDialog: () => undefined };
const liftStatusUnavailable = "Linked lift status is unavailable. Directions avoid lifts without current status.";
interface Props { schoolId: string; campusId: string; publication: CampusScenePublished | null; onLayoutRefresh?: () => void; children: (bridge: CampusOperationalBridge) => ReactNode }
export function CampusOperationalLayers(props: Props) {
  const auth = useAuth(), environment = useOptionalExecutionEnvironment() ?? LIVE_EXECUTION_ENVIRONMENT;
  const actorId = auth.user?.id;
  const blockedConnectorIds = campusLinkedLiftIds(props.publication?.scene?.document ?? null);
  const routeWarnings = blockedConnectorIds.length ? <p className="campus-layer-message" role="status">{liftStatusUnavailable}</p> : null;
  const unavailable = { ...empty, blockedConnectorIds, controls: routeWarnings, routeWarnings };
  if (!actorId || auth.user?.active_school_id !== props.schoolId || !auth.memberships.some(member => member.school_id === props.schoolId)) return props.children(unavailable);
  if (environment.mode === "simulation" && environment.unavailable) return props.children(unavailable);
  return <ActiveCampusOperationalLayers key={`${executionEnvironmentIdentity(environment)}:${props.schoolId}:${actorId}:${props.campusId}`} {...props} actorId={actorId} />;
}
function ActiveCampusOperationalLayers({ schoolId, campusId, actorId, publication, children, onLayoutRefresh }: Props & { actorId: string }) {
  const environment = useOptionalExecutionEnvironment() ?? LIVE_EXECUTION_ENVIRONMENT;
  const [params, setParams] = useSearchParams(), [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<{ label: string; records: SceneEvidenceRecord[]; trigger: HTMLElement | SVGElement | null } | null>(null);
  const rawLayer = params.get("campus_layer"), layer: CampusMapLayer = rawLayer === "classes" || rawLayer === "events" || rawLayer === "maintenance" ? rawLayer : "none";
  const scene = publication?.scene?.document ?? null, timezone = publication?.campus.timezone ?? "UTC";
  const [recordPage, setRecordPage] = useState<{ scope: string; page: number } | null>(null);
  const recordScope = `${publication?.scene?.id ?? "none"}:${publication?.scene?.version ?? 0}:${layer}`;
  const assetContext = `${schoolId}:${actorId}:${campusId}:${executionEnvironmentIdentity(environment)}:${publication?.scene?.id ?? "none"}:${publication?.scene?.version ?? 0}`;
  const selectedAssetElementId = params.get("campus_asset_context") === assetContext ? scene?.elements.find(element => element.id === params.get("campus_asset") && element.kind === "fixture" && element.holding_id)?.id ?? null : null;
  const clock = environment.mode === "simulation" && !environment.unavailable ? environment.virtualClock.now : "current";
  const query = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["campus-view", "operations", schoolId, actorId, campusId, publication?.scene?.id ?? "none", publication?.scene?.version ?? 0, clock]),
    queryFn: async ({ signal }) => {
      const result = await getCampusOperationalLayers(schoolId, campusId, signal);
      if (!campusOperationalMatches(result, schoolId, campusId, environment)) throw new Error("The campus context could not be confirmed.");
      if (result.publication?.id !== publication?.scene?.id || result.publication?.version !== publication?.scene?.version) throw new CampusLayoutChangedError("The published campus layout changed.");
      return result;
    },
    staleTime: 15_000, refetchInterval: environment.mode === "live" ? 30_000 : false, retry: false });
  const matchingContext = campusOperationalMatches(query.data, schoolId, campusId, environment);
  const matchingPublication = query.data?.publication?.id === publication?.scene?.id && query.data?.publication?.version === publication?.scene?.version;
  const layoutChanged = query.error instanceof CampusLayoutChangedError || Boolean(matchingContext && !matchingPublication);
  const data = !query.error && matchingContext && matchingPublication ? query.data : undefined;
  const assets = boundCampusAssets(scene, data?.assets ?? []), activities = data?.activities.filter(item => item.layer === layer) ?? [];
  const missingLiftStatus = campusLinkedLiftIds(scene).some(id => !assets.some(asset => asset.element_id === id));
  const records = campusActivityRecords(activities);
  const spaces = publication?.places.map(place => ({ ...place, campus_id: campusId })) ?? [];
  const projections = (visible: CampusSceneDocument, floor: string | null) => (["expected", "accepted"] as const).map(dimension => projectSceneEvidence({ scene: visible, floorId: floor, spaces, records, campusId, layer: dimension }));
  const assetRecords = new Map(assets.filter(asset => asset.signal.state === "reported_fault" || asset.signal.state === "awaiting_verification").map(asset => [asset.element_id, {
    id: `asset-status:${asset.element_id}`, spaceId: asset.space_id, dimension: "accepted" as const, title: asset.name, detail: `${campusAssetLabel(asset)}. ${asset.signal.open_reports} open reports. Descriptions and photos remain private.`, sourceLabel: "Structured asset reports", occurredAt: asset.signal.updated_at ?? undefined, temporal: "current" as const,
  }]));
  const closeEvidence = useCallback(() => { setEvidence(null); setSelectedMarkerId(null); }, []);
  const setLayer = (next: string) => { const copy = new URLSearchParams(params); if (next === "none") copy.delete("campus_layer"); else copy.set("campus_layer", next); setParams(copy, { replace: true }); setRecordPage(null); closeEvidence(); };
  const onSelectAsset = (id: string | null) => {
    const fixture = scene?.elements.find(element => element.id === id && element.kind === "fixture" && element.holding_id);
    const copy = new URLSearchParams(params);
    if (fixture) { copy.set("campus_asset", fixture.id); copy.set("campus_asset_context", assetContext); copy.delete("campus_space"); copy.set("campus_focus", "explore"); }
    else { copy.delete("campus_asset"); copy.delete("campus_asset_context"); }
    setParams(copy, { replace: true }); closeEvidence();
  };
  const currentEvidence = new Map([...records, ...assetRecords.values()].map(record => [record.id, record]));
  const evidenceRecords = evidence?.records.map(record => currentEvidence.get(record.id)).filter((record): record is SceneEvidenceRecord => Boolean(record)) ?? [];
  const routeWarnings = query.isPending ? <p className="campus-layer-message" role="status">Loading campus layers… {missingLiftStatus ? liftStatusUnavailable : null}</p> : layoutChanged ? <p className="campus-layer-message" role="alert">The campus layout changed. Refresh it before using directions or asset status. <button type="button" onClick={() => onLayoutRefresh ? onLayoutRefresh() : void query.refetch()}>Refresh campus layout</button></p> : !data ? <p className="campus-layer-message" role="alert">Campus layers are unavailable. The layout remains usable. {missingLiftStatus ? liftStatusUnavailable : null} <button type="button" onClick={() => void query.refetch()}>Try again</button></p>
    : missingLiftStatus ? <p className="campus-layer-message" role="status">{liftStatusUnavailable}</p> : null;
  const bridge: CampusOperationalBridge = {
    assets, assetsState: query.isPending ? "loading" : data ? "available" : "unavailable",
    selectedAssetElementId, onSelectAsset,
    dialogOpen: Boolean(evidence && data && evidenceRecords.length), closeDialog: closeEvidence,
    routeWarnings,
    mapControls: <label className="campus-layer-choice"><span className="campus-scene-visually-hidden">Campus layers</span><select aria-label="Campus layers" value={layer} onChange={event => setLayer(event.target.value)}><option value="none">Campus layout</option><option value="classes">Classes</option><option value="events">Events</option><option value="maintenance">Maintenance</option></select></label>,
    controls: <>{routeWarnings}{data && layer !== "none" ? <CampusLayerRecords key={layer} items={activities} layer={layer} timezone={timezone} page={recordPage?.scope === recordScope ? recordPage.page : 1} onPage={page => setRecordPage({ scope: recordScope, page })} /> : null}</>,
    faultLampIds: campusAssetFaultIds(scene, assets, "lamp"), blockedConnectorIds: campusBlockedLiftIds(scene, assets), layoutChanged, selectedMarkerId,
    markersFor: (visible, floor) => {
      if (!data || layer === "none") return [];
      const markers = projections(visible, floor).flatMap(projection => projection.markers.map(marker => ({ ...marker, id: `campus-layer:${layer}:${marker.id}` })));
      if (layer === "maintenance") for (const element of sceneVisibleElements(visible.elements, floor)) {
        const record = assetRecords.get(element.id); if (!record) continue;
        const asset = assets.find(item => item.element_id === element.id)!;
        markers.push({ id: `campus-layer:asset:${element.id}`, elementId: element.id, dimension: "accepted", count: 1, label: `${campusAssetLabel(asset)} · ${asset.name}`, summary: "One shared asset status, not a physical measurement.", tone: asset.signal.impact === "not_working" ? "fault" : "attention" });
      }
      return markers;
    },
    onSelectMarker: id => {
      if (!scene || !data || !id.startsWith("campus-layer:")) return;
      const assetRecord = assetRecords.get(id.replace("campus-layer:asset:", ""));
      if (assetRecord) { onSelectAsset(id.replace("campus-layer:asset:", "")); return; }
      const groups = [null, ...new Set(scene.elements.map(element => element.floor_id).filter(Boolean))].flatMap(floor => projections(scene, floor).flatMap(projection => projection.groups));
      const group = groups.find(item => `campus-layer:${layer}:${item.id}` === id);
      const found = group?.records;
      if (!found?.length) return;
      setSelectedMarkerId(id); setEvidence({ label: scene.elements.find(element => element.id === group?.elementId)?.label ?? "Campus activity", records: found,
        trigger: document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement ? document.activeElement : null });
    },
    elementDetails: element => {
      if (!element.holding_id) return null;
      const asset = assetForSceneElement(assets, element);
      return asset ? <CampusAssetStatus asset={asset} isLamp={element.asset_key === "lamp"} timezone={timezone} /> : <p className="campus-layer-message">Linked asset status is not confirmed. {element.asset_key === "lamp" ? "Lighting remains illustrative." : "Availability has not been verified."}</p>;
    },
  };
  return <>{children(bridge)}{evidence && data && evidenceRecords.length ? <CampusEvidenceSheet label={evidence.label} records={evidenceRecords} formatTime={date => campusDateFormatter(timezone, true).format(date)} returnFocus={evidence.trigger} onClose={closeEvidence} /> : null}</>;
}
