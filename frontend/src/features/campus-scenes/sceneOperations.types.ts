import type { ReactNode } from "react";
import type { SceneEvidenceMarker } from "../../../../packages/contracts/src/campus-scenes/sceneEvidence.types";
export type { SceneEvidenceLayer, SceneEvidenceRecord, SceneEvidenceMarker, SceneEvidenceGroup, SceneEvidenceProjection } from "../../../../packages/contracts/src/campus-scenes/sceneEvidence.types";
import type { CampusSceneDocument, CampusSceneSpace } from "./types";
import type { CampusMotionProjection } from "../campus-view/campusMotion.types";

export interface CampusSceneOperationsBridge {
  /** Minimal canonical hierarchy from the current authorised campus snapshot. */
  places?: readonly CampusSceneSpace[];
  placesState?: "loading" | "available" | "unavailable";
  motion?: CampusMotionProjection;
  motionState?: "loading" | "available" | "unavailable";
  markersFor: (scene: CampusSceneDocument, floorId: string | null) => readonly SceneEvidenceMarker[];
  selectedSpaceId: string | null;
  selectedMarkerId: string | null;
  unavailableFixtureIds: readonly string[];
  onSelectPlace: (spaceId: string | null) => void;
  onInspectPlace: (spaceId: string) => void;
  /** Exact current oversight availability; a published place link alone is insufficient. */
  inspectionState?: (spaceId: string) => "loading" | "available" | "unavailable";
  onSelectMarker: (markerId: string) => void;
  /** Native drilldowns are rendered by this owner, outside its workspace controls. */
  dialogOpen?: boolean;
  closeDialog?: () => void;
  /** Compact map-layer control, composed by the published campus workspace. */
  mapControls?: ReactNode;
  controls: ReactNode;
}
