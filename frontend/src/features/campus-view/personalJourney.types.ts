import type { ReactNode } from "react";
import type { SceneWalkingRoute } from "../campus-scenes/sceneWalking";
import type { CampusMotionProjection } from "../../../../packages/contracts/src/campus-motion";
export type { CampusPersonalDestination, CampusPersonalResponse } from "../../../../packages/contracts/src/campus-personal";

export interface CampusPersonalSelection {
  spaceId: string | null; view: "place" | "outside"; token: number;
  /** Existing URL presentation intent; it does not assert location or authority. */
  intent?: "journey" | "explore";
}
export interface CampusPersonalBridge {
  motion?: CampusMotionProjection;
  motionState?: "loading" | "available" | "unavailable";
  selection: CampusPersonalSelection | null;
  onSelectPlace: (spaceId: string | null) => void;
  walkingRoute: SceneWalkingRoute | null;
  controls: ReactNode;
  placeDetails: (spaceId: string) => ReactNode;
}
