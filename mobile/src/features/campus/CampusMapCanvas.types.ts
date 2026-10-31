import type { CampusSceneDocument, CampusScenePoint } from '../../../../packages/contracts/src/campus-scenes/types';
import type { SceneBounds, SceneViewMode } from '../../../../packages/contracts/src/campus-scenes/sceneGeometry';
import type { SceneEvidenceMarker } from '../../../../packages/contracts/src/campus-scenes/sceneEvidence.types';
import type { SceneFloorPlanContext } from '../../../../packages/contracts/src/campus-scenes/sceneFloorPlans';
import type { ScenePeopleClock, ScenePeopleCompiled } from '../../../../packages/contracts/src/campus-scenes/scenePeopleTracks.types';
import type { SceneSunlight } from '../../../../packages/contracts/src/campus-scenes/sceneSunlight';
import type { SceneViewportFocus } from '../../../../packages/contracts/src/campus-scenes/sceneViewportFocus';
import type { SceneWalkingRoute } from '../../../../packages/contracts/src/campus-scenes/sceneWalking';
import type { CampusCamera } from '../../lib/campus-camera';
import type { CampusPeopleVisibility } from '../../lib/campus-people';
import type { NativeCampusAssetRenderState } from '../../lib/campus-asset-render-state';

/** Presentation input only. All operational facts remain owned by the selected DT. */
export interface CampusMapCanvasProps {
  scene: CampusSceneDocument;
  contextKey?: string;
  markers?: readonly SceneEvidenceMarker[];
  selectedMarkerId?: string | null;
  onSelectMarker?(id: string): void;
  assetStates?: readonly NativeCampusAssetRenderState[];
  people?: { compiled: ScenePeopleCompiled | null; clock: ScenePeopleClock; visibility: CampusPeopleVisibility };
  draftPreview?: boolean;
  editorInterior?: SceneFloorPlanContext;
  sourceImageUrl?: string;
  sourceImageBounds?: { x: number; y: number; width: number; height: number; rotationDeg?: number };
  onPoint?(point: CampusScenePoint): void;
  drawingPoints?: readonly CampusScenePoint[];
  bottomOverlap?: number;
  /** Contextual map hosts can reserve their own overlay controls. */
  viewportInsets?: { top: number; bottom: number };
  lighting?: 'day' | 'night';
  sunlight?: SceneSunlight;
  floor: string | null;
  mode: SceneViewMode;
  selected: string | null;
  /** Advisory place overlays; independent of authoritative resource availability. */
  placeHighlights?: readonly { elementId: string; tone: "warning" | "danger" }[];
  route: SceneWalkingRoute | null;
  unavailable: readonly string[];
  onSelect(id: string): void;
  camera: CampusCamera;
  onCameraChange(camera: CampusCamera): void;
  viewBounds?: SceneBounds | null;
  outline?: readonly CampusScenePoint[] | null;
  focus?: SceneBounds | SceneViewportFocus | null;
}
