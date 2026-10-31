import type { SceneDocument, SceneAction } from "./campus-scenes.contracts.js";

export interface CampusVisualSceneTable {
  id: string;
  school_id: string;
  campus_id: string;
  revision: number;
  draft_document: SceneDocument | null;
  published_revision: number | null;
  created_at: Date;
  updated_at: Date;
}
export interface CampusSceneRevisionTable {
  id: string;
  school_id: string;
  campus_id: string;
  scene_id: string;
  revision: number;
  action: Exclude<SceneAction, "image_uploaded">;
  document: SceneDocument;
  published_revision: number | null;
  command_id: string;
  actor_user_id: string;
  actor_person_id: string;
  recorded_at: Date;
}
export interface CampusSceneImageTable {
  id: string;
  school_id: string;
  campus_id: string;
  mime_type: "image/png" | "image/jpeg" | "image/webp";
  bytes: Buffer;
  byte_size: number;
  width: number;
  height: number;
  sha256: string;
  rights_confirmed: boolean;
  command_id: string;
  actor_user_id: string;
  actor_person_id: string;
  created_at: Date;
}
