import type { CampusMapAsset } from "../../../../packages/contracts/src/campus-operation";
export type { CampusMapLayer, CampusMapAsset, CampusMapActivity, CampusOperationalProjection } from "../../../../packages/contracts/src/campus-operation";
import type { ReactNode } from "react";
import type { CampusSceneDocument, CampusSceneElement } from "../campus-scenes/types";
import type { SceneEvidenceMarker } from "../campus-scenes/sceneOperations.types";

export interface CampusOperationalBridge {
  /** Current authorised holdings bound to exact fixtures in this publication. */
  assets?: readonly CampusMapAsset[];
  assetsState?: "loading" | "available" | "unavailable";
  mapControls: ReactNode; controls: ReactNode;
  /** Routing limitations and recovery only, without the selected layer's record list. */
  routeWarnings?: ReactNode;
  /** True only while this owner's current, authorised evidence dialog is rendered. */
  dialogOpen?: boolean;
  closeDialog?: () => void;
  markersFor: (scene: CampusSceneDocument, floorId: string | null) => readonly SceneEvidenceMarker[];
  selectedMarkerId: string | null; onSelectMarker: (id: string) => void;
  selectedAssetElementId: string | null; onSelectAsset: (id: string | null) => void;
  /** Known resource unavailability or an active structured not-working report. */
  faultLampIds: readonly string[];
  blockedConnectorIds: readonly string[];
  layoutChanged: boolean;
  elementDetails: (element: CampusSceneElement) => ReactNode;
}
