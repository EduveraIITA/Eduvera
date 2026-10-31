export interface CampusScenePoint { x: number; y: number }

export type CampusSceneKind = 'building' | 'room' | 'road' | 'path' | 'tree' | 'fixture' | 'surface';
export type CampusSceneAsset = 'generic' | 'academic' | 'library' | 'administration' | 'laboratory' | 'auditorium' | 'residence' | 'sports' | 'dining' | 'parking' | 'gate' | 'boundary_wall' | 'tree_broadleaf' | 'tree_palm' | 'tree_conifer' | 'tree_columnar' | 'shrub' | 'flower_bed' | 'bench' | 'lamp' | 'water' | 'grass' | 'paving' | 'water_point' | 'equipment' | 'desk' | 'chair' | 'computer' | 'meeting_table' | 'cabinet' | 'server_rack' | 'printer' | 'fire_extinguisher' | 'first_aid' | 'toilet' | 'washbasin' | 'door' | 'window' | 'projector' | 'whiteboard';
export type CampusSceneMaterial = 'neutral' | 'brick' | 'concrete' | 'glass' | 'wood' | 'metal' | 'grass' | 'sand' | 'water' | 'asphalt' | 'paving';

/** Administrator-reviewed walking links; geometry alone never establishes a route. */
export interface CampusSceneNavigation {
  walkable: true;
  accessible: boolean;
  status: 'open' | 'closed';
  start_space_id: string | null;
  end_space_id: string | null;
}

/** Explicit reviewed junction between coordinate-identical landings; never inferred from proximity. */
export interface CampusSceneConnector {
  kind: 'entrance' | 'stairs' | 'lift';
  status: 'open' | 'closed';
  accessible: boolean;
  from_floor_id: string | null;
  to_floor_id: string;
}

export interface CampusSceneElement {
  id: string;
  kind: CampusSceneKind;
  label: string;
  /** One source feature's outlines in this document; never a campus-place ID. */
  source_feature_id?: string;
  geometry: { type: 'polygon' | 'polyline' | 'point'; points: CampusScenePoint[] };
  space_id: string | null;
  floor_id: string | null;
  holding_id?: string | null;
  parent_element_id?: string | null;
  asset_key?: CampusSceneAsset;
  width?: number;
  /** Optional presentation footprint depth and rotation; never operational state. */
  depth?: number;
  rotation_deg?: number;
  height?: number;
  levels?: number;
  material?: CampusSceneMaterial;
  roof?: 'flat' | 'gable' | 'hip';
  navigation?: CampusSceneNavigation;
  navigation_connector?: CampusSceneConnector;
  review_state: 'needs_review' | 'reviewed';
}

export interface CampusSceneDocument {
  schema_version: 1;
  name: string;
  bounds: { width: number; height: number; unit: 'relative' | 'metres' };
  source: {
    kind: 'manual' | 'aerial_image' | 'site_plan' | 'name_search' | 'open_map';
    label: string;
    reference_url?: string;
    attribution?: string;
    image_asset_id?: string;
    provider?: string;
    generated_at?: string;
    notes?: string;
  };
  elements: CampusSceneElement[];
}

export interface CampusSceneSpace {
  id: string;
  campus_id: string;
  parent_space_id: string | null;
  name: string;
  code: string;
  kind: string;
  capacity?: number | null;
  revision?: number;
  status?: "active" | "inactive";
}

export interface CampusSceneLocation {
  id: string;
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  bounds?: { south: number; west: number; north: number; east: number };
  source: string;
}

export type CampusSceneImportRequest =
  | { kind: 'image'; file: File; label: string; sourceKind: 'aerial_image' | 'site_plan'; rightsConfirmed: boolean; instructions?: string; traceOnly?: boolean }
  | { kind: 'location'; location: CampusSceneLocation; radiusMetres?: number }
  | { kind: 'geojson'; text: string; label: string; attribution: string; rightsConfirmed: boolean };

export interface CampusSceneImportCapabilities {
  image_analysis: { available: boolean; reason?: string };
  map_search: { available: boolean; reason?: string };
  max_image_bytes: number;
}

export interface CampusSceneSavedDraft { document: CampusSceneDocument; revision: number }
