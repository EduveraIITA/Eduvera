export type CampusTruthDimension = "expected" | "observed" | "accepted" | "unknown";

export type SceneEvidenceLayer = "none" | CampusTruthDimension;

/** Authorized source records; current never follows from freshness or a point event alone. */
export interface SceneEvidenceRecord {
  id: string;
  spaceId: string | null;
  dimension: CampusTruthDimension;
  title: string;
  detail?: string;
  sourceLabel: string;
  occurredAt?: string;
  targetPath?: string;
  temporal: "current" | "upcoming" | "historical" | "unknown";
  /** Only a current, time-bounded expected assignment may supply this count. */
  expectedCount?: number;
}

export interface SceneEvidenceMarker {
  id: string;
  elementId: string;
  dimension: CampusTruthDimension;
  /** Number of distinct source records, never a presence or people count. */
  count: number;
  label: string;
  summary: string;
  /** A single current assignment's planned count; multiple assignments are not summed. */
  expectedCount?: number;
  plannedCapacityPressure?: {expectedCount:number;capacity:number};
  tone?: "fault" | "attention";
}

export interface SceneEvidenceGroup {
  id: string;
  elementId: string;
  records: SceneEvidenceRecord[];
  spaceIds: string[];
  aggregated: boolean;
}

export interface SceneEvidenceProjection {
  markers: SceneEvidenceMarker[];
  groups: SceneEvidenceGroup[];
  unlocated: SceneEvidenceRecord[];
}

