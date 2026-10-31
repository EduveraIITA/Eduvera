import type { CampusSpace } from "../institution";
import type { CampusSceneDocument, CampusSceneSpace } from "./types";
export interface SceneCampus { id: string; name: string; code: string; is_primary?: boolean; timezone?: string }

export interface CampusSceneDirectory { campuses: SceneCampus[]; can_edit: boolean }

export interface CampusScenePublication { id: string; version: number; published_at: string; document: CampusSceneDocument }

export interface CampusScenePublished { campus: SceneCampus; scene: CampusScenePublication | null; can_edit: boolean; places: Array<Omit<CampusSceneSpace, "campus_id">> }

export interface CampusSceneWorkspace {
  campus: SceneCampus; spaces: CampusSceneSpace[];
  scene: { id: string; revision: number; draft: CampusSceneDocument | null; published_version: number | null; published: CampusScenePublication | null; updated_at: string } | null;
}

export interface CampusSceneReceipt {
  id: string; revision: number; document: CampusSceneDocument; draft: CampusSceneDocument | null;
  published_version: number | null; version?: number; replayed: boolean;
}

export type ReviewedScenePlaceRow = { proposal_id: string; element_ids: string[]; floor_element_ids?: string[]; action: "create"; name: string; code: string; kind: CampusSpace["kind"]; parent_space_id?: string | null; expected_parent_revision?: number; parent_proposal_id?: string } | { proposal_id: string; element_ids: string[]; floor_element_ids?: string[]; action: "reuse"; space_id: string; expected_space_revision: number };

export interface ReviewedScenePlacesRequest { idempotency_key: string; expected_revision: number; document: CampusSceneDocument; rows: ReviewedScenePlaceRow[] }

export interface ReviewedScenePlacesReceipt extends CampusSceneReceipt { current_revision: number; mappings: Array<{ proposal_id: string; element_ids: string[]; space_id: string; space_revision: number; action: "created" | "reused" }> }

export interface CampusSceneImage { id: string; mime_type: string; width: number; height: number; sha256: string; byte_size: number }

export interface SceneResource { id: string; name: string; asset_tag: string | null; space_id: string | null; state: "available" | "unavailable"; quantity?: number; tracking_mode?: "individual" | "pooled"; unit_label?: string }

export interface SceneResourceOptions { items: SceneResource[]; selected: SceneResource | null; page: number; page_size: number; total: number }

export interface SceneResourceStates { generated_at: string; items: Array<{ element_id: string; holding_id: string; name: string; state: "available" | "unavailable" | "unknown"; target_path: string }> }
