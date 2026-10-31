import type { CampusSceneDirectory, CampusScenePublished, CampusSceneWorkspace, CampusSceneReceipt, ReviewedScenePlacesRequest, ReviewedScenePlacesReceipt, CampusSceneImage, SceneResourceOptions, SceneResourceStates } from "../../../../packages/contracts/src/campus-scenes/contracts";
export type { SceneCampus, CampusSceneDirectory, CampusScenePublication, CampusScenePublished, CampusSceneWorkspace, CampusSceneReceipt, ReviewedScenePlaceRow, ReviewedScenePlacesRequest, ReviewedScenePlacesReceipt, CampusSceneImage, SceneResource, SceneResourceOptions, SceneResourceStates } from "../../../../packages/contracts/src/campus-scenes/contracts";
import { apiBlob, apiFetch } from "../../lib/api";

import type { CampusSceneDocument, CampusSceneImportCapabilities, CampusSceneLocation } from "./types";

const directoryPath = (schoolId: string) => `/api/v1/schools/${encodeURIComponent(schoolId)}/campus-scenes/`;
const scenePath = (schoolId: string, campusId: string, suffix: string) => `${directoryPath(schoolId)}${encodeURIComponent(campusId)}/${suffix}/`;

export const getCampusSceneDirectory = (schoolId: string, signal?: AbortSignal) => apiFetch<CampusSceneDirectory>(directoryPath(schoolId), { signal });
export const getCampusScenePublished = (schoolId: string, campusId: string, signal?: AbortSignal) => apiFetch<CampusScenePublished>(scenePath(schoolId, campusId, "published"), { signal });
export const getCampusSceneResourceStates = (schoolId: string, campusId: string, signal?: AbortSignal) => apiFetch<SceneResourceStates>(scenePath(schoolId, campusId, "resource-states"), { signal });
export const getCampusSceneResources = (schoolId: string, campusId: string, input: { search: string; page: number; holding_id?: string; space_id?: string; tracking_mode?: "individual" | "pooled" | "all" }, signal?: AbortSignal) => {
  const query = new URLSearchParams({ search: input.search, page: String(input.page) });
  if (input.holding_id) query.set("holding_id", input.holding_id);
  if (input.space_id) query.set("space_id", input.space_id);
  if (input.tracking_mode) query.set("tracking_mode", input.tracking_mode);
  return apiFetch<SceneResourceOptions>(`${scenePath(schoolId, campusId, "resources")}?${query}`, { signal });
};
export async function getCampusSceneWorkspace(schoolId: string, campusId: string, signal?: AbortSignal): Promise<CampusSceneWorkspace> {
  const response = await apiFetch<CampusSceneWorkspace>(scenePath(schoolId, campusId, "workspace"), { signal });
  return { ...response, spaces: response.spaces.map(space => ({ ...space, campus_id: campusId })) };
}
export const saveCampusSceneDraft = (schoolId: string, campusId: string, document: CampusSceneDocument, expectedRevision: number, idempotencyKey: string) => apiFetch<CampusSceneReceipt>(scenePath(schoolId, campusId, "draft"), { method: "PUT", body: JSON.stringify({ document, expected_revision: expectedRevision, idempotency_key: idempotencyKey }) });
export const saveReviewedScenePlaces = (schoolId: string, campusId: string, body: ReviewedScenePlacesRequest) => apiFetch<ReviewedScenePlacesReceipt>(scenePath(schoolId, campusId, "reviewed-places"), { method: "POST", body: JSON.stringify(body) });
export const publishCampusScene = (schoolId: string, campusId: string, expectedRevision: number, idempotencyKey: string) => apiFetch<CampusSceneReceipt>(scenePath(schoolId, campusId, "publish"), { method: "POST", body: JSON.stringify({ expected_revision: expectedRevision, idempotency_key: idempotencyKey }) });
export const reopenCampusScene = (schoolId: string, campusId: string, expectedRevision: number, idempotencyKey: string) => apiFetch<CampusSceneReceipt>(scenePath(schoolId, campusId, "reopen"), { method: "POST", body: JSON.stringify({ expected_revision: expectedRevision, idempotency_key: idempotencyKey }) });
export const getCampusSceneImage = (schoolId: string, campusId: string, imageId: string, signal?: AbortSignal) => apiBlob(scenePath(schoolId, campusId, `images/${encodeURIComponent(imageId)}`), { signal });
export const getCampusSceneImportCapabilities = (schoolId: string, campusId: string, signal?: AbortSignal) => apiFetch<CampusSceneImportCapabilities>(scenePath(schoolId, campusId, "imports/capabilities"), { signal });
export const lookupCampusSceneLocation = async (schoolId: string, campusId: string, query: string): Promise<CampusSceneLocation[]> => {
  const response = await apiFetch<{ locations: CampusSceneLocation[] }>(scenePath(schoolId, campusId, "imports/lookup"), { method: "POST", body: JSON.stringify({ query, idempotency_key: crypto.randomUUID() }) });
  return response.locations;
};

export function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("This image could not be read. Choose it again."));
    reader.onerror = () => reject(new Error("This image could not be read. Choose it again."));
    reader.onabort = () => reject(new Error("Image loading was interrupted. Choose it again."));
    reader.readAsDataURL(file);
  });
}
export async function uploadCampusSceneImage(schoolId: string, campusId: string, file: File, idempotencyKey: string) {
  const dataUrl = await fileDataUrl(file);
  return apiFetch<{ image: CampusSceneImage; replayed: boolean }>(scenePath(schoolId, campusId, "images"), { method: "POST", body: JSON.stringify({ idempotency_key: idempotencyKey, rights_confirmed: true, data_url: dataUrl }) });
}

export const requestCampusSceneImport = (schoolId: string, campusId: string, body: { idempotency_key: string } & Record<string, unknown>) => apiFetch<{ document: CampusSceneDocument }>(scenePath(schoolId, campusId, "imports"), { method: "POST", body: JSON.stringify(body) });
