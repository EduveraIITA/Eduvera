import type { FacilitiesAssetSignal } from '../facilities/facilities-map.contracts.js';

export interface CampusOperationalActivity {
  id: string;
  layer: 'classes' | 'events' | 'maintenance';
  title: string;
  detail: string;
  space_id: string | null;
  holding_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  state: string;
  target_path: string;
  action_label: string;
  dimension: 'expected' | 'accepted';
  source: { domain: string; record_id: string; revision: number; label: string };
}
export interface CampusOperationalAsset {
  element_id: string;
  holding_id: string;
  name: string;
  asset_tag: string | null;
  space_id: string | null;
  native_state: 'available' | 'unavailable' | 'retired' | 'unknown';
  reportable: boolean;
  signal: Omit<FacilitiesAssetSignal, 'holding_id' | 'repairs'>;
  repairs: FacilitiesAssetSignal['repairs'];
}
export interface CampusOperationsProjection {
  schema_version: 1;
  school_id: string;
  campus_id: string;
  as_of: string;
  environment: { kind: 'live' | 'simulation'; namespace_id: string | null };
  publication: { id:string;version:number } | null;
  assets: CampusOperationalAsset[];
  activities: CampusOperationalActivity[];
  bounds: { activities_per_layer: 20; events_source_limit: 30; events_has_more: boolean;
    shown: { classes: number; events: number; maintenance: number } };
  limitations: string[];
}
