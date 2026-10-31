import type { CampusSceneElement, CampusScenePoint } from "./types";
import type { ScenePeopleMotionScope, ScenePeopleRoutePlan } from "./scenePeopleMotion";

export interface ScenePeopleClock { instant: number | null; live: boolean; running: boolean; epoch: string }
export interface ScenePeoplePose {
  key: string; point: CampusScenePoint; floorId: string | null; heading: number;
  moving: boolean; phase: number; opacity: number; tone: "self" | "expected";
}
export interface ScenePeoplePulsePose { key: string; point: CampusScenePoint; floorId: string | null; ageMs: number; dimension: "observed" | "accepted" }
export interface ScenePeopleTrack {
  key: string; sourceKey: string; tone: "self" | "expected";
  targetSpaceId: string | null;
  retargeted?: boolean;
  bodyRadius?: number;
  startsAt: number; endsAt: number;
  route?: ScenePeopleRoutePlan; routeStartsAt?: number; routeEndsAt?: number;
  idle?: { point: CampusScenePoint; floorId: string | null; element: CampusSceneElement };
}
export interface ScenePeopleCompiled {
  contextKey: string; scope: ScenePeopleMotionScope; asOf: number; tracks: readonly ScenePeopleTrack[];
  excludedConnectorIds?: readonly string[];
  points: readonly { key: string; point: CampusScenePoint; floorId: string | null; observedAt: number; dimension: "observed" | "accepted" }[];
  unmapped: number; unavailableRoutes: number; conflicting: number; sourceLimited: boolean;
}
